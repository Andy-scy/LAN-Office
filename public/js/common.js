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

  /* ---------- 图标系统：统一 24 视图 / 2px 圆头描边，替代 emoji ---------- */
  const ICON_PATHS = {
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pencil: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
    clipboard2: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    chart: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'
  };

  /** 统一图标：icon('download') → 内联 SVG（继承 currentColor） */
  function icon(name, size) {
    const s = size || 16;
    const body = ICON_PATHS[name] || ICON_PATHS.file;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  window.icon = icon;

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
      h.textContent = '加入分组';
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
      ok2.innerHTML = window.icon('shield', 14) + '<span style="margin-left:6px">教师登录</span>';
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
      h.textContent = '教师登录';
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
