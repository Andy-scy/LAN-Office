'use strict';
/* 管理面板：教师登录 → 访问控制开关 / 分组管理 / 文件归组 */
(function () {
  const $ = (id) => document.getElementById(id);

  async function init() {
    const me = await App.refreshMe();
    if (me.isTeacher) openPanel();
    $('gate-ok').addEventListener('click', async () => {
      $('gate-err').hidden = true;
      try {
        await App.api('/api/auth/teacher', {
          method: 'POST',
          body: JSON.stringify({ password: $('gate-pass').value, userId: App.user.id })
        });
        await App.refreshMe();
        openPanel();
      } catch (e) {
        $('gate-err').textContent = e.message;
        $('gate-err').hidden = false;
      }
    });
    $('gate-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gate-ok').click(); });
    $('chip-logout').addEventListener('click', async () => {
      await App.api('/api/auth/leave', { method: 'POST', body: JSON.stringify({ userId: App.user.id }) });
      location.reload();
    });
  }

  function openPanel() {
    $('gate').hidden = true;
    $('panel').hidden = false;
    $('chip-logout').hidden = false;
    loadSettings();
    loadGroups();
    loadFiles();
  }

  /* ---------- ① 访问控制 ---------- */
  async function loadSettings() {
    const me = await App.refreshMe();
    $('set-enabled').checked = !!me.settings.accessEnabled;
    const vis = me.settings.studentVisibility || 'hidden';
    document.querySelector(`input[name="vis"][value="${vis}"]`).checked = true;
    $('row-vis').style.opacity = me.settings.accessEnabled ? '1' : '.5';
  }

  async function saveSettings(patch) {
    try {
      const r = await App.api('/api/settings', { method: 'PUT', body: JSON.stringify({ settings: patch }) });
      $('set-saved').hidden = false;
      setTimeout(() => { $('set-saved').hidden = true; }, 2000);
      $('row-vis').style.opacity = r.settings.accessEnabled ? '1' : '.5';
    } catch (e) {
      window.toast(e.message, 'error');
    }
  }

  $('set-enabled').addEventListener('change', () => saveSettings({ accessEnabled: $('set-enabled').checked }));
  for (const r of document.querySelectorAll('input[name="vis"]')) {
    r.addEventListener('change', () => saveSettings({ studentVisibility: document.querySelector('input[name="vis"]:checked').value }));
  }

  /* ---------- ② 分组管理 ---------- */
  async function loadGroups() {
    try {
      const r = await App.api('/api/groups');
      const el = $('g-list');
      el.textContent = '';
      if (!r.groups.length) {
        const p = document.createElement('p');
        p.className = 'tip';
        p.textContent = '还没有分组。创建后把加入码告诉学生。';
        el.appendChild(p);
        return;
      }
      for (const g of r.groups) {
        const item = document.createElement('div');
        item.className = 'list-item';
        const name = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = g.name;
        const code = document.createElement('code');
        code.className = 'code-big';
        code.textContent = '加入码 ' + g.code;
        name.append(b, document.createTextNode('　'), code);
        const del = document.createElement('button');
        del.className = 'icon-btn danger';
        del.title = '解散该分组（组内文件自动变回公共）';
        del.innerHTML = window.icon('trash', 15);
        del.onclick = () => {
          window.modal((box, close) => {
            const h = document.createElement('h3');
            h.textContent = '解散分组「' + g.name + '」？';
            const tip = document.createElement('div');
            tip.className = 'tip';
            tip.textContent = '组内学生将退出分组，该组的文件会变回"公共"文档。';
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
            ok.textContent = '解散';
            ok.onclick = async () => {
              try {
                await App.api(`/api/groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
                close();
                window.toast('已解散', 'ok');
                loadGroups();
                loadFiles();
              } catch (e) { window.toast(e.message, 'error'); }
            };
            row.append(cancel, ok);
            box.append(h, tip, row);
          });
        };
        item.append(name, del);
        el.appendChild(item);
      }
    } catch (e) {
      window.toast(e.message, 'error');
    }
  }

  $('g-add').addEventListener('click', async () => {
    const name = $('g-name').value.trim();
    if (!name) return window.toast('请输入分组名称', 'error');
    try {
      await App.api('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
      $('g-name').value = '';
      window.toast('分组已创建', 'ok');
      loadGroups();
    } catch (e) {
      window.toast(e.message, 'error');
    }
  });

  /* ---------- ③ 文件归组 ---------- */
  async function loadFiles() {
    try {
      const [fr, gr] = await Promise.all([
        App.api('/api/files'),
        App.api('/api/groups')
      ]);
      const groups = gr.groups;
      const el = $('f-list');
      el.textContent = '';
      if (!fr.files.length) {
        const p = document.createElement('p');
        p.className = 'tip';
        p.textContent = '还没有文件。';
        el.appendChild(p);
        return;
      }
      for (const f of fr.files) {
        const item = document.createElement('div');
        item.className = 'list-item';
        const name = document.createElement('span');
        name.textContent = f.name + (f.groupName ? `（${f.groupName}）` : (f.groupId ? '（已解散分组）' : '（公共）'));
        const sel = document.createElement('select');
        sel.className = 'adm-select';
        sel.append(new Option('公共（人人可编辑）', ''));
        for (const g of groups) sel.append(new Option(g.name + '（加入码 ' + g.code + '）', g.id));
        sel.value = f.groupId || '';
        sel.addEventListener('change', async () => {
          try {
            await App.api(`/api/files/${encodeURIComponent(f.id)}/assign`, {
              method: 'POST',
              body: JSON.stringify({ groupId: sel.value || null })
            });
            window.toast('已更新「' + f.name + '」的分组', 'ok');
            loadFiles();
          } catch (e) {
            window.toast(e.message, 'error');
          }
        });
        item.append(name, sel);
        el.appendChild(item);
      }
    } catch (e) {
      window.toast(e.message, 'error');
    }
  }

  init();
})();
