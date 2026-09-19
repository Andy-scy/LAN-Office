'use strict';
/* 编辑器页：加载 OnlyOffice 编辑器 + presence + 自动保存状态 */
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const fileId = params.get('id') || '';

  let currentFile = null;
  let dirty = false;
  let forceSaveTimer = null;

  function setStatus(mode, text) {
    const el = $('ed-save');
    el.className = 'ed-status' + (mode ? ' ' + mode : '');
    el.textContent = text;
  }

  function showOverlay(title, bodyHtml, showRetry) {
    $('ed-overlay-title').textContent = title;
    $('ed-overlay-body').innerHTML = bodyHtml;
    $('ed-overlay-refresh').hidden = !showRetry;
    $('ed-overlay').hidden = false;
  }
  function hideOverlay() { $('ed-overlay').hidden = true; }

  function banner(text, sticky) {
    const el = $('ed-banner');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
    if (!sticky) setTimeout(() => { el.hidden = true; }, 8000);
  }

  /* ---------- presence ---------- */
  function renderPeople(users, count) {
    const el = $('ed-people');
    el.textContent = '';
    for (const p of (users || []).slice(0, 6)) el.appendChild(window.avatarEl(p));
    if ((count || 0) > 6) {
      const s = document.createElement('span');
      s.className = 'ed-status';
      s.textContent = '+' + (count - 6);
      el.appendChild(s);
    }
  }

  App.socket.emit('presence:join', fileId);
  App.socket.on('presence:update', (snap) => {
    const p = snap.files[fileId];
    renderPeople(p ? p.users : [], p ? p.count : 0);
  });
  window.addEventListener('pagehide', () => {
    try {
      App.socket.emit('presence:leave', fileId);
      if (dirty) {
        fetch(`/api/files/${encodeURIComponent(fileId)}/forcesave`, { method: 'POST', keepalive: true });
      }
    } catch (_) { /* 忽略 */ }
  });

  /* ---------- 主流程 ---------- */
  async function main() {
    if (!/^[0-9a-f-]{8,64}$/i.test(fileId)) {
      showOverlay('文件 ID 无效', '<p>请从文件列表打开文档。</p>', false);
      setStatus('', '');
      return;
    }

    let meta;
    try {
      const r = await App.api(`/api/files/${encodeURIComponent(fileId)}/meta`);
      meta = r.file;
      currentFile = meta;
      renderPeople(r.editing.users, r.editing.count);
    } catch (e) {
      showOverlay('无法打开文件', `<p>${App.escapeHtml(e.message)}</p>`, false);
      return;
    }

    document.title = meta.name + ' · LAN Office';
    const t = App.typeMeta(meta.ext);
    const icon = $('ed-icon');
    icon.className = 'ftile ' + t.cls;
    icon.textContent = t.letter;
    $('ed-name').textContent = meta.name;
    setStatus('', meta.size != null ? App.fmtSize(meta.size) + ' · 加载编辑器…' : '加载编辑器…');

    let r;
    try {
      r = await App.api(`/api/files/${encodeURIComponent(fileId)}/editor-config`, {
        method: 'POST',
        body: JSON.stringify({
          userId: App.user.id,
          userName: App.user.name,
          type: (window.matchMedia('(pointer: coarse)').matches || innerWidth < 640) ? 'mobile' : 'desktop'
        })
      });
    } catch (e) {
      if (e.status === 503) {
        showOverlay('编辑引擎未连接',
          '<p>LAN Office 找不到 ONLYOFFICE Document Server（Office 编辑引擎）。</p>' +
          '<p><b>在服务器电脑上执行一次：</b></p>' +
          '<ol>' +
          '<li>下载 ONLYOFFICE Docs 社区版（Windows 安装包）：<br>' +
          '<a href="https://www.onlyoffice.com/download-docs.aspx" target="_blank" rel="noopener">https://www.onlyoffice.com/download-docs.aspx</a></li>' +
          '<li>安装并等待服务启动（默认端口 80，也可在 <code>config/config.json</code> 的 <code>ds.url</code> 里手动指定）。</li>' +
          '<li>回到本页面点击“重试”。</li>' +
          '</ol>' +
          '<p>文件管理功能不受影响。详见项目 README。</p>', true);
      } else {
        showOverlay('无法打开文件', `<p>${App.escapeHtml(e.message)}</p>`, false);
      }
      setStatus('', '');
      return;
    }

    loadEditor(r);
  }

  function loadEditor(cfgResp) {
    const dsUrl = cfgResp.ds.url;
    const script = document.createElement('script');
    script.src = `${dsUrl}/web-apps/apps/api/documents/api.js`;
    script.onload = () => {
      try {
        const editor = new DocsAPI.DocEditor('editor-container', Object.assign({}, cfgResp.config, {
          events: {
            onDocumentReady: () => {
              hideOverlay();
              setStatus('', '编辑器已就绪');
            },
            onDocumentStateChange: (e) => {
              dirty = !!e.data;
              if (dirty) {
                setStatus('dirty', '● 有未保存的更改（自动保存中…）');
                scheduleForceSave();
              } else {
                setStatus('saved', '✓ 已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
              }
            },
            onError: (e) => {
              const msg = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
              if (/token|jwt/i.test(msg)) {
                banner('编辑引擎安全校验失败（JWT）。请在 config/config.json 的 ds.jwtSecret 里填写与 DocumentServer local.json 一致的密钥，或重启 LAN Office 让其自动读取。', true);
              } else {
                banner('编辑器错误: ' + msg);
              }
            },
            onWarning: (e) => {
              const msg = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
              banner('编辑器警告: ' + msg);
            }
          }
        }));
        window._lanOfficeEditor = editor;
      } catch (e) {
        showOverlay('编辑器初始化失败', `<p>${App.escapeHtml(e.message)}</p>`, true);
      }
    };
    script.onerror = () => {
      showOverlay('无法连接编辑引擎',
        `<p>浏览器无法从 <code>${App.escapeHtml(dsUrl)}</code> 加载编辑器组件。</p>` +
        '<ol><li>确认服务器上 ONLYOFFICE Document Server 正在运行；</li>' +
        '<li>确认服务器防火墙已放行其端口（默认 80）；</li>' +
        '<li>如果端口特殊，请在 config/config.json 的 ds.publicUrl 里填写局域网设备可达的地址。</li></ol>', true);
    };
    document.head.appendChild(script);
  }

  function scheduleForceSave() {
    clearTimeout(forceSaveTimer);
    forceSaveTimer = setTimeout(async () => {
      if (!dirty) return;
      try {
        await App.api(`/api/files/${encodeURIComponent(fileId)}/forcesave`, { method: 'POST' });
      } catch (_) { /* 失败时 DS 仍会在所有人关闭时自动保存 */ }
    }, 8000);
  }

  $('ed-overlay-refresh').addEventListener('click', () => location.reload());

  main();
})();
