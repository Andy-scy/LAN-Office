'use strict';
/* 交互式修改教师管理密码：直接设置新密码（无需原密码，本机管理员操作）。
   由 修改教师密码.bat 调用；也可直接 node scripts/change-teacher-password.js */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const cfgPath = path.join(__dirname, '..', 'config', 'config.json');

function ask(rl, q) {
  return new Promise((res) => rl.question(q, res));
}

(async () => {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    console.error('读取 config/config.json 失败：' + e.message);
    console.error('请确认本脚本位于项目目录内运行。');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let pass = '';
  for (;;) {
    pass = (await ask(rl, '请输入新的教师管理密码（4~24 位，输入时可见）：')).trim();
    if (pass.length >= 4 && pass.length <= 24) break;
    console.log('  × 密码长度需在 4~24 位之间（当前 ' + pass.length + ' 位），请重新输入。');
  }
  rl.close();

  cfg.teacherPassword = pass;
  const tmp = cfgPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, cfgPath);

  console.log('');
  console.log('已完成：教师管理密码已更新。');
  console.log('');
  console.log('注意：');
  console.log('  1. 若 LAN Office 正在运行，请关掉 start.bat 的黑窗口并重新双击 start.bat，新密码才会生效。');
  console.log('  2. 之前已登录教师身份的电脑会保留身份，直到有新电脑用新密码登录一次（登录即接管）。');
  process.exit(0);
})().catch((e) => {
  console.error('出错：' + e.message);
  process.exit(1);
});
