'use strict';
/**
 * 配置加载：config/config.json（不存在则生成默认配置）+ 环境变量覆盖。
 * 环境变量：PORT、LANOFFICE_DATA_DIR、LANOFFICE_NO_OPEN、LANOFFICE_DS_DISABLE
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');

const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  autoOpenBrowser: true,
  dataDir: 'data',
  ds: {
    url: '',           // OnlyOffice Document Server 地址，如 http://localhost:80（留空则自动探测常见端口）
    publicUrl: '',     // 局域网设备访问 DS 用的地址（留空则自动用本机局域网 IP + DS 端口）
    jwtSecret: '',     // 与 DS local.json 中 secret 一致（留空则自动尝试读取本机 DS 配置）
    callbackHost: ''   // DS 回调本服务用的主机名（默认 127.0.0.1，即 DS 与本服务同机；跨机部署时改为本机局域网 IP）
  },
  backup: { maxPerFile: 30 },
  upload: { maxSizeMB: 200 },
  teacherPassword: '1234'
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

let userConfig = {};
try {
  userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  } catch (_) { /* 只读环境忽略 */ }
}

const config = deepMerge(DEFAULTS, userConfig);
config.rootDir = ROOT;
config.dataPath = path.resolve(ROOT, process.env.LANOFFICE_DATA_DIR || config.dataDir);
config.port = Number(process.env.PORT || config.port) || 3000;
if (process.env.LANOFFICE_NO_OPEN) config.autoOpenBrowser = false;
config.upload.maxBytes = Math.max(1, Number(config.upload.maxSizeMB) || 200) * 1024 * 1024;
if (process.env.LANOFFICE_DS_DISABLE) config.ds.url = 'http://127.0.0.1:1'; // 测试用：明确不可达

module.exports = config;
