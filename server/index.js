'use strict';
/**
 * LAN Office 入口：
 * 找可用端口 → 启动 HTTP 服务（0.0.0.0）→ 打印局域网地址 → 探测 OnlyOffice 引擎 → 自动打开浏览器
 */
const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');

const config = require('./config');
const fileManager = require('./fileManager');
const surveys = require('./surveys');
const access = require('./access');
const ds = require('./onlyoffice');
const { lanAddresses } = require('./network');
const { registerRoutes, setPort } = require('./routes');
const { attach: attachWebsocket } = require('./websocket');

const VERSION = '1.3.0';

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start, tries = 40) {
  for (let p = start; p < start + tries; p++) {
    if (await isPortFree(p)) return { port: p, changed: p !== start };
  }
  throw new Error(`端口 ${start} 起连续 ${tries} 个端口都被占用`);
}

function banner(port, portChanged) {
  const { primary, all } = lanAddresses();
  const st = ds.status();
  const line = '='.repeat(60);
  const url = (host) => `http://${host}:${port}`;
  const consoleUrl = `http://localhost:${port}`;
  const lanUrl = url(primary);

  console.log('');
  console.log(line);
  console.log('  LAN Office · 局域网多人协同办公  v' + VERSION);
  console.log(line);
  console.log('  服务已启动 ✔   (监听 0.0.0.0)');
  console.log('');
  console.log(`  本机访问:    ${consoleUrl}`);
  console.log(`  局域网访问:  ${lanUrl}   ← 其他设备（手机/平板/电脑）用这个`);
  if (all.filter((a) => a.address !== primary).length) {
    console.log('  其他候选地址:');
    for (const a of all) {
      if (a.address === primary) continue;
      console.log(`    - ${url(a.address)}   (${a.name}${a.virtual ? '，虚拟网卡' : ''})`);
    }
  }
  console.log('');
  if (st.available) {
    console.log(`  Office 编辑引擎: ✔ 已连接  ${st.url}`);
    console.log(`  编辑引擎访问地址: ${ds.publicDsUrl()}  （局域网设备会直接访问它）`);
    if (st.jwt) console.log(`  JWT 密钥: ✔ 已读取 (${st.jwtSource})`);
  } else {
    console.log('  Office 编辑引擎: ✘ 未检测到 ONLYOFFICE Document Server');
    console.log('    → 文件管理功能不受影响；在线编辑 Office 需先安装 ONLYOFFICE Docs 社区版');
    console.log('    → 下载地址: https://www.onlyoffice.com/download-docs.aspx  （详见 README）');
  }
  console.log(`  数据目录: ${config.dataPath}`);
  console.log(`  教师管理密码: ${config.teacherPassword}   （登录"管理面板"用，可在 config/config.json 修改）`);
  console.log('');
  if (process.platform === 'win32') {
    console.log('  提示: 如果其他设备无法访问，多半是 Windows 防火墙：');
    console.log('    1) 首次运行弹出防火墙提示时，请勾选“专用网络”并点击“允许访问”；');
    console.log(`    2) 或以管理员身份运行:  netsh advfirewall firewall add rule name="LAN Office" dir=in action=allow protocol=TCP localport=${port}`);
    console.log('');
  }
  if (portChanged) {
    console.log(`  注意: 默认端口 ${config.port} 被占用，已自动改用 ${port}。`);
    console.log('');
  }
  console.log('  按 Ctrl+C 停止服务');
  console.log(line);
  console.log('');

  if (process.platform === 'win32' && config.autoOpenBrowser) {
    setTimeout(() => {
      try { exec(`start "" "${consoleUrl}"`); } catch (_) { /* 忽略 */ }
    }, 800);
  }
}

async function main() {
  fileManager.init();
  surveys.init();
  access.init();
  const { port, changed } = await findFreePort(config.port);
  setPort(port);
  ds.setRuntimePort(port);

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  registerRoutes(app);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const server = http.createServer(app);
  attachWebsocket(server);
  server.listen(port, config.host);

  // 先做一次引擎探测再打印横幅（最多等 ~5 秒）
  try { await Promise.race([ds.detect(true), new Promise((r) => setTimeout(r, 5000))]); } catch (_) { /* 忽略 */ }
  ds.startMonitor();
  banner(port, changed);

  const shutdown = () => {
    console.log('\n正在停止 LAN Office ...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[启动失败]', e.message);
  process.exit(1);
});
