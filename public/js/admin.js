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
        name.textContent = f.name + (f.groupName ? `（${f.groupName}）` : (f.groupId ? '（已解散分组）' : '（公共）')) +
          (f.editorsSpecified ? `（指定 ${f.editorsCount} 人可编辑）` : '');
        const sel = document.createElement('select');
        sel.className = 'adm-select';
        sel.title = '分组可见范围';
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
        const editorsBtn = document.createElement('button');
        editorsBtn.className = 'btn mini';
        editorsBtn.title = '指定哪些学生可以编辑这份文档';
        editorsBtn.textContent = '编辑者…';
        editorsBtn.onclick = () => editEditors(f);
        item.append(name, editorsBtn, sel);
        el.appendChild(item);
      }
    } catch (e) {
      window.toast(e.message, 'error');
    }
  }

  /* ---------- 指定文档的可编辑学生 ---------- */
  async function editEditors(f) {
    let students = [];
    let editors = [];
    try {
      const [sr, mr] = await Promise.all([
        App.api('/api/students'),
        App.api(`/api/files/${encodeURIComponent(f.id)}/meta`)
      ]);
      students = sr.students;
      editors = mr.file.editors || [];
    } catch (e) {
      return window.toast(e.message, 'error');
    }
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '可编辑学生 · ' + f.name;
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = '勾选的学生可以编辑这份文档；一个都不勾 = 按分组规则（本组成员可编辑）。';
      box.append(h, tip);
      if (!students.length) {
        const none = document.createElement('div');
        none.className = 'tip';
        none.textContent = '还没有学生设备加入过分组——学生先用加入码进组，再回来指定编辑者。';
        box.appendChild(none);
      } else {
        const list = document.createElement('div');
        list.className = 'list';
        const boxes = [];
        for (const st of students) {
          const label = document.createElement('label');
          label.className = 'opt-label';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = st.id;
          cb.checked = editors.indexOf(st.id) >= 0;
          label.append(cb, document.createTextNode(` ${st.name}${st.dname ? '（' + st.dname + '）' : ''}${st.group ? ' · ' + st.group : ''}`));
          list.appendChild(label);
          boxes.push({ id: st.id, cb });
        }
        box.appendChild(list);
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
          const picked = boxes.filter((b) => b.cb.checked).map((b) => b.id);
          try {
            await App.api(`/api/files/${encodeURIComponent(f.id)}/editors`, {
              method: 'POST',
              body: JSON.stringify({ editors: picked })
            });
            close();
            window.toast(picked.length ? `已指定 ${picked.length} 名学生可编辑` : '已恢复按分组规则', 'ok');
            loadFiles();
          } catch (e) {
            window.toast(e.message, 'error');
          }
        };
        row.append(cancel, ok);
        box.appendChild(row);
      }
    });
  }

  init();
})();
