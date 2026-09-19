'use strict';
/**
 * 输出 ONLYOFFICE Document Server（Windows 安装器）最新官方下载地址。
 * 来源：GitHub Releases（官方发布渠道）。失败时无输出，调用方回退到固定地址。
 */
(async () => {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch('https://api.github.com/repos/ONLYOFFICE/DocumentServer/releases/latest', {
      headers: { 'User-Agent': 'lan-office-setup', Accept: 'application/vnd.github+json' },
      signal: ctl.signal
    });
    clearTimeout(timer);
    if (!r.ok) return;
    const rel = await r.json();
    const asset = (rel.assets || []).find((a) => a && a.name === 'onlyoffice-documentserver.exe');
    if (asset && asset.browser_download_url) console.log(asset.browser_download_url);
  } catch (_) { /* 无输出 → 回退 */ }
})();
