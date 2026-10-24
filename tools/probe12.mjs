// Probe v12: raw WS upgrade handshake to bilibili danmaku server
import https from 'node:https';
import crypto from 'node:crypto';

function handshake(host, path, extraHeaders = {}) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Origin: 'https://live.bilibili.com',
          ...extraHeaders,
        },
      },
      (res) => {
        resolve({ status: res.statusCode, headers: res.headers });
        res.destroy();
      }
    );
    req.on('upgrade', (res, socket) => {
      resolve({ status: 101, headers: res.headers, upgraded: true, socket });
      socket.destroy();
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(12000, () => {
      resolve({ error: 'timeout' });
      req.destroy();
    });
    req.end();
  });
}

const hosts = ['broadcastlv.chat.bilibili.com'];
for (const h of hosts) {
  console.log(`=== ${h} ===`);
  for (const [tag, hdrs] of [
    ['with Origin', {}],
    ['no Origin', { Origin: undefined }],
    ['browser-ish', { 'Accept-Language': 'zh-CN,zh;q=0.9', 'Accept-Encoding': 'gzip, deflate, br' }],
  ]) {
    const clean = Object.fromEntries(Object.entries(hdrs).filter(([, v]) => v !== undefined));
    const r = await handshake(h, '/sub', clean);
    console.log(
      `   ${tag.padEnd(14)} status=${r.status || '-'} upgraded=${r.upgraded || false} err=${r.error || '-'} ${
        r.headers ? JSON.stringify(r.headers).slice(0, 160) : ''
      }`
    );
  }
}
