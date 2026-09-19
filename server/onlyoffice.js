'use strict';
/**
 * OnlyOffice Document Server 集成：
 * - 健康探测（healthcheck，支持常见端口自动发现）
 * - JWT 密钥自动读取（Windows 版 DS 7.2+ 默认启用 JWT，密钥在 local.json）
 * - 编辑器配置生成（含 document.key 版本化）
 * - 保存回调处理（下载 → 校验 → 备份 → 原子替换）
 * - 命令服务（forcesave / meta）
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('./config');
const fileManager = require('./fileManager');
const collab = require('./collaboration');
const { lanAddresses } = require('./network');

const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const DS_LOCAL_JSON_PATHS = [
  'C:\\Program Files\\ONLYOFFICE\\DocumentServer\\config\\local.json',
  'C:\\Program Files (x86)\\ONLYOFFICE\\DocumentServer\\config\\local.json'
];

const state = {
  url: null,
  available: false,
  checkedAt: 0,
  checking: false,
  jwtSecret: null,
  jwtSource: null,
  runtimePort: null,
  monitor: null
};

function candidateUrls() {
  const list = [];
  if (config.ds.url) list.push(String(config.ds.url).replace(/\/+$/, ''));
  else for (const p of [80, 8080, 8090, 8000, 8888]) list.push(`http://127.0.0.1:${p}`);
  return Array.from(new Set(list));
}

async function ping(base) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch(`${base}/healthcheck`, { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const text = (await r.text()).trim().toLowerCase();
      return text === 'true';
    }
  } catch (_) { /* 不可达 */ }
  return false;
}

async function detect(force = false) {
  if (!force && state.checkedAt && Date.now() - state.checkedAt < 15000) return state;
  if (state.checking) return state;
  state.checking = true;
  try {
    for (const base of candidateUrls()) {
      if (await ping(base)) {
        state.url = base;
        state.available = true;
        break;
      }
    }
    if (!state.available && !state.url) state.url = candidateUrls()[0] || null;
    state.checkedAt = Date.now();
    loadJwtSecret();
  } finally {
    state.checking = false;
  }
  return state;
}

function startMonitor() {
  if (state.monitor) return;
  state.monitor = setInterval(() => { detect(true).catch(() => {}); }, 30000);
  state.monitor.unref();
}

/** 读取 JWT 密钥：优先 config.json，其次本机 DS 的 local.json */
function loadJwtSecret() {
  if (config.ds.jwtSecret) {
    state.jwtSecret = String(config.ds.jwtSecret);
    state.jwtSource = 'config/config.json';
    return;
  }
  for (const p of DS_LOCAL_JSON_PATHS) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const s = j && j.services && j.services.CoAuthoring && j.services.CoAuthoring.secret;
      const str = s && s.inbox && s.inbox.string
        || s && s.outbox && s.outbox.string
        || s && s.session && s.session.string;
      if (str) {
        state.jwtSecret = str;
        state.jwtSource = p;
        return;
      }
    } catch (_) { /* 无权限或不存在 */ }
  }
  state.jwtSecret = null;
  state.jwtSource = null;
}

function setRuntimePort(port) { state.runtimePort = port; }

function status() {
  return {
    available: state.available,
    url: state.url,
    jwt: !!state.jwtSecret,
    jwtSource: state.jwtSource,
    checkedAt: state.checkedAt
  };
}

/** 局域网设备访问 DS 的地址（api.js / iframe 都从这个源加载） */
function publicDsUrl() {
  if (config.ds.publicUrl) return String(config.ds.publicUrl).replace(/\/+$/, '');
  if (!state.url) return null;
  try {
    const u = new URL(state.url);
    const { primary } = lanAddresses();
    return `${u.protocol}//${primary}${u.port ? ':' + u.port : ''}`;
  } catch (_) {
    return state.url;
  }
}

function callbackBase() {
  const host = config.ds.callbackHost || '127.0.0.1';
  return `http://${host}:${state.runtimePort}`;
}

