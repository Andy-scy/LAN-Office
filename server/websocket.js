'use strict';
/**
 * WebSocket（Socket.IO）：只承载 presence（在线用户/正在编辑文件/昵称颜色）。
 * 文档内容的实时协同由 OnlyOffice 引擎自己的通道完成。
 */
const crypto = require('crypto');
const { Server } = require('socket.io');
const collab = require('./collaboration');
const fileManager = require('./fileManager');

const ID_RE = /^[0-9a-f-]{8,64}$/i;

function attach(httpServer) {
  const io = new Server(httpServer, { maxHttpBufferSize: 1e6 });

  io.on('connection', (sock) => {
    const auth = sock.handshake.auth || {};
    const userId = (typeof auth.userId === 'string' && ID_RE.test(auth.userId))
      ? auth.userId
      : crypto.randomUUID();
    const name = collab.sanitizeName(auth.name) || collab.randomName();

    collab.registerSocket(sock.id, userId, name);

    sock.emit('init', {
      userId,
      you: { id: userId, name, color: collab.colorFor(userId) },
      snapshot: collab.snapshot()
    });

    sock.on('presence:join', (fileId) => {
      if (typeof fileId === 'string' && fileId.length < 64 && fileManager.get(fileId)) {
        collab.join(fileId, userId);
      }
    });

    sock.on('presence:leave', (fileId) => {
      if (typeof fileId === 'string' && fileId.length < 64) {
        collab.leave(fileId, userId);
      }
    });

    sock.on('user:rename', (raw) => {
      const name = collab.sanitizeName(raw) || collab.randomName();
      collab.rename(userId, name);
      sock.emit('you', { id: userId, name, color: collab.colorFor(userId) });
    });

    sock.on('disconnect', () => collab.unregisterSocket(sock.id));
  });

  collab.on('change', () => {
    io.emit('presence:update', collab.snapshot());
  });

  return io;
}

module.exports = { attach };
