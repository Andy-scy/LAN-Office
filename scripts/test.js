'use strict';
/**
 * 集成测试（原则 9：关键功能必须实际测试）。
 * 覆盖：启动 / 局域网地址 / 新建 / 上传（中文与特殊名）/ 下载 / 重命名 / 冲突 /
 *       路径穿越 / 保存回调（备份+替换+版本）/ 备份恢复 / 删除 / presence /
 *       引擎离线兜底 / 端口占用自增 / 手动放文件自动识别。
 * 运行：npm test
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { io } = require('socket.io-client');

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const DATA_TEST = path.join(ROOT, 'data-test');
const DATA_TEST2 = path.join(ROOT, 'data-test-2');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  \u2714 ' + name); }
  else { failed++; failures.push(name + (extra ? ' \u2014 ' + extra : '')); console.log('  \u2718 ' + name + (extra ? ' \u2014 ' + String(extra).slice(0, 300) : '')); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(base, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return true; } catch (_) { /* 未就绪 */ }
    await wait(300);
  }
  return false;
}

function spawnServer(port, dataDir) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      LANOFFICE_DATA_DIR: dataDir,
      LANOFFICE_NO_OPEN: '1',
      LANOFFICE_DS_DISABLE: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child._getOut = () => out;
  return child;
}

const jsonFetch = (url, method, body) => fetch(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});

