'use strict';
/**
 * 在线状态（presence）：谁在线、谁正在编辑哪个文件。
 * 只做"存在感"，不涉及文档内容 —— 文档内容协同由 OnlyOffice 引擎负责。
 */
const EventEmitter = require('events');
const crypto = require('crypto');

const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];

const ADJECTIVES = ['Blue', 'Green', 'Red', 'Silver', 'Golden', 'Purple', 'Crimson', 'Aqua', 'Amber', 'Ivory'];
const ANIMALS = ['Fox', 'Cat', 'Panda', 'Wolf', 'Bear', 'Tiger', 'Koala', 'Deer', 'Falcon', 'Dolphin', 'Owl', 'Rabbit'];

function randomName() {
  const a = ADJECTIVES[crypto.randomInt(ADJECTIVES.length)];
  const b = ANIMALS[crypto.randomInt(ANIMALS.length)];
  return `${a} ${b}`;
}

function colorFor(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 昵称清洗：去控制字符与尖括号，限长 24 */
function sanitizeName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (!n) return '';
  return n.slice(0, 24);
}

class Collaboration extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map();     // fileId -> Map(userId -> {name,color,sockets:Set})
    this.users = new Map();     // userId -> {name,color,sockets:Set}
    this.socketUser = new Map(); // socketId -> userId
  }

  registerSocket(socketId, userId, name) {
    this.socketUser.set(socketId, userId);
    let u = this.users.get(userId);
    if (!u) {
      u = { name, color: colorFor(userId), sockets: new Set() };
      this.users.set(userId, u);
    }
    u.sockets.add(socketId);
    this.emit('change');
  }

  unregisterSocket(socketId) {
    const userId = this.socketUser.get(socketId);
    if (!userId) return;
    this.socketUser.delete(socketId);
    const u = this.users.get(userId);
    if (!u) return;
    u.sockets.delete(socketId);
    if (u.sockets.size === 0) {
      this.users.delete(userId);
      for (const [fid, members] of this.rooms) {
        members.delete(userId);
        if (members.size === 0) this.rooms.delete(fid);
      }
    }
    this.emit('change');
  }

  join(fileId, userId) {
    const u = this.users.get(userId);
    if (!u) return;
    let room = this.rooms.get(fileId);
    if (!room) {
      room = new Map();
      this.rooms.set(fileId, room);
    }
    room.set(userId, u);
    this.emit('change');
  }

  leave(fileId, userId) {
    const room = this.rooms.get(fileId);
    if (!room) return;
    room.delete(userId);
    if (room.size === 0) this.rooms.delete(fileId);
    this.emit('change');
  }

  rename(userId, name) {
    const u = this.users.get(userId);
    if (!u) return;
    u.name = name;
    this.emit('change');
  }

  infoOf(userId) {
    const u = this.users.get(userId);
    return u ? { id: userId, name: u.name, color: u.color } : null;
  }

  editingCount(fileId) {
    const room = this.rooms.get(fileId);
    return room ? room.size : 0;
  }

  editingUsers(fileId) {
    const room = this.rooms.get(fileId);
    if (!room) return [];
    return Array.from(room.entries()).map(([id, u]) => ({ id, name: u.name, color: u.color }));
  }

  onlineCount() { return this.users.size; }

  onlineUsers() {
    return Array.from(this.users.entries()).map(([id, u]) => ({ id, name: u.name, color: u.color }));
  }

  snapshot() {
    const files = {};
    for (const [fid, room] of this.rooms) {
      files[fid] = {
        count: room.size,
        users: Array.from(room.entries()).map(([id, u]) => ({ id, name: u.name, color: u.color }))
      };
    }
    return { files, online: { count: this.users.size, users: this.onlineUsers() } };
  }
}

module.exports = new Collaboration();
module.exports.randomName = randomName;
module.exports.colorFor = colorFor;
module.exports.sanitizeName = sanitizeName;
module.exports.PALETTE = PALETTE;
