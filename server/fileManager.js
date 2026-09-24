'use strict';
/**
 * 文件管理：所有文件以 UUID 为索引存放在 data/documents/ 下。
 * 客户端永远只传 UUID，不传路径 —— 从设计上杜绝路径穿越。
 * 元数据持久化在 data/documents/index.json（原子写入）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// 第一优先格式（可新建空白模板）
const FIRST_CLASS = ['docx', 'xlsx', 'pptx'];
// 可编辑格式
const EDITABLE = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'csv', 'txt'];
// 仅查看格式
const VIEWABLE = ['pdf'];
const ACCEPTED = EDITABLE.concat(VIEWABLE);

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

let documentsDir, backupsDir, tempDir, versionsDir, indexPath;

let metas = []; // [{id,name,ext,size,mtime,createdAt,version}]

/* ---------- 路径与初始化 ---------- */

function init() {
  documentsDir = path.join(config.dataPath, 'documents');
  backupsDir = path.join(config.dataPath, 'backups');
  tempDir = path.join(config.dataPath, 'temp');
  versionsDir = path.join(config.dataPath, 'versions');
  for (const d of [config.dataPath, documentsDir, backupsDir, tempDir, versionsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  indexPath = path.join(documentsDir, 'index.json');
  reconcile();
}

function loadIndex() {
  try {
    const arr = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (Array.isArray(arr)) metas = arr;
  } catch (_) { /* 保持现状 */ }
}

function saveIndex() {
  const tmp = path.join(documentsDir, '.index.tmp');
  fs.writeFileSync(tmp, JSON.stringify(metas, null, 2), 'utf8');
  fs.renameSync(tmp, indexPath);
}

/** 把用户手动放进 data/documents 的文件登记进来 */
function reconcile() {
  loadIndex();
  const known = new Set(metas.map((m) => m.name));
  let changed = false;
  for (const name of fs.readdirSync(documentsDir)) {
    const full = path.join(documentsDir, name);
    if (name === 'index.json' || name.startsWith('.')) continue;
    const ext = extOf(name);
    if (!ACCEPTED.includes(ext)) continue;
    if (known.has(name)) continue;
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (!st.isFile()) continue;
    metas.push({
      id: crypto.randomUUID(),
      name,
      ext,
      size: st.size,
      mtime: st.mtimeMs,
      createdAt: st.mtimeMs,
      version: 1
    });
    changed = true;
  }
  if (changed) saveIndex();
}

/* ---------- 文件名处理 ---------- */

function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i > 0 ? String(name).slice(i + 1).toLowerCase() : '';
}

/** 清洗文件名：去除非法字符、Windows 保留名、控制字符，限制长度 */
function sanitizeFileName(raw) {
  let name = String(raw || '').normalize('NFC');
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/[\\/:*?"<>|]/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/^[.\s]+/, '');
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : (dot === 0 ? '未命名' : name);
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : (dot === 0 ? name.slice(1).toLowerCase() : '');
  if (dot === 0 && base === '未命名' && !ext) return null;
  base = base.replace(/[.\s]+$/, '').trim();
  if (base.length > 120) base = base.slice(0, 120).trim();
  if (RESERVED_NAME.test(base)) base = '_' + base;
  if (!base) base = '未命名';
  return ext ? `${base}.${ext}` : base;
}

function uniqueName(desired) {
  let name = desired;
  const ext = extOf(name);
  const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
  let i = 2;
  while (metas.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    name = `${base} (${i++})${ext ? '.' + ext : ''}`;
  }
  return name;
}

/* ---------- 元数据操作 ---------- */

function docKey(meta) { return `${meta.id}_${meta.version}`; }

function list() {
  return metas.slice().sort((a, b) => b.mtime - a.mtime);
}

function get(id) {
  return metas.find((m) => m.id === id) || null;
}

function findByKey(key) {
  if (typeof key !== 'string') return null;
  const i = key.lastIndexOf('_');
  if (i <= 0) return null;
  const meta = get(key.slice(0, i));
  if (meta && docKey(meta) === key) return meta;
  return null;
}

function resolvePath(meta) {
  // meta.name 已在写入前清洗过（无路径分隔符），再防御性校验一次
  if (/[/\\]/.test(meta.name) || meta.name.includes('..')) throw new Error('非法文件名');
  const p = path.join(documentsDir, meta.name);
  if (path.dirname(p) !== documentsDir) throw new Error('非法文件名');
  return p;
}

function backupFile(meta) {
  const src = resolvePath(meta);
  if (!fs.existsSync(src)) return null;
  const dir = path.join(backupsDir, meta.id);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  const ext = meta.ext ? '.' + meta.ext : '';
  const base = meta.name.slice(0, meta.name.length - ext.length);
  // 同一毫秒内多次备份也不会互相覆盖
  let dest = path.join(dir, `${base}_${stamp}${ext}`);
  let i = 2;
  while (fs.existsSync(dest)) dest = path.join(dir, `${base}_${stamp}_${i++}${ext}`);
  fs.copyFileSync(src, dest);
  pruneBackups(dir);
  return dest;
}

function pruneBackups(dir) {
  const max = Math.max(1, Number(config.backup.maxPerFile) || 30);
  let files = [];
  try { files = fs.readdirSync(dir).map((n) => { const st = fs.statSync(path.join(dir, n)); return { n, m: st.mtimeMs }; }); } catch (_) { return; }
  files.sort((a, b) => b.m - a.m);
  for (const f of files.slice(max)) {
    try { fs.rmSync(path.join(dir, f.n)); } catch (_) { /* 忽略 */ }
  }
}

function listBackups(id) {
  const meta = get(id);
  if (!meta) return null;
  const dir = path.join(backupsDir, meta.id);
  let out = [];
  try {
    out = fs.readdirSync(dir).map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return { file: n, size: st.size, mtime: st.mtimeMs };
    });
  } catch (_) { out = []; }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** 上传完成：把 temp 中的文件落到 documents/ 并登记元数据 */
function addUpload(tmpPath, originalName, providedName) {
  let name = sanitizeFileName(providedName || originalName);
  if (!name) throw new Error('文件名无效');
  let ext = extOf(name);
  if (!ACCEPTED.includes(ext)) {
    // 用户可能只输出了主文件名，补上原始扩展名
    const origExt = extOf(originalName || '');
    if (ACCEPTED.includes(origExt) && !ext) {
      name = `${name}.${origExt}`;
      ext = origExt;
    } else {
      throw new Error(`不支持的文件类型 .${ext || '(无扩展名)'}，支持：${ACCEPTED.join(', ')}`);
    }
  }
  const finalName = uniqueName(name);
  const dest = path.join(documentsDir, finalName);
  fs.renameSync(tmpPath, dest);
  const st = fs.statSync(dest);
  const meta = {
    id: crypto.randomUUID(),
    name: finalName,
    ext,
    size: st.size,
    mtime: st.mtimeMs,
    createdAt: Date.now(),
    version: 1
  };
  metas.push(meta);
  saveIndex();
  return meta;
}

/** 新建空白文档（从内置模板复制） */
function create(name, ext) {
  if (!FIRST_CLASS.includes(ext)) throw new Error(`只能新建 ${FIRST_CLASS.join(' / ')} 文档`);
  let base = sanitizeFileName(name || '');
  if (base && !extOf(base)) base = `${base}.${ext}`;
  if (!base) base = defaultNewName(ext);
  if (extOf(base) !== ext) throw new Error('文件类型与扩展名不一致');
  const finalName = uniqueName(base);
  const template = path.join(__dirname, 'templates', `blank.${ext}`);
  const dest = path.join(documentsDir, finalName);
  fs.copyFileSync(template, dest);
  const st = fs.statSync(dest);
  const meta = {
    id: crypto.randomUUID(),
    name: finalName,
    ext,
    size: st.size,
    mtime: st.mtimeMs,
    createdAt: Date.now(),
    version: 1
  };
  metas.push(meta);
  saveIndex();
  return meta;
}

function defaultNewName(ext) {
  const label = { docx: '新建文档', xlsx: '新建表格', pptx: '新建演示' }[ext] || '未命名';
  return `${label}.${ext}`;
}

function rename(id, newName) {
  const meta = get(id);
  if (!meta) return null;
  let name = sanitizeFileName(newName);
  if (!name) throw new Error('文件名无效');
  if (!extOf(name)) name = `${name}.${meta.ext}`; // 未写扩展名则保留原扩展名
  const ext = extOf(name);
  if (!ACCEPTED.includes(ext)) throw new Error(`不支持的文件类型 .${ext}`);
  if (metas.some((m) => m.id !== id && m.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('已存在同名文件');
  }
  const oldPath = resolvePath(meta);
  const newPath = path.join(documentsDir, name);
  if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
  meta.name = name;
  meta.ext = ext;
  meta.mtime = Date.now();
  saveIndex();
  return meta;
}

function remove(id) {
  const meta = get(id);
  if (!meta) return false;
  try { fs.rmSync(resolvePath(meta), { force: true }); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(path.join(backupsDir, meta.id), { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  metas = metas.filter((m) => m.id !== id);
  saveIndex();
  return true;
}

/** OnlyOffice 保存回调：备份旧版 → 原子替换 → 更新元数据（必要时版本+1 换 key） */
function applySavedFile(meta, savedPath) {
  const st = fs.statSync(savedPath);
  if (st.size <= 0) throw new Error('保存的文件为空');
  const p = resolvePath(meta);
  const existed = fs.existsSync(p);
  if (existed) backupFile(meta);
  fs.renameSync(savedPath, p);
  meta.size = st.size;
  meta.mtime = Date.now();
  meta.savedAt = Date.now();
  saveIndex();
  return meta;
}

/** 保存成功后更新版本 key：仅当房间无人编辑时更换（保持在线会话连续） */
function bumpVersionIfIdle(meta, isIdle) {
  if (isIdle) {
    meta.version = (meta.version || 1) + 1;
    saveIndex();
  }
}

function restoreBackup(meta, backupName) {
  const name = String(backupName || '');
  if (!name || name.split(/[\\/]/).includes('..')) throw new Error('非法备份文件名');
  const dir = path.join(backupsDir, meta.id);
  const src = path.resolve(dir, name);
  if (src !== dir && !src.startsWith(dir + path.sep)) throw new Error('非法备份文件名');
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error('备份不存在');
  const p = resolvePath(meta);
  if (fs.existsSync(p)) backupFile(meta);
  fs.copyFileSync(src, p);
  const st = fs.statSync(p);
  meta.size = st.size;
  meta.mtime = Date.now();
  meta.version = (meta.version || 1) + 1;
  saveIndex();
  return meta;
}

/** 文件归组 / 解除归组（分组权限功能使用） */
function setFileGroupById(id, groupId) {
  const meta = get(id);
  if (!meta) return null;
  meta.groupId = groupId || null;
  saveIndex();
  return meta;
}

/** 某分组被解散时，把该组全部文件复位为公共（返回复位数量） */
function clearGroup(groupId) {
  let n = 0;
  for (const m of metas) {
    if (m.groupId && m.groupId === String(groupId)) {
      m.groupId = null;
      n++;
    }
  }
  if (n) saveIndex();
  return n;
}

function documentTypeInfo(ext) {
  const e = String(ext || '').toLowerCase();
  let documentType = 'word';
  let editable = EDITABLE.includes(e);
  if (['xlsx', 'xls', 'ods', 'csv'].includes(e)) documentType = 'cell';
  else if (['pptx', 'ppt', 'odp'].includes(e)) documentType = 'slide';
  else documentType = 'word';
  return { documentType, editable, viewOnly: !editable };
}

function dirs() { return { documentsDir, backupsDir, tempDir, versionsDir }; }

module.exports = {
  FIRST_CLASS, EDITABLE, VIEWABLE, ACCEPTED,
  init, list, get, findByKey, resolvePath, docKey,
  addUpload, create, rename, remove,
  applySavedFile, bumpVersionIfIdle,
  backupFile, listBackups, restoreBackup,
  documentTypeInfo, sanitizeFileName, extOf, uniqueName, dirs,
  setFileGroupById, clearGroup
};
