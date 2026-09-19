'use strict';
/**
 * 探测本机 ONLYOFFICE Document Server 是否在运行（/healthcheck）。
 * 输出：可用端口号（只一行）；未检测到则无输出。供 setup.bat 调用。
 */
const PORTS = [80, 8080, 8090, 8000, 8888];

(async () => {
  for (const p of PORTS) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(`http://127.0.0.1:${p}/healthcheck`, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok && (await r.text()).trim().toLowerCase() === 'true') {
        console.log(p);
        return;
      }
    } catch (_) { /* 换下一个端口 */ }
  }
})();
