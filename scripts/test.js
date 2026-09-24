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

const jsonFetch = (url, method, body, userId) => fetch(url, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, userId ? { 'x-lan-user': userId } : {}),
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

    console.log('— 问卷功能 —');
    const creatorId = crypto.randomUUID();
    const studentId = crypto.randomUUID();
    let cr = await jsonFetch(BASE + '/api/surveys', 'POST', {
      title: '课堂小测：第一章',
      questions: [
        { text: 'LAN Office 用什么引擎编辑 Word？', options: ['ONLYOFFICE', '自己的 HTML 转换', 'Word 2010'] },
        { text: '协同编辑需要公网吗？', options: ['需要', '不需要，局域网即可'] }
      ],
      userId: creatorId,
      userName: '王老师'
    });
    const svData = await cr.json();
    ok('创建问卷', cr.status === 200 && svData.survey && svData.survey.questions.length === 2, JSON.stringify(svData).slice(0, 200));
    const svId = svData.survey.id;

    cr = await jsonFetch(BASE + '/api/surveys', 'POST', { title: '坏问卷', questions: [{ text: 'x', options: ['只有一个'] }], userId: creatorId });
    ok('非法问卷（选项不足）被拒绝', cr.status === 400);

    let lr = await (await fetch(BASE + '/api/surveys')).json();
    ok('问卷列表包含新问卷', lr.surveys.length === 1 && lr.surveys[0].responseCount === 0);

    await jsonFetch(`${BASE}/api/surveys/${svId}/submit`, 'POST', { userId: studentId, name: '李同学', device: '手机-A1', answers: [1, 0] });
    await jsonFetch(`${BASE}/api/surveys/${svId}/submit`, 'POST', { userId: creatorId, name: '王老师', device: '电脑-77', answers: [0, 1] });
    await jsonFetch(`${BASE}/api/surveys/${svId}/submit`, 'POST', { userId: studentId, name: '李同学', device: '手机-A1', answers: [0, 1] }); // 修改重交

    let gr = await (await fetch(`${BASE}/api/surveys/${svId}?userId=${creatorId}`)).json();
    ok('创建者视角：mine 标记 + 答卷数', gr.survey.mine === true && gr.survey.responseCount === 2, JSON.stringify(gr).slice(0, 200));
    ok('创建者视角：统计正确（修改重交只计最新）', JSON.stringify(gr.survey.tally) === '[[2,0,0],[0,2]]', JSON.stringify(gr.survey.tally));
    ok('创建者视角：答卷明细含设备名', gr.survey.responses.some((r) => r.device === '手机-A1'));
    gr = await (await fetch(`${BASE}/api/surveys/${svId}?userId=${studentId}`)).json();
    ok('学生视角：看不到他人明细但有我的答卷', gr.survey.mine === false && !gr.survey.responses && gr.survey.myResponse && gr.survey.myResponse.answers[0] === 0, JSON.stringify(gr).slice(0, 200));

    let ex = await fetch(`${BASE}/api/surveys/${svId}/export?userId=${creatorId}`);
    const raw = new Uint8Array(await ex.arrayBuffer());
    const hasBom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
    const csvText = new TextDecoder().decode(hasBom ? raw.slice(3) : raw);
    ok('创建者可导出 CSV（BOM + 标题 + 明细）', ex.status === 200 && hasBom && csvText.includes('课堂小测') && csvText.includes('李同学'), csvText.slice(0, 80));
    ex = await fetch(`${BASE}/api/surveys/${svId}/export?userId=${studentId}`);
    ok('学生导出被拒绝（403）', ex.status === 403);

    let svDel = await fetch(`${BASE}/api/surveys/${svId}?userId=${studentId}`, { method: 'DELETE' });
    ok('学生删除被拒绝（403）', svDel.status === 403);
    svDel = await fetch(`${BASE}/api/surveys/${svId}?userId=${creatorId}`, { method: 'DELETE' });
    ok('创建者删除成功', svDel.status === 200);
    lr = await (await fetch(BASE + '/api/surveys')).json();
    ok('删除后列表为空', lr.surveys.length === 0);

    console.log('— presence 含设备名 —');
    const pd1 = io(BASE, { auth: { userId: crypto.randomUUID(), name: 'Blue Fox', device: '平板-B2' } });
    await new Promise((res) => pd1.on('connect', res));
    pd1.emit('presence:join', created['xlsx'].id);
    await wait(500);
    r = await (await fetch(BASE + '/api/files')).json();
    const fu = r.files.find((f) => f.id === created['xlsx'].id);
    ok('编辑者信息包含设备名称', fu.editing.count === 1 && fu.editing.users[0].device === '平板-B2', JSON.stringify(fu.editing));
    pd1.disconnect();
    await wait(600);

    console.log('— 分组与权限 —');
    const tId = crypto.randomUUID();   // 教师
    const sA = crypto.randomUUID();    // 一组学生
    const sB = crypto.randomUUID();    // 二组学生
    let ar = await jsonFetch(BASE + '/api/auth/teacher', 'POST', { userId: tId, password: '1234' });
    ok('教师登录', ar.status === 200 && (await ar.json()).isTeacher === true);
    ar = await jsonFetch(BASE + '/api/auth/teacher', 'POST', { userId: tId, password: 'wrong' });
    ok('错误密码被拒绝（401）', ar.status === 401);

    ar = await jsonFetch(BASE + '/api/groups', 'POST', { name: '一组', userId: tId });
    const g1 = (await ar.json()).group;
    ar = await jsonFetch(BASE + '/api/groups', 'POST', { name: '二组', userId: tId });
    const g2 = (await ar.json()).group;
    ok('教师创建分组（含 4 位加入码）', ar.status === 200 && /^\d{4}$/.test(g1.code) && /^\d{4}$/.test(g2.code), JSON.stringify(g1));

    ar = await jsonFetch(BASE + '/api/auth/group', 'POST', { code: '0000', userId: sA });
    ok('错误加入码被拒绝（404）', ar.status === 404);
    ar = await jsonFetch(BASE + '/api/auth/group', 'POST', { code: g1.code, userId: sA });
    ok('学生加入分组', ar.status === 200 && (await ar.json()).group.name === '一组');

    ar = await jsonFetch(BASE + '/api/settings', 'PUT', { settings: { accessEnabled: true, studentVisibility: 'hidden' }, userId: tId });
    ok('开启访问控制', ar.status === 200 && (await ar.json()).settings.accessEnabled === true);

    ar = await jsonFetch(BASE + '/api/files/create', 'POST', { ext: 'docx', name: '学生偷建.docx', userId: sA });
    ok('学生新建文档被拒（403）', ar.status === 403);
    ar = await jsonFetch(BASE + '/api/files/upload', 'POST', { userId: sA });
    ok('学生上传被拒（403）', ar.status === 403);

    ar = await jsonFetch(BASE + '/api/files/create', 'POST', { ext: 'docx', name: '组A任务.docx', userId: tId });
    const fA = (await ar.json()).file;
    ar = await jsonFetch(BASE + '/api/files/create', 'POST', { ext: 'docx', name: '公共任务.docx', userId: tId });
    const fPub = (await ar.json()).file;
    ar = await jsonFetch(`${BASE}/api/files/${fA.id}/assign`, 'POST', { groupId: g1.id, userId: tId });
    ok('教师将文件归入组A', ar.status === 200 && (await ar.json()).file.groupId === g1.id);

    await jsonFetch(BASE + '/api/auth/group', 'POST', { code: g2.code, userId: sB });
    let fr = await (await fetch(BASE + '/api/files', { headers: { 'x-lan-user': sB } })).json();
    ok('组B学生看不到组A文档（隐藏模式）', !fr.files.some((f) => f.id === fA.id), JSON.stringify(fr.files.map((f) => f.name)));
    ok('组B学生可见公共文档（公共=人人可编辑）', fr.files.some((f) => f.id === fPub.id && f.readonly === false));
    fr = await (await fetch(BASE + '/api/files', { headers: { 'x-lan-user': sA } })).json();
    const faView = fr.files.find((f) => f.id === fA.id);
    ok('组A学生可编辑本组文档', !!faView && faView.readonly === false);
    ok('组A学生也可编辑公共文档', fr.files.some((f) => f.id === fPub.id && f.readonly === false));

    ar = await fetch(`${BASE}/api/files/${fA.id}/meta`, { headers: { 'x-lan-user': sB } });
    ok('组B学生访问组A文档 meta 返回 404', ar.status === 404);
    ar = await jsonFetch(`${BASE}/api/files/${fA.id}/editor-config`, 'POST', { userId: sB, userName: 'B' });
    ok('组B学生取组A编辑配置被拒（404）', ar.status === 404);
    ar = await jsonFetch(`${BASE}/api/files/${fA.id}/forcesave`, 'POST', { userId: sB });
    ok('只读文档 forcesave 被拒（403）', ar.status === 403);

    ar = await jsonFetch(BASE + '/api/settings', 'PUT', { settings: { studentVisibility: 'readonly' }, userId: tId });
    fr = await (await fetch(BASE + '/api/files', { headers: { 'x-lan-user': sB } })).json();
    ok('切换只读模式后组B可见组A文档', fr.files.some((f) => f.id === fA.id && f.readonly === true));
    ar = await fetch(`${BASE}/api/files/${fA.id}/meta`, { headers: { 'x-lan-user': sB } });
    const metaB = await ar.json();
    ok('只读文档 meta 返回 canEdit=false', ar.status === 200 && metaB.canEdit === false, JSON.stringify(metaB).slice(0, 120));
    ar = await fetch(`${BASE}/api/files/${fPub.id}/meta`, { headers: { 'x-lan-user': sB } });
    ok('公共文档 meta 返回 canEdit=true', ar.status === 200 && (await ar.json()).canEdit === true);

    ar = await jsonFetch(BASE + '/api/surveys', 'POST', { title: '学生卷', questions: [{ text: 'q', options: ['a', 'b'] }], userId: sA });
    ok('学生创建问卷被拒（403）', ar.status === 403);

    ar = await jsonFetch(`${BASE}/api/files/${fA.id}/rename`, 'POST', { name: '改名.try', userId: sB });
    ok('学生重命名被拒（403）', ar.status === 403);

    await jsonFetch(BASE + '/api/settings', 'PUT', { settings: { studentVisibility: 'hidden' }, userId: tId });
    ar = await jsonFetch(BASE + '/api/settings', 'PUT', { settings: { accessEnabled: false }, userId: tId });
    ok('关闭访问控制（回到人人可操作）', ar.status === 200);
    await jsonFetch(`${BASE}/api/files/${fA.id}`, 'DELETE', undefined, tId);
    await jsonFetch(`${BASE}/api/files/${fPub.id}`, 'DELETE', undefined, tId);
    ar = await jsonFetch(`${BASE}/api/groups/${g1.id}?userId=${tId}`, 'DELETE');
    ok('教师解散分组', ar.status === 200);
    await jsonFetch(`${BASE}/api/groups/${g2.id}?userId=${tId}`, 'DELETE');

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
