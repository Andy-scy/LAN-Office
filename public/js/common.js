'use strict';
/* 公共：用户身份 / Socket / API 封装 / 格式化 */
(function () {
  const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#EC4899', '#84CC16'];
  const ADJ = ['Blue', 'Green', 'Red', 'Silver', 'Golden', 'Purple', 'Crimson', 'Aqua', 'Amber', 'Ivory'];
  const ANI = ['Fox', 'Cat', 'Panda', 'Wolf', 'Bear', 'Tiger', 'Koala', 'Deer', 'Falcon', 'Dolphin', 'Owl', 'Rabbit'];
  const USER_KEY = 'lanoffice.user.v1';
  const DEVICE_KEY = 'lanoffice.device.v1';

  function randomName() {
    return ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + ANI[Math.floor(Math.random() * ANI.length)];
  }

  /* 生成 UUID 格式的设备身份：
     crypto.randomUUID 仅在安全上下文（https/localhost）可用，
     局域网 IP 走 http 时不存在 —— 这里用 getRandomValues 兜底（全环境可用） */
  function randomId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (_) { /* 继续兜底 */ }
    }
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(b);
    } else {
      for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  const UUID_RE = /^[0-9a-f-]{8,64}$/i;

  function guessDeviceKind() {
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return '平板';
    if (/Mobi|iPhone|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return '手机';
    return '电脑';
  }

  function randomDeviceName() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let tail = '';
    for (let i = 0; i < 3; i++) tail += chars[Math.floor(Math.random() * chars.length)];
    return guessDeviceKind() + '-' + tail;
  }

  function colorFor(id) {
    const s = String(id || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function loadUser() {
    let u = null;
    let fresh = false;
    try { u = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) { /* 忽略 */ }
    if (!u || typeof u !== 'object') { u = {}; fresh = true; }
    if (typeof u.id !== 'string' || !UUID_RE.test(u.id)) {
      // 迁移：修复在非安全上下文（http://局域网IP）下生成的非法 ID
      u.id = randomId();
      fresh = true;
    }
    if (typeof u.name !== 'string' || !u.name) {
      u.name = randomName();
      fresh = true;
    }
    if (fresh) {
      try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (_) { /* 忽略 */ }
    }
    return u;
  }

  const user = loadUser();

  function saveUser() {
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (_) { /* 忽略 */ }
  }

  let device = null;
  try { device = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (_) { /* 忽略 */ }
  if (!device || typeof device.name !== 'string' || !device.name) {
    device = { name: randomDeviceName() };
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(device)); } catch (_) { /* 忽略 */ }
  }

  function saveDevice() {
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(device)); } catch (_) { /* 忽略 */ }
  }

  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = Date.now() - ts;
    const min = 60000, hour = 3600000, day = 86400000;
    const pad = (n) => String(n).padStart(2, '0');
    if (diff < min) return '刚刚';
    if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
    if (diff < day) return Math.floor(diff / hour) + ' 小时前';
    if (diff < 2 * day) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.getFullYear() === new Date().getFullYear()) {
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  const TYPE_MAP = {
    docx: { label: 'Word', letter: 'W', cls: 'word' }, doc: { label: 'Word', letter: 'W', cls: 'word' },
    odt: { label: 'ODT', letter: 'W', cls: 'word' }, txt: { label: '文本', letter: 'T', cls: 'word' },
    xlsx: { label: 'Excel', letter: 'X', cls: 'excel' }, xls: { label: 'Excel', letter: 'X', cls: 'excel' },
    ods: { label: 'ODS', letter: 'X', cls: 'excel' }, csv: { label: 'CSV', letter: 'X', cls: 'excel' },
    pptx: { label: 'PPT', letter: 'P', cls: 'ppt' }, ppt: { label: 'PPT', letter: 'P', cls: 'ppt' },
    odp: { label: 'ODP', letter: 'P', cls: 'ppt' },
    pdf: { label: 'PDF', letter: 'A', cls: 'pdf' }
  };

  function typeMeta(ext) {
    return TYPE_MAP[String(ext || '').toLowerCase()] || { label: '文件', letter: '?', cls: 'word' };
  }

  async function api(path, opts) {
    const merged = Object.assign({}, opts);
    merged.headers = Object.assign(
      { 'Content-Type': 'application/json', 'x-lan-user': user.id },
      (opts && opts.headers) || {}
    );
    const r = await fetch(path, merged);
    let data = null;
    try { data = await r.json(); } catch (_) { /* 非 JSON */ }
    if (!r.ok) {
      const err = new Error((data && data.error) || ('请求失败 (' + r.status + ')'));
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const socket = io({ auth: { userId: user.id, name: user.name, device: device.name } });

  /* 设备类型：与 <head> 内联脚本同源逻辑（优先读 data-device，兜底自行嗅探） */
  function detectDeviceKind() {
    const d = document.documentElement.dataset.device;
    if (d === 'mobile' || d === 'tablet' || d === 'desktop') return d;
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))) return 'tablet';
    if (/Mobi|iPhone|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return 'mobile';
    return 'desktop';
  }
  const deviceKind = detectDeviceKind();

  window.App = {
    PALETTE, user, device, deviceKind, saveUser, saveDevice, randomName, randomDeviceName, colorFor, fmtSize, fmtTime, typeMeta, api, socket,
    escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
  };

  /* ---------- Toast ---------- */
  let toastRoot = null;
  function toast(msg, type) {
    if (!toastRoot) {
      toastRoot = document.getElementById('toast-root');
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }
  window.toast = toast;

  /* ---------- 简易弹窗 ---------- */
  function modal(build) {
    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const box = document.createElement('div');
    box.className = 'modal';
    mask.appendChild(box);
    root.appendChild(mask);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      mask.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
    build(box, close);
    return close;
  }
  window.modal = modal;

  function avatarEl(p) {
    const el = document.createElement('span');
    el.className = 'avatar';
    el.style.background = p.color || App.colorFor(p.id);
    el.textContent = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
    el.title = p.device ? `${p.name}（${p.device}）` : (p.name || '');
    return el;
  }

  /* 触屏底部操作面板（手机 UI 用它替代悬停图标按钮） */
  function bottomSheet(title, actions) {
    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    const close = () => mask.remove();
    const panel = document.createElement('div');
    panel.className = 'sheet';
    if (title) {
      const t = document.createElement('div');
      t.className = 'sheet-title';
      t.textContent = title;
      panel.appendChild(t);
    }
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'sheet-item' + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { close(); if (a.onClick) a.onClick(); });
      panel.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'sheet-item sheet-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', close);
    panel.appendChild(cancel);
    mask.appendChild(panel);
    root.appendChild(mask);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  }
  window.bottomSheet = bottomSheet;

  /* ---------- 身份：教师登录 / 加入分组 ---------- */
  const me = { isTeacher: false, group: null, device: { role: null }, teacher: null, settings: { accessEnabled: false } };

  async function refreshMe() {
    try {
      const r = await api('/api/me');
      me.isTeacher = r.isTeacher;
      me.group = r.group;
      me.device = r.device;
      me.teacher = r.teacher;
      me.settings = r.settings;
      window.dispatchEvent(new CustomEvent('me:updated', { detail: me }));
    } catch (_) { /* 服务未起时静默 */ }
    return me;
  }

  function teacherText() {
    return me.teacher && (me.teacher.name || me.teacher.dname)
      ? (me.teacher.name || '未命名') + (me.teacher.dname ? '（' + me.teacher.dname + '）' : '')
      : '暂无（可用教师密码登录）';
  }

  /** 加入分组弹窗：学生输加入码；老师也可在这里直接用密码登录（原教师自动退出） */
  function joinGroup(onOk) {
    modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '👥 加入分组';
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 4;
      input.placeholder = '输入老师提供的 4 位加入码';
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = '加入后只能看到本组的文档和公共文档。当前教师：' + teacherText();
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '取消';
      cancel.onclick = close;
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = '加入';
      ok.onclick = async () => {
        try {
          const r = await api('/api/auth/group', {
            method: 'POST',
            body: JSON.stringify({ code: input.value, userId: user.id, userName: user.name, device: device.name })
          });
          close();
          window.toast('已加入分组：' + r.group.name, 'ok');
          await refreshMe();
          if (onOk) onOk({ type: 'group' });
        } catch (e) {
          tip.textContent = e.message;
          tip.style.color = '#dc2626';
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });

      const div = document.createElement('div');
      div.className = 'sheet-divider';
      div.textContent = '我是老师';
      const input2 = document.createElement('input');
      input2.type = 'password';
      input2.placeholder = '教师管理密码（登录后本机成为教师）';
      const tip2 = document.createElement('div');
      tip2.className = 'tip';
      tip2.textContent = '登录后本机成为教师身份，之前登录的教师电脑会自动退出。';
      const ok2 = document.createElement('button');
      ok2.className = 'btn';
      ok2.style.width = '100%';
      ok2.textContent = '👩‍🏫 教师登录';
      ok2.onclick = async () => {
        try {
          await api('/api/auth/teacher', {
            method: 'POST',
            body: JSON.stringify({ password: input2.value, userId: user.id, userName: user.name, device: device.name })
          });
          close();
          window.toast('已以教师身份登录（原教师电脑已自动退出）', 'ok');
          await refreshMe();
          if (onOk) onOk({ type: 'teacher' });
        } catch (e) {
          tip2.textContent = e.message;
          tip2.style.color = '#dc2626';
        }
      };
      input2.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok2.click(); });

      row.append(cancel, ok);
      box.append(h, input, tip, row, div, input2, tip2, ok2);
      setTimeout(() => input.focus(), 30);
    });
  }

  /** 教师登录弹窗（独立入口） */
  function teacherLogin(onOk) {
    modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '👩‍🏫 教师登录';
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = '教师管理密码';
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = '登录后本机成为教师身份，之前登录的教师电脑会自动退出。当前教师：' + teacherText();
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '取消';
      cancel.onclick = close;
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = '登录';
      ok.onclick = async () => {
        try {
          await api('/api/auth/teacher', {
            method: 'POST',
            body: JSON.stringify({ password: input.value, userId: user.id, userName: user.name, device: device.name })
          });
          close();
          window.toast('已以教师身份登录（原教师电脑已自动退出）', 'ok');
          await refreshMe();
          if (onOk) onOk();
        } catch (e) {
          tip.textContent = e.message;
          tip.style.color = '#dc2626';
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
      row.append(cancel, ok);
      box.append(h, input, tip, row);
      setTimeout(() => input.focus(), 30);
    });
  }

  App.me = me;
  App.refreshMe = refreshMe;
  window.teacherLogin = teacherLogin;
  window.joinGroup = joinGroup;
  refreshMe();
  window.avatarEl = avatarEl;
})();