async function main() {
  for (const d of [DATA_TEST, DATA_TEST2]) fs.rmSync(d, { recursive: true, force: true });
  const tplDocx = fs.readFileSync(path.join(ROOT, 'server', 'templates', 'blank.docx'));

  console.log('— 启动与基础信息 —');
  const child = spawnServer(PORT, 'data-test');
  try {
    ok('服务启动并响应 /healthz', await waitForServer(BASE));

    const info = await (await fetch(BASE + '/api/info')).json();
    ok('自动获取局域网 IPv4（非 127.0.0.1）',
      /^(\d{1,3}\.){3}\d{1,3}$/.test(info.primary) && info.primary !== '127.0.0.1', 'primary=' + info.primary);
    ok('引擎离线时 /api/info 正确标记', info.ds && info.ds.available === false);

    let r = await (await fetch(BASE + '/api/files')).json();
    ok('初始文件列表为空', Array.isArray(r.files) && r.files.length === 0, JSON.stringify(r).slice(0, 120));

    console.log('— 新建空白文档 —');
    const created = {};
    for (const [ext, name] of [['docx', '新建文档.docx'], ['xlsx', '新建表格.xlsx'], ['pptx', '新建演示.pptx']]) {
      const cr = await jsonFetch(BASE + '/api/files/create', 'POST', { ext, name });
      const data = await cr.json();
      ok(`新建 ${ext}`, cr.status === 200 && data.file && data.file.name === name, JSON.stringify(data).slice(0, 200));
      created[ext] = data.file;
    }
    const docxPath = path.join(DATA_TEST, 'documents', '新建文档.docx');
    ok('新建文档已落盘', fs.existsSync(docxPath));
    const head = Buffer.alloc(2);
    const fd = fs.openSync(docxPath, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
    ok('生成的 docx 是合法 ZIP（PK 头）', head.toString('latin1') === 'PK');

    console.log('— 上传 —');
    const form = new FormData();
    form.append('files', new Blob([tplDocx]), '项目计划.docx');
    form.append('files', new Blob([Buffer.from('a,b,c\n1,2,3')]), '数据 报表.csv');
    form.append('names', JSON.stringify(['项目计划.docx', '数据 报表.csv']));
    let up = await fetch(BASE + '/api/files/upload', { method: 'POST', body: form });
    const upData = await up.json();
    ok('上传中文名文件（名字正确）', up.status === 200 && upData.files[0] && upData.files[0].name === '项目计划.docx', JSON.stringify(upData).slice(0, 300));
    ok('上传 CSV', up.status === 200 && upData.files[1] && upData.files[1].name === '数据 报表.csv');
    const proj = upData.files[0];

    const form5 = new FormData();
    form5.append('files', new Blob([tplDocx]), '无名字段上传.docx');
    up = await fetch(BASE + '/api/files/upload', { method: 'POST', body: form5 });
    const up5 = await up.json();
    ok('无 names 字段时 UTF-8 文件名修复', up.status === 200 && up5.files[0] && up5.files[0].name === '无名字段上传.docx', JSON.stringify(up5).slice(0, 300));

    const form2 = new FormData();
    form2.append('files', new Blob([Buffer.from('evil')]), 'evil.exe');
    up = await fetch(BASE + '/api/files/upload', { method: 'POST', body: form2 });
    ok('拒绝 .exe 上传', up.status === 400, (await up.text()).slice(0, 200));

    const form3 = new FormData();
    form3.append('files', new Blob([tplDocx]), 'CON.docx');
    up = await fetch(BASE + '/api/files/upload', { method: 'POST', body: form3 });
    const up3 = await up.json();
    ok('Windows 保留名被清洗', up.status === 200 && up3.files[0] && up3.files[0].name === '_CON.docx', JSON.stringify(up3).slice(0, 200));

    r = await (await fetch(BASE + '/api/files')).json();
    ok('文件列表数量正确（3 新建 + 4 上传）', r.files.length === 7, 'got ' + r.files.length);

    console.log('— 下载 / 重命名 / 冲突 / 穿越 —');
    const dl = await fetch(`${BASE}/api/files/${proj.id}/download`);
    ok('下载内容与上传一致', Buffer.from(await dl.arrayBuffer()).equals(tplDocx));
    ok('下载响应头含 RFC5987 UTF-8 文件名', (dl.headers.get('content-disposition') || '').includes("filename*=UTF-8''"));

    let rn = await jsonFetch(`${BASE}/api/files/${proj.id}/rename`, 'POST', { name: '项目计划 v2' });
    const rnData = await rn.json();
    ok('重命名（缺扩展名时自动保留）', rn.status === 200 && rnData.file && rnData.file.name === '项目计划 v2.docx', JSON.stringify(rnData).slice(0, 200));

    rn = await jsonFetch(`${BASE}/api/files/${proj.id}/rename`, 'POST', { name: '新建文档.docx' });
    ok('同名冲突返回 400', rn.status === 400);

    rn = await jsonFetch(`${BASE}/api/files/${proj.id}/rename`, 'POST', { name: '../../evil' });
    const rn2 = await rn.json();
    ok('重命名穿越被清洗（无 / 与 ..）', rn.status === 200 && rn2.file && !rn2.file.name.includes('/') && !rn2.file.name.includes('..'), JSON.stringify(rn2).slice(0, 200));

    const tr = await fetch(`${BASE}/api/files/..%2F..%2Fserver%2Findex.js/download`);
    ok('按 ID 下载拒绝路径穿越', tr.status === 400, String(tr.status));

    console.log('— 保存回调：备份 + 原子替换 + 版本 —');
    const modified = Buffer.concat([tplDocx, Buffer.from('<!--saved-marker-->')]);
    const form4 = new FormData();
    form4.append('files', new Blob([modified]), 'staged.docx');
    up = await fetch(BASE + '/api/files/upload', { method: 'POST', body: form4 });
    const staged = (await up.json()).files[0];

    const target = created['docx'];
    const cb = await jsonFetch(BASE + '/api/onlyoffice/callback', 'POST', {
      key: `${target.id}_1`, status: 2, url: `${BASE}/api/files/${staged.id}/download`
    });
    const cbData = await cb.json();
    ok('回调保存成功', cb.status === 200 && cbData.error === 0, JSON.stringify(cbData).slice(0, 200));

    const dl2 = await fetch(`${BASE}/api/files/${target.id}/download`);
    ok('回调后文件内容已替换', Buffer.from(await dl2.arrayBuffer()).equals(modified));

    let metaR = await (await fetch(`${BASE}/api/files/${target.id}/meta`)).json();
    ok('版本递增并更换 key（房间空闲时）', metaR.file.version === 2, JSON.stringify(metaR.file));

    const bk = await (await fetch(`${BASE}/api/files/${target.id}/backups`)).json();
    ok('保存前自动生成备份', bk.backups.length === 1, JSON.stringify(bk).slice(0, 200));

    const rs = await jsonFetch(`${BASE}/api/files/${target.id}/backups/restore`, 'POST', { file: bk.backups[0].file });
    ok('恢复备份成功', rs.status === 200);
    const dl3 = await fetch(`${BASE}/api/files/${target.id}/download`);
    ok('恢复后内容还原', Buffer.from(await dl3.arrayBuffer()).equals(tplDocx));

    console.log('— 删除与占用保护 —');
    const del = await fetch(`${BASE}/api/files/${target.id}`, { method: 'DELETE' });
    ok('删除文件', del.status === 200);
    const del404 = await fetch(`${BASE}/api/files/${target.id}`, { method: 'DELETE' });
    ok('重复删除返回 404', del404.status === 404);

    console.log('— presence（协同在线状态）—');
    const s1 = io(BASE, { auth: { userId: crypto.randomUUID(), name: 'Blue Fox' } });
    const s2 = io(BASE, { auth: { userId: crypto.randomUUID(), name: 'Green Cat' } });
    await new Promise((res) => s1.on('connect', res));
    await new Promise((res) => s2.on('connect', res));
    const seen = [];
    s1.on('presence:update', (s) => seen.push(s));
    const xlsxFile = created['xlsx'];
    s1.emit('presence:join', xlsxFile.id);
    s2.emit('presence:join', xlsxFile.id);
    await wait(500);
    r = await (await fetch(BASE + '/api/files')).json();
    const fx = r.files.find((f) => f.id === xlsxFile.id);
    ok('两人同时编辑计数=2', fx.editing.count === 2 && fx.editing.users.length === 2, JSON.stringify(fx.editing));
    ok('编辑者昵称正确', fx.editing.users.some((u) => u.name === 'Blue Fox') && fx.editing.users.some((u) => u.name === 'Green Cat'), JSON.stringify(fx.editing.users));

    s2.disconnect();
    await wait(700);
    r = await (await fetch(BASE + '/api/files')).json();
    ok('一人断开后计数=1', r.files.find((f) => f.id === xlsxFile.id).editing.count === 1);

    const delBusy = await fetch(`${BASE}/api/files/${xlsxFile.id}`, { method: 'DELETE' });
    ok('编辑中禁止删除（409）', delBusy.status === 409);

    s1.disconnect();
    await wait(700);
    r = await (await fetch(BASE + '/api/files')).json();
    ok('全部离开后计数=0', r.files.find((f) => f.id === xlsxFile.id).editing.count === 0);

    console.log('— 引擎离线兜底 —');
    const ec = await jsonFetch(`${BASE}/api/files/${created['pptx'].id}/editor-config`, 'POST', { userId: crypto.randomUUID(), userName: 'Tester' });
    ok('引擎离线时 editor-config 返回 503 引导', ec.status === 503);
    const fsr = await jsonFetch(`${BASE}/api/files/${created['pptx'].id}/forcesave`, 'POST');
    const fsData = await fsr.json();
    ok('引擎离线时 forcesave 优雅返回', fsr.status === 200 && fsData.ok === false, JSON.stringify(fsData));

    console.log('— 端口占用自增 + 手动放文件自动识别 —');
    const child2 = spawnServer(PORT, 'data-test-2');
    const base2 = `http://127.0.0.1:${PORT + 1}`;
    ok('端口被占用时自动使用下一个端口', await waitForServer(base2), child2._getOut().slice(-400));

    child2.kill();
    await wait(500);
    fs.copyFileSync(path.join(ROOT, 'server', 'templates', 'blank.docx'), path.join(DATA_TEST2, 'documents', '手工放入.docx'));
    const child3 = spawnServer(PORT + 1, 'data-test-2');
    ok('重启后服务可用', await waitForServer(base2));
    r = await (await fetch(base2 + '/api/files')).json();
    ok('手动放进 documents 的文件被自动登记', r.files.some((f) => f.name === '手工放入.docx'), JSON.stringify(r.files.map((f) => f.name)));
    child3.kill();
  } finally {
    child.kill();
  }

  console.log(`\n===== 测试结果：${passed} 通过，${failed} 失败 =====`);
  if (failures.length) {
    console.log('失败项：\n - ' + failures.join('\n - '));
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('[测试脚本异常]', e); process.exit(1); });
