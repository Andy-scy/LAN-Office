'use strict';
/**
 * HTTP 路由：文件管理 API + OnlyOffice 集成 API。
 * 安全设计：客户端只允许传文件 UUID（严格校验），一切路径都由服务端从元数据解析。
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const config = require('./config');
const fileManager = require('./fileManager');
const collab = require('./collaboration');
const surveys = require('./surveys');
const ds = require('./onlyoffice');
const { lanAddresses } = require('./network');

const VERSION = '1.2.0';
const ID_RE = /^[0-9a-f-]{8,64}$/i;

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf'
};

function requireValidId(req, res) {
  const id = String(req.params.id || '');
  if (!ID_RE.test(id)) {
    res.status(400).json({ error: '非法的文件 ID' });
    return null;
  }
  return id;
}

/** busboy 默认按 latin1 解码 multipart 文件名，中文会被打乱；检测并还原 UTF-8 */
function fixUtf8Name(name) {
  if (!name || !/[^\x00-\x7F]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    const cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
    if (decoded !== name && cjk.test(decoded) && !cjk.test(name)) return decoded;
  } catch (_) { /* 忽略 */ }
  return name;
}

function contentDisposition(name, download) {
  const type = download ? 'attachment' : 'inline';
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function editorUserFromBody(body) {
  const b = body || {};
  const userId = (typeof b.userId === 'string' && ID_RE.test(b.userId)) ? b.userId : crypto.randomUUID();
  const userName = collab.sanitizeName(b.userName) || collab.randomName();
  return { id: userId, name: userName };
}

function registerRoutes(app) {
  /* ---------- 上传 ---------- */
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, fileManager.dirs().tempDir),
      filename: (req, file, cb) => cb(null, crypto.randomUUID())
    }),
    limits: { fileSize: config.upload.maxBytes, files: 20 },
    fileFilter: (req, file, cb) => {
      const ext = fileManager.extOf(file.originalname);
      if (!fileManager.ACCEPTED.includes(ext)) {
        cb(Object.assign(new Error(`不支持的文件类型 .${ext || '(无扩展名)'}，支持：${fileManager.ACCEPTED.join(', ')}`), { status: 400 }));
        return;
      }
      cb(null, true);
    }
  });

  function uploadErrors(err, req, res, next) {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `文件超过大小限制（${config.upload.maxSizeMB}MB）`
        : err.message;
      return res.status(err.status || 400).json({ error: msg });
    }
    next();
  }

  app.post('/api/files/upload', upload.array('files'), uploadErrors, (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '没有收到文件' });
    let providedNames = [];
    try { providedNames = JSON.parse(req.body.names || '[]'); } catch (_) { providedNames = []; }
    const created = [];
    const failed = [];
    files.forEach((f, i) => {
      try {
        const name = fixUtf8Name(f.originalname);
        const provided = fixUtf8Name(providedNames[i]);
        created.push(fileManager.addUpload(f.path, name, provided));
      } catch (e) {
        failed.push({ name: f.originalname, error: e.message });
        try { fs.rmSync(f.path, { force: true }); } catch (_) { /* 忽略 */ }
      }
    });
    res.json({ files: created, failed });
  });

  /* ---------- 查询 ---------- */
  app.get('/api/info', (req, res) => {
    const st = ds.status();
    const { primary, all } = lanAddresses();
    res.json({
      name: 'LAN Office',
      version: VERSION,
      port: state_port(),
      primary,
      addresses: all,
      ds: { available: st.available, url: ds.publicDsUrl(), jwt: st.jwt },
      online: collab.onlineCount(),
      fileCount: fileManager.list().length,
      dataDir: config.dataPath
    });
  });

  app.get('/api/files', (req, res) => {
    const st = ds.status();
    res.json({
      files: fileManager.list().map((m) => ({
        id: m.id, name: m.name, ext: m.ext, size: m.size,
        mtime: m.mtime, createdAt: m.createdAt, version: m.version,
        editing: { count: collab.editingCount(m.id), users: collab.editingUsers(m.id) }
      })),
      ds: { available: st.available, url: ds.publicDsUrl() }
    });
  });

  app.get('/api/files/:id/meta', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    res.json({
      file: {
        id: meta.id, name: meta.name, ext: meta.ext, size: meta.size,
        mtime: meta.mtime, createdAt: meta.createdAt, version: meta.version
      },
      editing: { count: collab.editingCount(meta.id), users: collab.editingUsers(meta.id) }
    });
  });

  /* ---------- 新建 / 重命名 / 删除 / 备份 ---------- */
  app.post('/api/files/create', (req, res) => {
    const b = req.body || {};
    const ext = String(b.ext || b.type || '').toLowerCase().replace(/^\./, '');
    if (!fileManager.FIRST_CLASS.includes(ext)) {
      return res.status(400).json({ error: `只能新建 ${fileManager.FIRST_CLASS.join(' / ')} 文档` });
    }
    try {
      const meta = fileManager.create(String(b.name || ''), ext);
      res.json({ file: meta });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/files/:id/rename', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    try {
      const updated = fileManager.rename(id, String((req.body || {}).name || ''));
      ds.syncTitle(updated).catch(() => {});
      res.json({ file: updated });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/files/:id', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    const busy = collab.editingCount(meta.id);
    if (busy > 0) return res.status(409).json({ error: `正在被 ${busy} 人编辑，请先关闭该文档再删除` });
    fileManager.remove(id);
    res.json({ ok: true });
  });

  app.get('/api/files/:id/backups', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const list = fileManager.listBackups(id);
    if (list === null) return res.status(404).json({ error: '文件不存在' });
    res.json({ backups: list });
  });

  app.post('/api/files/:id/backups/restore', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    if (collab.editingCount(meta.id) > 0) {
      return res.status(409).json({ error: '正在被编辑，无法恢复备份，请先关闭该文档' });
    }
    try {
      const updated = fileManager.restoreBackup(meta, String((req.body || {}).file || ''));
      res.json({ file: updated });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  /* ---------- 下载（供用户与 Document Server 使用） ---------- */
  app.get('/api/files/:id/download', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    let p;
    try { p = fileManager.resolvePath(meta); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!fs.existsSync(p)) return res.status(404).json({ error: '文件不存在' });
    res.setHeader('Content-Type', MIME[meta.ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.name, req.query.dl === '1'));
    fs.createReadStream(p).pipe(res);
  });

  /* ---------- OnlyOffice 集成 ---------- */
  app.post('/api/files/:id/editor-config', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    const st = ds.status();
    if (!st.available) {
      return res.status(503).json({
        error: '编辑引擎（ONLYOFFICE Document Server）未连接。请先安装并启动它，详见 README。',
        ds: { available: false }
      });
    }
    const user = editorUserFromBody(req.body);
    const mode = (req.body || {}).mode === 'review' ? 'review' : 'edit';
    const cfg = ds.buildEditorConfig(meta, user, { type: (req.body || {}).type, lang: 'zh-CN', mode });
    res.json({ config: cfg, ds: { url: ds.publicDsUrl(), available: true }, user });
  });

  app.post('/api/files/:id/forcesave', async (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const meta = fileManager.get(id);
    if (!meta) return res.status(404).json({ error: '文件不存在' });
    const result = await ds.forcesave(meta);
    res.json(result);
  });

  app.post('/api/onlyoffice/callback', async (req, res) => {
    let body = req.body || {};
    const st = ds.status();
    if (st.jwtSecret && body.token) {
      try {
        body = jwt.verify(body.token, st.jwtSecret); // DS 将整个回调包在 token 里
      } catch (e) {
        console.warn('[onlyoffice] 回调 JWT 校验失败:', e.message);
        return res.json({ error: 1 });
      }
    }
    const { key, status, url } = body;
    try {
      if (status === 1) {
        // 有用户断开编辑会话时，主动触发一次 forcesave，尽快落盘
        if (Array.isArray(body.actions) && body.actions.some((a) => a && a.type === 0)) {
          const meta = fileManager.findByKey(key);
          if (meta) ds.forcesave(meta).catch(() => {});
        }
      } else if (status === 2 || status === 3 || status === 6 || status === 7) {
        const result = await ds.applySavedCallback(key, url);
        return res.json(result);
      }
      res.json({ error: 0 });
    } catch (e) {
      console.error('[onlyoffice] 回调处理异常:', e);
      res.json({ error: 1 });
    }
  });

  /* ---------- 问卷 ---------- */
  app.get('/api/surveys', (req, res) => {
    res.json({ surveys: surveys.list(String(req.query.userId || '')) });
  });

  app.post('/api/surveys', (req, res) => {
    const b = req.body || {};
    try {
      const survey = surveys.create({
        title: b.title,
        questions: b.questions,
        user: { id: b.userId, name: b.userName }
      });
      res.json({ survey });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/surveys/:id', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    const view = surveys.get(id, String(req.query.userId || ''));
    if (!view) return res.status(404).json({ error: '问卷不存在' });
    res.json({ survey: view });
  });

  app.post('/api/surveys/:id/submit', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    try {
      res.json(surveys.submit(id, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/surveys/:id', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    try {
      const ok = surveys.remove(id, String(req.query.userId || ''));
      if (!ok) return res.status(404).json({ error: '问卷不存在' });
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  app.get('/api/surveys/:id/export', (req, res) => {
    const id = requireValidId(req, res); if (!id) return;
    let csv;
    try {
      csv = surveys.csv(id, String(req.query.userId || ''));
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    if (!csv) return res.status(404).json({ error: '问卷不存在' });
    const survey = surveys.get(id, String(req.query.userId || ''));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(`${survey ? survey.title : '问卷'}-答卷.csv`.replace(/[\\/:*?"<>|]/g, '_'), true));
    res.send(csv);
  });

  /* ---------- 杂项 ---------- */
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

  // multer 等中间件错误兜底
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
  });
}

let _port = null;
function state_port() { return _port; }
function setPort(p) { _port = p; }

module.exports = { registerRoutes, setPort };
