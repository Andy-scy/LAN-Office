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
    if (typeof u.id !== 'string' || !u.id) {
      u.id = (crypto.randomUUID && crypto.randomUUID()) || 'u' + Date.now() + Math.random().toString(16).slice(2);
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
  const me = { isTeacher: false, group: null, device: { role: null }, settings: { accessEnabled: false } };

  async function refreshMe() {
    try {
      const r = await api('/api/me');
      me.isTeacher = r.isTeacher;
      me.group = r.group;
      me.device = r.device;
      me.settings = r.settings;
      window.dispatchEvent(new CustomEvent('me:updated', { detail: me }));
    } catch (_) { /* 服务未起时静默 */ }
    return me;
  }

  function teacherLogin(onOk) {
    modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '👩‍🏫 教师登录';
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = '教师管理密码';
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = '密码在服务器启动窗口显示，默认 1234，可在 config/config.json 修改。';
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
          await api('/api/auth/teacher', { method: 'POST', body: JSON.stringify({ password: input.value, userId: user.id }) });
          close();
          window.toast('已以教师身份登录', 'ok');
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
      tip.textContent = '加入后只能看到本组的文档和公共文档。';
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
          const r = await api('/api/auth/group', { method: 'POST', body: JSON.stringify({ code: input.value, userId: user.id }) });
          close();
          window.toast('已加入分组：' + r.group.name, 'ok');
          await refreshMe();
          if (onOk) onOk(r);
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