/** 生成传给浏览器 DocsAPI.DocEditor 的配置 */
function buildEditorConfig(meta, user, opts) {
  const info = fileManager.documentTypeInfo(meta.ext);
  const base = callbackBase();
  const cfg = {
    documentType: info.documentType,
    type: opts.type === 'mobile' ? 'mobile' : 'desktop',
    document: {
      fileType: meta.ext,
      key: fileManager.docKey(meta),
      title: meta.name,
      url: `${base}/api/files/${meta.id}/download`,
      permissions: {
        edit: info.editable,
        download: true,
        print: true,
        copy: true
      }
    },
    editorConfig: {
      user: { id: user.id, name: user.name },
      callbackUrl: `${base}/api/onlyoffice/callback`,
      lang: opts.lang || 'zh-CN',
      mode: info.editable ? 'edit' : 'view',
      customization: {
        autosave: true,
        forcesave: true,
        compactHeader: true,
        hideRulers: false,
        uiTheme: 'theme-classic-light'
      }
    }
  };
  if (state.jwtSecret) {
    cfg.token = jwt.sign(
      { document: cfg.document, editorConfig: cfg.editorConfig },
      state.jwtSecret,
      { algorithm: 'HS256' }
    );
  }
  return cfg;
}

/** 把 DS 推送过来的已保存文件下载到临时目录并校验 */
async function downloadTo(url, destPath) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  let r;
  try {
    r = await fetch(url, { signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error('下载保存文件失败: ' + e.message);
  }
  clearTimeout(timer);
  if (!r.ok) throw new Error(`下载保存文件失败 HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destPath));
}

function validateSavedFile(filePath, ext) {
  const st = fs.statSync(filePath);
  if (st.size <= 0) throw new Error('保存文件为空');
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(ext)) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      if (buf.toString('latin1') !== 'PK') throw new Error('保存文件不是有效的 OOXML 包');
    } finally {
      fs.closeSync(fd);
    }
  }
  return st;
}

/**
 * 处理 DS 保存回调（status 2 / 6）：
 * temp 下载 → 校验 → 备份旧版 → 原子替换 → 无人在编辑时版本+1（更换 document.key）
 */
async function applySavedCallback(key, url) {
  const meta = fileManager.findByKey(key);
  if (!meta) return { error: 0, note: 'unknown key (文件可能已被删除)' };
  const tmp = path.join(fileManager.dirs().tempDir, `save-${meta.id}-${Date.now()}.part`);
  try {
    await downloadTo(url, tmp);
    validateSavedFile(tmp, meta.ext);
    fileManager.applySavedFile(meta, tmp);
    // 若仍有编辑者在线则保持 key 不变（会话连续），等最后一人离开的回调再换 key
    fileManager.bumpVersionIfIdle(meta, collab.editingCount(meta.id) === 0);
    return { error: 0 };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* 忽略 */ }
    return { error: 1, message: e.message };
  }
}

/** CommandService：forcesave / meta 等 */
async function command(cmd, key, extra) {
  if (!state.available) return { ok: false, error: -1, message: '编辑引擎（Document Server）未连接' };
  const payload = Object.assign({ c: cmd, key }, extra || {});
  const body = Object.assign({}, payload);
  if (state.jwtSecret) {
    body.token = jwt.sign(payload, state.jwtSecret, { algorithm: 'HS256' });
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`${state.url}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    clearTimeout(timer);
    const data = await r.json();
    return { ok: data && data.error === 0, error: data && data.error, message: data && data.error ? commandErrorText(data.error) : '' };
  } catch (e) {
    return { ok: false, error: -2, message: '命令服务请求失败: ' + e.message };
  }
}

function commandErrorText(code) {
  const map = {
    1: '文档密钥无效或没有变化',
    2: '文档编辑服务回调地址无效',
    3: '令牌（JWT）校验失败 —— 请检查 config.json 的 ds.jwtSecret 与 DocumentServer local.json 是否一致',
    4: '当前没有未保存的更改',
    5: '命令错误'
  };
  return map[code] || `错误码 ${code}`;
}

function forcesave(meta) { return command('forcesave', fileManager.docKey(meta)); }

/** 重命名后同步 DS 会话里的文档标题（会话进行中标题不刷新的问题） */
function syncTitle(meta) { return command('meta', fileManager.docKey(meta), { meta: { title: meta.name } }); }

module.exports = {
  detect, startMonitor, status, publicDsUrl, setRuntimePort,
  buildEditorConfig, applySavedCallback, forcesave, syncTitle,
  _state: state
};
