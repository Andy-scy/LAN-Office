'use strict';
/* 首页：文件列表 / 上传 / 新建 / 重命名 / 删除 / 在线状态 */
(function () {
  const $ = (id) => document.getElementById(id);
  const filesEl = $('files');
  const emptyEl = $('empty');
  let state = { files: [], ds: null, info: null, filter: '' };

  const svgOpen = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>';
  const svgDownload = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  const svgHistory = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  const svgRename = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
  const svgTrash = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  /* ---------- 渲染 ---------- */
  function render() {
    const list = state.files.filter((f) =>
      !state.filter || f.name.toLowerCase().includes(state.filter.toLowerCase()));
    filesEl.textContent = '';
    for (const f of list) filesEl.appendChild(card(f));
    emptyEl.hidden = list.length > 0;
    $('chip-files').textContent = `🗂 ${state.files.length} 个文件`;
  }

  function card(f) {
    const t = App.typeMeta(f.ext);
    const cardEl = document.createElement('article');
    cardEl.className = 'fcard';

    const tile = document.createElement('span');
    tile.className = 'ftile ' + t.cls;
    tile.textContent = t.letter;
    cardEl.appendChild(tile);

    const main = document.createElement('div');
    main.className = 'fmain';
    main.title = '打开编辑：' + f.name;
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = f.name;
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    const m1 = document.createElement('span');
    m1.textContent = t.label;
    const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '·';
    const m2 = document.createElement('span'); m2.textContent = App.fmtSize(f.size);
    const sep2 = document.createElement('span'); sep2.className = 'sep'; sep2.textContent = '·';
    const m3 = document.createElement('span'); m3.textContent = '修改于 ' + App.fmtTime(f.mtime);
    meta.append(m1, sep, m2, sep2, m3);
    const editing = document.createElement('div');
    editing.className = 'fediting';
    fillEditing(editing, f);
    main.append(name, meta, editing);
    main.addEventListener('click', () => openFile(f));
    cardEl.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'factions';
    actions.appendChild(iconBtn('打开', svgOpen, () => openFile(f)));
    actions.appendChild(iconBtn('下载', svgDownload, () => {
      const a = document.createElement('a');
      a.href = `/api/files/${f.id}/download?dl=1`;
      a.download = f.name;
      a.click();
    }));
    actions.appendChild(iconBtn('备份历史', svgHistory, () => showBackups(f)));
    actions.appendChild(iconBtn('重命名', svgRename, () => doRename(f)));
    actions.appendChild(iconBtn('删除', svgTrash, () => doDelete(f), 'danger'));
    cardEl.appendChild(actions);
    return cardEl;
  }

  function fillEditing(el, f) {
    el.textContent = '';
    if (!f.editing || !f.editing.count) {
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = '空闲';
      el.appendChild(label);
      return;
    }
    for (const p of f.editing.users.slice(0, 5)) el.appendChild(window.avatarEl(p));
    if (f.editing.count > 5) {
      const more = document.createElement('span');
      more.className = 'label';
      more.textContent = '+' + (f.editing.count - 5);
      el.appendChild(more);
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = `${f.editing.count} 人正在编辑`;
    el.appendChild(label);
  }

  function iconBtn(title, svg, onClick, cls) {
    const b = document.createElement('button');
    b.className = 'icon-btn' + (cls ? ' ' + cls : '');
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  /* ---------- 数据加载 ---------- */
  async function loadAll() {
    try {
      const [info, files] = await Promise.all([
        App.api('/api/info'),
        App.api('/api/files')
      ]);
      state.info = info;
      state.files = files.files;
      state.ds = files.ds;
      renderHeader();
      render();
    } catch (e) {
      const hint = $('foot-hint');
      if (hint) hint.textContent = '✘ 加载失败：' + e.message;
      window.toast('加载失败：' + e.message, 'error');
    }
  }

  function renderHeader() {
    const info = state.info;
    $('chip-server').textContent = '📍 ' + info.primary + ':' + info.port;
    $('chip-server').title = '局域网访问地址 http://' + info.primary + ':' + info.port;
    const dsChip = $('chip-ds');
    dsChip.classList.toggle('ok', !!state.ds.available);
    dsChip.classList.toggle('bad', !state.ds.available);
    dsChip.title = state.ds.available
      ? 'OnlyOffice 编辑引擎已连接'
      : '未检测到 ONLYOFFICE Document Server —— 文件管理可用，在线编辑需先安装引擎（见 README）';
    $('chip-online').textContent = '👤 在线 ' + (info.online || 0) + ' 人';
    updateOnlineChipTitle();
    const u = App.user;
    $('chip-user').textContent = '';
    $('chip-user').appendChild(window.avatarEl({ id: u.id, name: u.name, device: App.device.name, color: App.colorFor(u.id) }));
    $('chip-user').appendChild(document.createTextNode(' ' + u.name + ' · ' + App.device.name));
    const hint = $('foot-hint');
    if (state.ds.available) {
      hint.textContent = '数据保存在服务器 data/ 目录；编辑内容会自动保存并生成备份。';
    } else {
      hint.textContent = '⚠ 尚未安装 ONLYOFFICE Document Server（编辑引擎）：文件管理功能可用，在线编辑 Office 前请先安装，步骤见 README。';
    }
  }

  /* ---------- 操作 ---------- */
  function openFile(f) {
    location.href = '/editor.html?id=' + encodeURIComponent(f.id);
  }

  function doRename(f) {
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '重命名';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = f.name;
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = '保留扩展名（如 .docx / .xlsx / .pptx）';
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '取消';
      cancel.onclick = close;
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = '保存';
      ok.onclick = async () => {
        try {
          await App.api(`/api/files/${f.id}/rename`, { method: 'POST', body: JSON.stringify({ name: input.value }) });
          close();
          window.toast('已重命名', 'ok');
          loadAll();
        } catch (e) {
          tip.textContent = e.message;
          tip.style.color = '#dc2626';
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
      row.append(cancel, ok);
      box.append(h, input, tip, row);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  function doDelete(f) {
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '删除文件？';
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = `“${f.name}” 将被删除（其历史备份也会一并清除）。此操作不可恢复。`;
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '取消';
      cancel.onclick = close;
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.style.background = 'var(--danger)';
      ok.style.borderColor = 'var(--danger)';
      ok.textContent = '删除';
      ok.onclick = async () => {
        try {
          await App.api(`/api/files/${f.id}`, { method: 'DELETE' });
          close();
          window.toast('已删除', 'ok');
          loadAll();
        } catch (e) {
          tip.textContent = e.message;
          tip.style.color = '#dc2626';
        }
      };
      row.append(cancel, ok);
      box.append(h, tip, row);
    });
  }

  async function showBackups(f) {
    let backups = [];
    try {
      const r = await App.api(`/api/files/${f.id}/backups`);
      backups = r.backups;
    } catch (e) {
      window.toast(e.message, 'error');
      return;
    }
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = `备份历史 · ${f.name}`;
      box.appendChild(h);
      if (!backups.length) {
        const tip = document.createElement('div');
        tip.className = 'tip';
        tip.textContent = '暂无备份。每次保存修改前，都会把上一版自动备份到这里。';
        box.appendChild(tip);
      } else {
        const list = document.createElement('div');
        list.className = 'list';
        for (const b of backups) {
          const item = document.createElement('div');
          item.className = 'list-item';
          const name = document.createElement('span');
          name.textContent = `${App.fmtTime(b.mtime)} · ${App.fmtSize(b.size)}`;
          name.title = b.file;
          const btn = document.createElement('button');
          btn.className = 'btn';
          btn.textContent = '恢复';
          btn.onclick = async () => {
            try {
              await App.api(`/api/files/${f.id}/backups/restore`, { method: 'POST', body: JSON.stringify({ file: b.file }) });
              close();
              window.toast('已恢复备份', 'ok');
              loadAll();
            } catch (e) {
              window.toast(e.message, 'error');
            }
          };
          item.append(name, btn);
          list.appendChild(item);
        }
        box.appendChild(list);
      }
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '关闭';
      cancel.onclick = close;
      row.appendChild(cancel);
      box.appendChild(row);
    });
  }

  /* ---------- 上传 ---------- */
  function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    fd.append('names', JSON.stringify(files.map((f) => f.name)));

    const prog = $('upload-progress');
    const bar = prog.querySelector('.bar i');
    const text = prog.querySelector('span');
    prog.hidden = false;
    bar.style.width = '0%';
    text.textContent = '上传中 0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + '%';
        text.textContent = '上传中 ' + pct + '%';
      }
    });
    xhr.addEventListener('load', () => {
      prog.hidden = true;
      try {
        const r = JSON.parse(xhr.responseText);
        if (r.failed && r.failed.length) {
          window.toast(r.failed.map((x) => `${x.name}: ${x.error}`).join('\n'), 'error');
        }
        if (r.files && r.files.length) {
          window.toast(`已上传 ${r.files.length} 个文件`, 'ok');
        }
      } catch (_) { window.toast('上传响应解析失败', 'error'); }
      loadAll();
    });
    xhr.addEventListener('error', () => { prog.hidden = true; window.toast('上传失败（网络错误）', 'error'); });
    xhr.send(fd);
  }

  /* ---------- 新建 ---------- */
  function createDoc(ext) {
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = { docx: '新建 Word 文档', xlsx: '新建 Excel 表格', pptx: '新建 PowerPoint 演示' }[ext];
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '文件名（可留空自动命名）';
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '取消';
      cancel.onclick = close;
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = '创建并打开';
      ok.onclick = async () => {
        try {
          const r = await App.api('/api/files/create', { method: 'POST', body: JSON.stringify({ ext, name: input.value }) });
          close();
          window.toast('已创建 ' + r.file.name, 'ok');
          location.href = '/editor.html?id=' + encodeURIComponent(r.file.id);
        } catch (e) {
          window.toast(e.message, 'error');
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
      row.append(cancel, ok);
      box.append(h, input, row);
      setTimeout(() => input.focus(), 30);
    });
  }

  /* ---------- 昵称与设备名 ---------- */
  function editProfile() {
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '我的昵称与设备名称';
      const l1 = document.createElement('div');
      l1.className = 'tip';
      l1.textContent = '昵称';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = App.user.name;
      input.maxLength = 24;
      const l2 = document.createElement('div');
      l2.className = 'tip';
      l2.style.marginTop = '10px';
      l2.textContent = '设备名称（用于区分你的手机/平板/电脑）';
      const input2 = document.createElement('input');
      input2.type = 'text';
      input2.value = App.device.name;
      input2.maxLength = 24;
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = '两者都会显示给同局域网的其他协作者（保存在本机浏览器）。';
      const row = document.createElement('div');
      row.className = 'row';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = '取消';
      cancel.onclick = close;
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = '保存';
      ok.onclick = () => {
        App.user.name = input.value.trim() || App.user.name;
        App.device.name = input2.value.trim() || App.device.name;
        App.saveUser();
        App.saveDevice();
        App.socket.emit('user:profile', { name: App.user.name, device: App.device.name });
        close();
        renderHeader();
      };
      row.append(cancel, ok);
      box.append(h, l1, input, l2, input2, tip, row);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  function updateOnlineChipTitle() {
    const users = state.lastOnlineUsers || [];
    $('chip-online').title = users.length
      ? '在线设备：\n' + users.map((u) => `${u.name}（${u.device || '未知设备'}）`).join('\n')
      : '';
  }

  /* ---------- 事件绑定 ---------- */
  $('btn-upload').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });
  $('btn-new').addEventListener('click', (e) => {
    e.stopPropagation();
    $('menu-new').hidden = !$('menu-new').hidden;
  });
  document.addEventListener('click', (e) => {
    if (!$('menu-new').hidden && !$('menu-new').contains(e.target) && e.target !== $('btn-new')) {
      $('menu-new').hidden = true;
    }
  });
  for (const b of $('menu-new').querySelectorAll('button[data-ext]')) {
    b.addEventListener('click', () => {
      $('menu-new').hidden = true;
      createDoc(b.dataset.ext);
    });
  }
  $('search').addEventListener('input', (e) => {
    state.filter = e.target.value.trim();
    render();
  });
  $('chip-user').addEventListener('click', editProfile);

  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $('drop-overlay').hidden = false;
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('drop-overlay').hidden = true;
    if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
  });

  /* ---------- Socket presence ---------- */
  App.socket.on('presence:update', (snap) => {
    $('chip-online').textContent = '👤 在线 ' + (snap.online.count) + ' 人';
    state.lastOnlineUsers = snap.online.users;
    updateOnlineChipTitle();
    let dirty = false;
    for (const f of state.files) {
      const p = snap.files[f.id];
      const before = f.editing ? f.editing.count : 0;
      const after = p ? p.count : 0;
      if (before !== after || (p && JSON.stringify(p.users) !== JSON.stringify(f.editing && f.editing.users))) dirty = true;
      f.editing = { count: after, users: p ? p.users : [] };
    }
    if (dirty) render();
  });

  loadAll();
  setInterval(loadAll, 15000); // 轻量轮询：让修改时间/大小保持新鲜
})();
