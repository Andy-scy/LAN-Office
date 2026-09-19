'use strict';
/**
 * 局域网地址探测：枚举 IPv4 网卡，过滤虚拟网卡，优先 192.168.* / 10.* / 172.16-31.*
 */
const os = require('os');

const VIRTUAL_PATTERN = /vethernet|wsl|docker|vmware|virtualbox|hyper-v|loopback|tap|tun|virtual|vpn/i;

function privateScore(ip) {
  if (/^192\.168\./.test(ip)) return 4;
  if (/^10\./.test(ip)) return 3;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 1;
}

/**
 * @returns {{primary:string, all:Array<{name:string,address:string,virtual:boolean,preferred:number}>}}
 */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const virtual = VIRTUAL_PATTERN.test(name);
      out.push({
        name,
        address: a.address,
        virtual,
        preferred: privateScore(a.address) + (virtual ? -5 : 0)
      });
    }
  }
  out.sort((x, y) => y.preferred - x.preferred);
  return { primary: out.length ? out[0].address : '127.0.0.1', all: out };
}

module.exports = { lanAddresses };
