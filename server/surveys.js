'use strict';
/**
 * 简单问卷：创建者设置选择题，学生提交答案，创建者查看统计并导出 CSV。
 * 存储：data/surveys/{id}.json（原子写入）。无账号系统，创建者以 userId 识别。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

let dir = null;

function init() {
  dir = path.join(config.dataPath, 'surveys');
  fs.mkdirSync(dir, { recursive: true });
}

const ID_RE = /^[0-9a-f-]{8,64}$/i;

function clean(text, max) {
  return String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function save(survey) {
  const tmp = path.join(dir, survey.id + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(survey, null, 2), 'utf8');
  fs.renameSync(tmp, path.join(dir, survey.id + '.json'));
}

function load(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('非法问卷 ID');
  const p = path.join(dir, id + '.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function create(body) {
  const title = clean(body.title, 80);
  if (!title) throw new Error('问卷标题不能为空');
  const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
  if (rawQuestions.length < 1 || rawQuestions.length > 20) throw new Error('问题数量需在 1-20 之间');
  const questions = rawQuestions.map((q, i) => {
    const text = clean(q && q.text, 200);
    if (!text) throw new Error(`第 ${i + 1} 题的题目不能为空`);
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => clean(o, 60))
      .filter(Boolean);
    if (options.length < 2 || options.length > 6) throw new Error(`第 ${i + 1} 题需要 2-6 个选项`);
    if (new Set(options).size !== options.length) throw new Error(`第 ${i + 1} 题的选项不能重复`);
    return { text, options };
  });
  const user = body.user || {};
  const survey = {
    id: crypto.randomUUID(),
    title,
    questions,
    createdBy: { id: String(user.id || ''), name: clean(user.name, 24) || '匿名' },
    createdAt: Date.now(),
    responses: []
  };
  save(survey);
  return publicView(survey, false, null);
}

function list(requesterId) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch (_) { /* 跳过损坏文件 */ }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.map((s) => publicView(s, false, requesterId));
}

function get(id, requesterId) {
  const s = load(id);
  if (!s) return null;
  return publicView(s, isCreator(s, requesterId), requesterId);
}

function isCreator(survey, requesterId) {
  return !!requesterId && String(requesterId) === String(survey.createdBy.id);
}

function publicView(survey, withResults, requesterId) {
  const view = {
    id: survey.id,
    title: survey.title,
    questions: survey.questions,
    createdBy: survey.createdBy,
    createdAt: survey.createdAt,
    responseCount: survey.responses.length,
    mine: isCreator(survey, requesterId)
  };
  if (withResults) {
    view.tally = survey.questions.map((q, qi) => {
      const counts = q.options.map(() => 0);
      for (const r of survey.responses) {
        const a = r.answers[qi];
        if (Number.isInteger(a) && a >= 0 && a < counts.length) counts[a]++;
      }
      return counts;
    });
    view.responses = survey.responses;
  } else if (requesterId) {
    const mine = survey.responses.find((r) => r.userId === String(requesterId));
    if (mine) view.myResponse = { answers: mine.answers, submittedAt: mine.submittedAt };
  }
  return view;
}

function submit(id, body) {
  const s = load(id);
  if (!s) throw new Error('问卷不存在');
  const userId = String(body.userId || '');
  if (!ID_RE.test(userId)) throw new Error('非法用户身份');
  if (!Array.isArray(body.answers) || body.answers.length !== s.questions.length) {
    throw new Error('答案数量与问题数量不匹配');
  }
  const answers = body.answers.map((a, i) => {
    const n = Number(a);
    if (!Number.isInteger(n) || n < 0 || n >= s.questions[i].options.length) {
      throw new Error(`第 ${i + 1} 题的答案无效`);
    }
    return n;
  });
  const existing = s.responses.find((r) => r.userId === userId);
  if (existing) {
    existing.answers = answers;
    existing.name = clean(body.name, 24) || existing.name;
    existing.device = clean(body.device, 24) || existing.device;
    existing.submittedAt = Date.now();
  } else {
    s.responses.push({
      userId,
      name: clean(body.name, 24) || '匿名',
      device: clean(body.device, 24) || '',
      answers,
      submittedAt: Date.now()
    });
  }
  save(s);
  return { ok: true, responseCount: s.responses.length };
}

function remove(id, requesterId) {
  const s = load(id);
  if (!s) return false;
  if (!isCreator(s, requesterId)) {
    const e = new Error('只有问卷创建者可以删除');
    e.status = 403;
    throw e;
  }
  fs.rmSync(path.join(dir, s.id + '.json'), { force: true });
  return true;
}

function csv(id, requesterId) {
  const s = load(id);
  if (!s) return null;
  if (!isCreator(s, requesterId)) {
    const e = new Error('只有问卷创建者可以导出结果');
    e.status = 403;
    throw e;
  }
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [];
  lines.push(esc('问卷：' + s.title));
  lines.push([esc('昵称'), esc('设备'), esc('提交时间')].concat(s.questions.map((q, i) => esc(`第${i + 1}题：${q.text}`))).join(','));
  for (const r of s.responses) {
    const cells = [esc(r.name), esc(r.device), esc(new Date(r.submittedAt).toLocaleString('zh-CN', { hour12: false }))];
    r.answers.forEach((a, i) => cells.push(esc(s.questions[i].options[a] || '')));
    lines.push(cells.join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

module.exports = { init, create, list, get, submit, remove, csv };
