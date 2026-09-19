'use strict';
/* 问卷页：列表 / 新建 / 填写 / 结果统计（创建者） */
(function () {
  const $ = (id) => document.getElementById(id);
  let surveys = [];
  let resultTimer = null;

  function show(view) {
    $('list-view').hidden = view !== 'list';
    $('fill-view').hidden = view !== 'fill';
    $('result-view').hidden = view !== 'result';
    if (view !== 'result' && resultTimer) { clearInterval(resultTimer); resultTimer = null; }
    window.scrollTo(0, 0);
  }

  /* ---------- 列表 ---------- */
  async function loadList() {
    try {
      const r = await App.api(`/api/surveys?userId=${encodeURIComponent(App.user.id)}`);
      surveys = r.surveys;
      renderList();
    } catch (e) {
      window.toast('加载失败：' + e.message, 'error');
    }
  }

  function renderList() {
    const el = $('sv-list');
    el.textContent = '';
    $('sv-empty').hidden = surveys.length > 0;
    $('sv-count').textContent = surveys.length ? `共 ${surveys.length} 份问卷` : '';
    for (const s of surveys) el.appendChild(surveyCard(s));
  }

  function surveyCard(s) {
    const card = document.createElement('article');
    card.className = 'fcard';

    const tile = document.createElement('span');
    tile.className = 'ftile ppt';
    tile.textContent = '📋';
    card.appendChild(tile);

    const main = document.createElement('div');
    main.className = 'fmain';
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = s.title;
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = `${s.questions.length} 道题 · ${s.responseCount} 人已答 · ${s.createdBy.name} · ${App.fmtTime(s.createdAt)}`;
    const editing = document.createElement('div');
    editing.className = 'fediting';
    const badge = document.createElement('span');
    badge.className = 'label';
    badge.textContent = s.mine ? '我创建的' : '';
    if (s.mine) editing.appendChild(badge);
    main.append(name, meta, editing);
    card.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'factions';
    actions.appendChild(iconBtn('填写', '✏️', () => openFill(s.id), ''));
    if (s.mine) {
      actions.appendChild(iconBtn('查看结果', '📊', () => openResult(s.id), ''));
      actions.appendChild(iconBtn('导出 CSV', '⬇️', () => exportCsv(s), ''));
      actions.appendChild(iconBtn('删除', '🗑️', () => doDelete(s), 'danger'));
    }
    card.appendChild(actions);
    return card;
  }

  function iconBtn(title, glyph, onClick, cls) {
    const b = document.createElement('button');
    b.className = 'icon-btn emoji-btn' + (cls ? ' ' + cls : '');
    b.title = title;
    b.setAttribute('aria-label', title);
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- 新建 ---------- */
  function addQuestionUI(prefill) {
    const q = prefill || { text: '', options: ['', ''] };
    const box = document.createElement('div');
    box.className = 'qcard';
    const head = document.createElement('div');
    head.className = 'row-gap';
    const idx = document.createElement('span');
    idx.className = 'q-index';
    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'wide-input';
    text.placeholder = '题目（例如：第一章的作者是谁？）';
    text.value = q.text;
    text.maxLength = 200;
    head.append(idx, text);
    const delQ = document.createElement('button');
    delQ.className = 'icon-btn danger';
    delQ.title = '删除本题';
    delQ.textContent = '✕';
    delQ.onclick = () => box.remove();
    head.appendChild(delQ);
    const opts = document.createElement('div');
    opts.className = 'opt-list';
    const renderIdx = () => {
      const qs = $('q-list').querySelectorAll('.qcard');
      qs.forEach((c, i) => { c.querySelector('.q-index').textContent = '第 ' + (i + 1) + ' 题'; });
    };
    const addOpt = (val) => {
      const row = document.createElement('div');
      row.className = 'opt-row';
      const radio = document.createElement('span');
      radio.className = 'opt-dot';
      const oi = document.createElement('input');
      oi.type = 'text';
      oi.placeholder = '选项内容';
      oi.value = val || '';
      oi.maxLength = 60;
      const delO = document.createElement('button');
      delO.className = 'icon-btn';
      delO.title = '删除该选项';
      delO.textContent = '－';
      delO.onclick = () => { if (opts.children.length > 2) row.remove(); else window.toast('至少保留 2 个选项'); };
      row.append(radio, oi, delO);
      opts.appendChild(row);
    };
    q.options.forEach(addOpt);
    const addOptBtn = document.createElement('button');
    addOptBtn.className = 'btn mini';
    addOptBtn.textContent = '＋ 选项';
    addOptBtn.onclick = () => { if (opts.children.length < 6) addOpt(''); else window.toast('最多 6 个选项'); };
    box.append(head, opts, addOptBtn);
    box._getData = () => ({
      text: text.value.trim(),
      options: Array.from(opts.querySelectorAll('input')).map((i) => i.value.trim()).filter(Boolean)
    });
    $('q-list').appendChild(box);
    renderIdx();
    const obs = new MutationObserver(renderIdx);
    obs.observe($('q-list'), { childList: true });
  }

  async function create() {
    const title = $('sv-title').value.trim();
    const questions = Array.from($('q-list').querySelectorAll('.qcard')).map((c) => c._getData());
    if (!title) return window.toast('请填写问卷标题', 'error');
    if (!questions.length) return window.toast('请至少添加一道题', 'error');
    try {
      await App.api('/api/surveys', {
        method: 'POST',
        body: JSON.stringify({ title, questions, userId: App.user.id, userName: App.user.name })
      });
      $('sv-title').value = '';
      $('q-list').textContent = '';
      addQuestionUI();
      addQuestionUI();
      $('creator').hidden = true;
      window.toast('问卷已发布', 'ok');
      loadList();
    } catch (e) {
      window.toast(e.message, 'error');
    }
  }

  /* ---------- 填写 ---------- */
  async function openFill(id) {
    let s;
    try {
      s = (await App.api(`/api/surveys/${encodeURIComponent(id)}?userId=${encodeURIComponent(App.user.id)}`)).survey;
    } catch (e) {
      return window.toast(e.message, 'error');
    }
    show('fill');
    const v = $('fill-view');
    v.textContent = '';
    const h = document.createElement('h2');
    h.textContent = s.title;
    const sub = document.createElement('p');
    sub.className = 'label-muted';
    sub.textContent = `${s.questions.length} 道单选题 · 创建者 ${s.createdBy.name}${s.myResponse ? ' · 你已提交过，可修改后重新提交' : ''}`;
    v.append(h, sub);
    s.questions.forEach((q, qi) => {
      const card = document.createElement('div');
      card.className = 'qcard';
      const t = document.createElement('div');
      t.className = 'q-title';
      t.textContent = `第 ${qi + 1} 题：${q.text}`;
      card.appendChild(t);
      const group = document.createElement('div');
      group.dataset.qi = qi;
      q.options.forEach((opt, oi) => {
        const label = document.createElement('label');
        label.className = 'opt-label';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'q' + qi;
        radio.value = oi;
        if (s.myResponse && s.myResponse.answers[qi] === oi) radio.checked = true;
        label.append(radio, document.createTextNode(' ' + opt));
        group.appendChild(label);
      });
      card.appendChild(group);
      v.appendChild(card);
    });
    const row = document.createElement('div');
    row.className = 'row-gap';
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回列表';
    back.onclick = () => { show('list'); loadList(); };
    const submit = document.createElement('button');
    submit.className = 'btn primary';
    submit.textContent = '提交答卷';
    submit.onclick = async () => {
      const answers = [];
      for (let qi = 0; qi < s.questions.length; qi++) {
        const picked = v.querySelector(`input[name="q${qi}"]:checked`);
        if (!picked) return window.toast(`第 ${qi + 1} 题还没作答`, 'error');
        answers.push(Number(picked.value));
      }
      try {
        await App.api(`/api/surveys/${encodeURIComponent(s.id)}/submit`, {
          method: 'POST',
          body: JSON.stringify({ userId: App.user.id, name: App.user.name, device: App.device.name, answers })
        });
        window.toast('答卷已提交' + (s.myResponse ? '（已更新）' : ''), 'ok');
        show('list');
        loadList();
      } catch (e) {
        window.toast(e.message, 'error');
      }
    };
    row.append(back, submit);
    v.appendChild(row);
  }

  /* ---------- 结果 ---------- */
  async function openResult(id) {
    let s;
    try {
      s = (await App.api(`/api/surveys/${encodeURIComponent(id)}?userId=${encodeURIComponent(App.user.id)}`)).survey;
      if (!s.mine) return window.toast('只有创建者可以查看统计', 'error');
    } catch (e) {
      return window.toast(e.message, 'error');
    }
    show('result');
    renderResult(s);
    clearInterval(resultTimer);
    resultTimer = setInterval(async () => {
      try {
        const r = await App.api(`/api/surveys/${encodeURIComponent(id)}?userId=${encodeURIComponent(App.user.id)}`);
        renderResult(r.survey);
      } catch (_) { /* 忽略轮询失败 */ }
    }, 5000);
  }

  function renderResult(s) {
    const v = $('result-view');
    v.textContent = '';
    const h = document.createElement('h2');
    h.textContent = s.title;
    const sub = document.createElement('p');
    sub.className = 'label-muted';
    sub.textContent = `${s.responseCount} 人已答 · 每 5 秒自动刷新`;
    v.append(h, sub);

    s.questions.forEach((q, qi) => {
      const card = document.createElement('div');
      card.className = 'qcard';
      const t = document.createElement('div');
      t.className = 'q-title';
      t.textContent = `第 ${qi + 1} 题：${q.text}`;
      card.appendChild(t);
      const counts = (s.tally && s.tally[qi]) || q.options.map(() => 0);
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      counts.forEach((n, oi) => {
        const row = document.createElement('div');
        row.className = 'result-row';
        const label = document.createElement('span');
        label.className = 'result-label';
        label.textContent = q.options[oi];
        const barWrap = document.createElement('div');
        barWrap.className = 'result-bar';
        const fill = document.createElement('i');
        fill.style.width = Math.round((n / total) * 100) + '%';
        barWrap.appendChild(fill);
        const num = document.createElement('span');
        num.className = 'result-num';
        num.textContent = `${n} 票（${Math.round((n / total) * 100)}%）`;
        row.append(label, barWrap, num);
        card.appendChild(row);
      });
      v.appendChild(card);
    });

    const table = document.createElement('div');
    table.className = 'qcard';
    const th = document.createElement('div');
    th.className = 'q-title';
    th.textContent = '作答明细（' + s.responses.length + ' 人）';
    table.appendChild(th);
    for (const r of s.responses) {
      const line = document.createElement('div');
      line.className = 'resp-line';
      const who = document.createElement('span');
      who.textContent = `${r.name}${r.device ? '（' + r.device + '）' : ''}`;
      const ans = document.createElement('span');
      ans.className = 'resp-ans';
      ans.textContent = r.answers.map((a, i) => s.questions[i].options[a]).join(' · ');
      const when = document.createElement('span');
      when.className = 'resp-when';
      when.textContent = App.fmtTime(r.submittedAt);
      line.append(who, ans, when);
      table.appendChild(line);
    }
    v.appendChild(table);

    const row = document.createElement('div');
    row.className = 'row-gap';
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回列表';
    back.onclick = () => { show('list'); loadList(); };
    const csv = document.createElement('a');
    csv.className = 'btn primary';
    csv.href = `/api/surveys/${encodeURIComponent(s.id)}/export?userId=${encodeURIComponent(App.user.id)}`;
    csv.textContent = '⬇ 导出 CSV（Excel 可打开）';
    row.append(back, csv);
    v.appendChild(row);
  }

  function exportCsv(s) {
    const a = document.createElement('a');
    a.href = `/api/surveys/${encodeURIComponent(s.id)}/export?userId=${encodeURIComponent(App.user.id)}`;
    a.click();
  }

  function doDelete(s) {
    window.modal((box, close) => {
      const h = document.createElement('h3');
      h.textContent = '删除问卷？';
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = `“${s.title}” 及全部答卷将被删除，不可恢复。`;
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
          await App.api(`/api/surveys/${encodeURIComponent(s.id)}?userId=${encodeURIComponent(App.user.id)}`, { method: 'DELETE' });
          close();
          window.toast('已删除', 'ok');
          loadList();
        } catch (e) {
          window.toast(e.message, 'error');
        }
      };
      row.append(cancel, ok);
      box.append(h, tip, row);
    });
  }

  /* ---------- 绑定 ---------- */
  $('btn-new').addEventListener('click', () => {
    $('creator').hidden = false;
    if (!$('q-list').children.length) { addQuestionUI(); addQuestionUI(); }
    $('sv-title').focus();
  });
  $('btn-cancel-create').addEventListener('click', () => { $('creator').hidden = true; });
  $('btn-add-q').addEventListener('click', () => addQuestionUI());
  $('btn-create').addEventListener('click', create);
  $('chip-user').addEventListener('click', () => window.toast('到首页点右上角头像即可修改昵称与设备名'));

  App.socket.on('presence:update', (snap) => {
    $('chip-online').textContent = '👤 在线 ' + snap.online.count + ' 人';
  });

  loadList();
})();
