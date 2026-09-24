'use strict';
/**
 * 分组与权限：
 * - 设备身份：每台浏览器一个 userId（localStorage），服务端记录其角色（教师/学生）与所在分组
 * - 教师凭管理密码解锁（密码在 config/config.json 的 teacherPassword，启动横幅会提示）
 * - 学生凭"分组加入码"加入某个组；文件可归入某个组
 * - 可见性：其他组的文档可设为"隐藏"或"只读"；未归组文档 = 公共（人人可编辑）
 * - settings.accessEnabled=false 时整个体系关闭，回到"人人可操作"的旧行为
 * 注意：这是面向局域网信任环境的防误操作设计，不是抵御恶意攻击的认证体系。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

let file = null;
let cache = null;

const DEFAULTS = {
  groups: [],          // [{id, name, code, createdAt}]
  devices: {},         // { [userId]: { role: 'teacher'|'student'|null, groupId: string|null, name: string } }
  settings: {
    accessEnabled: false,
    studentVisibility: 'hidden' // 'hidden' | 'readonly'
  }
};

function init() {
  file = path.join(config.dataPath, 'access.json');
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    cache = null;
  }
  if (!cache || typeof cache !== 'object') cache = JSON.parse(JSON.stringify(DEFAULTS));
  cache.groups = Array.isArray(cache.groups) ? cache.groups : [];
  cache.devices = cache.devices && typeof cache.devices === 'object' ? cache.devices : {};
  cache.settings = Object.assign({}, DEFAULTS.settings, cache.settings || {});
}

function save() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const ID_RE = /^[0-9a-f-]{8,64}$/i;

function cleanDeviceId(userId) {
  return ID_RE.test(String(userId || '')) ? String(userId) : null;
}

function getDevice(userId) {
  const id = cleanDeviceId(userId);
  if (!id) return { role: null, groupId: null, name: '' };
  const d = cache.devices[id];
  return {
    role: d && d.role === 'teacher' ? 'teacher' : (d && d.role === 'student' ? 'student' : null),
    groupId: (d && d.groupId) || null,
    name: (d && d.name) || ''
  };
}

function enabled() { return !!cache.settings.accessEnabled; }

function settings() {
  return {
    accessEnabled: cache.settings.accessEnabled,
    studentVisibility: cache.settings.studentVisibility
  };
}

function setSettings(patch, userId) {
  if (!isTeacher(userId)) {
    const e = new Error('仅教师可修改设置');
    e.status = 403;
    throw e;
  }
  if (patch && typeof patch === 'object') {
    if (typeof patch.accessEnabled === 'boolean') cache.settings.accessEnabled = patch.accessEnabled;
    if (patch.studentVisibility === 'hidden' || patch.studentVisibility === 'readonly') {
      cache.settings.studentVisibility = patch.studentVisibility;
    }
  }
  save();
  return settings();
}

/** 教师解锁：密码正确则把该设备标记为教师 */
function authTeacher(userId, password) {
  const id = cleanDeviceId(userId);
  if (!id) {
    const e = new Error('非法设备身份');
    e.status = 400;
    throw e;
  }
  if (String(password || '') !== String(config.teacherPassword || '1234')) {
    const e = new Error('教师密码不正确');
    e.status = 401;
    throw e;
  }
  cache.devices[id] = Object.assign({ role: 'teacher', groupId: null, name: '' }, cache.devices[id], { role: 'teacher' });
  save();
  return getDevice(id);
}

function joinGroup(userId, code) {
  const id = cleanDeviceId(userId);
  if (!id) {
    const e = new Error('非法设备身份');
    e.status = 400;
    throw e;
  }
  const group = cache.groups.find((g) => String(g.code) === String(code || '').trim());
  if (!group) {
    const e = new Error('加入码不正确，请向老师索取');
    e.status = 404;
    throw e;
  }
  cache.devices[id] = Object.assign({ role: 'student', groupId: null, name: '' }, cache.devices[id], {
    role: 'student',
    groupId: group.id
  });
  save();
  return { device: getDevice(id), group: { id: group.id, name: group.name } };
}

function leaveGroup(userId) {
  const id = cleanDeviceId(userId);
  if (!id) return;
  const d = cache.devices[id];
  if (d) {
    d.role = null;
    d.groupId = null;
    save();
  }
}

