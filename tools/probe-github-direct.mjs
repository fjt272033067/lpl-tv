/* 一次性探针：绕过 hosts（Steam++ 加速器），直连真正的 github.com 验证仓库是否存在 */
import https from 'node:https';

function doh(host) {
  return new Promise((res, rej) => {
    https.get(
      { host: 'cloudflare-dns.com', path: '/dns-query?name=' + host + '&type=A', headers: { accept: 'application/dns-json' } },
      (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () => {
          try {
            res(JSON.parse(b).Answer.filter((a) => a.type === 1).map((a) => a.data));
          } catch (e) {
            rej(e);
          }
        });
      }
    ).on('error', rej);
  });
}

function get(ip, host, path) {
  return new Promise((res) => {
    const req = https.get({ host: ip, servername: host, path, headers: { host, 'user-agent': 'probe' } }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => res({ code: r.statusCode, body: b }));
    });
    req.on('error', (e) => res({ code: 'ERR', body: e.message }));
  });
}

const ips = await doh('github.com');
console.log('真实 github.com IP:', ips.join(', '));
for (const [host, path] of [
  ['github.com', '/fj272033067'],
  ['github.com', '/fj272033067/lpl-tv'],
  ['api.github.com', '/repos/fj272033067/lpl-tv'],
  ['api.github.com', '/users/fj272033067'],
]) {
  const r = await get(ips[0], host, path);
  let extra = '';
  if (r.code === 200) {
    const m = r.body.match(/"full_name":"[^"]+"|"login":"[^"]+"|"visibility":"[^"]+"/);
    extra = m ? '  ' + m[0] : '';
  }
  console.log('  ' + host + path + ' → ' + r.code + extra);
}