/* ---------- 分组管理（教师） ---------- */

function isTeacher(userId) {
  const d = getDevice(userId);
  return d.role === 'teacher';
}

function requireTeacher(userId) {
  if (!isTeacher(userId)) {
    const e = new Error('该操作仅教师可执行');
    e.status = 403;
    throw e;
  }
}

function listGroups(userId) {
  requireTeacher(userId);
  return cache.groups.map((g) => ({ id: g.id, name: g.name, code: g.code, createdAt: g.createdAt }));
}

/** 学生端加入界面用的公开列表：只有组名，不含加入码 */
function listGroupNames() {
  return cache.groups.map((g) => ({ id: g.id, name: g.name }));
}

function createGroup(name, userId) {
  requireTeacher(userId);
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
  if (!clean) {
    const e = new Error('组名不能为空');
    e.status = 400;
    throw e;
  }
  if (cache.groups.some((g) => g.name === clean)) {
    const e = new Error('已存在同名分组');
    e.status = 400;
    throw e;
  }
  let code;
  do {
    code = String(crypto.randomInt(1000, 10000)); // 4 位数字加入码
  } while (cache.groups.some((g) => g.code === code));
  const group = { id: crypto.randomUUID(), name: clean, code, createdAt: Date.now() };
  cache.groups.push(group);
  save();
  return group;
}

function removeGroup(id, userId) {
  requireTeacher(userId);
  const i = cache.groups.findIndex((g) => g.id === String(id || ''));
  if (i < 0) return false;
  cache.groups.splice(i, 1);
  // 解散组后，把该组成员清空；文件由 fileManager.clearGroup 复位为公共
  for (const key of Object.keys(cache.devices)) {
    if (cache.devices[key].groupId === id) cache.devices[key].groupId = null;
  }
  save();
  return true;
}

function groupName(groupId) {
  const g = cache.groups.find((x) => x.id === groupId);
  return g ? g.name : null;
}

/* ---------- 文件访问判定 ---------- */

/**
 * 返回 { view, edit, reason }：
 *  - accessEnabled=false → 人人可看可编（旧行为）
 *  - 教师 → 全部可看可编
 *  - meta.groupId 为空 → 公共文档
 *  - 学生：本组可编；他组按设置隐藏或只读；未加入组 → 公共文档只读
 */
function fileAccess(userId, meta) {
  if (!enabled()) return { view: true, edit: true };
  const d = getDevice(userId);
  if (d.role === 'teacher') return { view: true, edit: true };
  const publicDoc = !meta.groupId;
  if (d.role === 'student') {
    if (publicDoc) return { view: true, edit: true };
    if (meta.groupId === d.groupId) return { view: true, edit: true };
    if (cache.settings.studentVisibility === 'readonly') return { view: true, edit: false };
    return { view: false, edit: false };
  }
  // 未加入组的访客：公共文档只读，分组文档不可见
  if (publicDoc) return { view: true, edit: false };
  return { view: false, edit: false };
}

/** 列表过滤：返回 {items:[{meta, access}], settings} */
function filterList(userId, metas) {
  const items = [];
  for (const meta of metas) {
    const a = fileAccess(userId, meta);
    if (!a.view) continue;
    items.push({
      meta,
      access: a,
      groupName: meta.groupId ? groupName(meta.groupId) : null
    });
  }
  return items;
}

/** 文件归组/解除归组（教师），返回是否发生了变化 */
function setFileGroup(userId, meta, groupId) {
  requireTeacher(userId);
  if (groupId === null || groupId === '' || groupId === undefined) {
    meta.groupId = null;
    return true;
  }
  if (!cache.groups.some((g) => g.id === String(groupId))) {
    const e = new Error('分组不存在');
    e.status = 400;
    throw e;
  }
  meta.groupId = String(groupId);
  return true;
}

/** 解散分组时复位该组文件 */
function clearGroupFiles(groupId, clearFn) {
  if (typeof clearFn === 'function') clearFn(groupId);
}

module.exports = {
  init, save,
  enabled, settings, setSettings,
  getDevice, authTeacher, joinGroup, leaveGroup,
  isTeacher, requireTeacher,
  listGroups, listGroupNames, createGroup, removeGroup, groupName,
  fileAccess, filterList, setFileGroup,
  cleanDeviceId
};
