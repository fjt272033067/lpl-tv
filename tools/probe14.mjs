// Probe v14: corrected binary auth WS + danmaku XML size/parse test
import https from 'node:https';
import crypto from 'node:crypto';

const ROOM = 7734200;
const HOST = 'broadcastlv.chat.bilibili.com';

function maskFrame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const mask = crypto.randomBytes(4);
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([opcode, 0x80 | len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** bilibili auth packet: 16-byte header + JSON */
function authPacket(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16 + json.length, 0); // packet length
  head.writeUInt32BE(7, 4); // op = 7 (AUTH)
  head.writeUInt32BE(1, 8); // version = 1
  head.writeUInt32BE(1, 12); // sequence = 1
  return Buffer.concat([head, json]);
}

function parseFrames(buf) {
  const out = [];
  let pos = 0;
  while (pos + 2 <= buf.length) {
    const b0 = buf[pos];
    const b1 = buf[pos + 1];
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let p = pos + 2;
    if (len === 126) {
      if (p + 2 > buf.length) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    if (b1 & 0x80) {
      if (p + 4 > buf.length) break;
      const mk = buf.subarray(p, p + 4);
      p += 4;
      if (p + len > buf.length) break;
      const pl = Buffer.from(buf.subarray(p, p + len));
      for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i % 4];
      out.push({ opcode, payload: pl });
      pos = p + len;
    } else {
      if (p + len > buf.length) break;
      out.push({ opcode, payload: Buffer.from(buf.subarray(p, p + len)) });
      pos = p + len;
    }
  }
  return { frames: out, rest: buf.subarray(pos) };
}

async function wsTest(label, uid, key) {
  return new Promise((resolve) => {
    const req = https.request({
      host: HOST,
      port: 443,
      path: '/sub',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Origin: 'https://live.bilibili.com',
      },
    });
    let acc = Buffer.alloc(0);
    let dm = 0;
    const notes = [];
    let finished = false;
    let timer = null;
    const finish = (why) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.log(`   ${label}: ${why} danmaku=${dm}`);
      notes.slice(0, 5).forEach((n) => console.log(`      ${n}`));
      resolve();
    };
    req.on('upgrade', (res, socket) => {
      socket.write(maskFrame(authPacket({ uid, roomid: ROOM, protover: 3, platform: 'web', type: 2, key }), 0x2));
      socket.on('data', (chunk) => {
        acc = Buffer.concat([acc, chunk]);
        const { frames, rest } = parseFrames(acc);
        acc = rest;
        for (const f of frames) {
          if (f.opcode === 0x8) return finish('close-frame');
          if (f.opcode !== 0x2 && f.opcode !== 0x1) continue;
          const b = f.payload;
          if (b.length < 4) continue;
          const op = b.readUInt32BE(0);
          if (op === 8) {
            const code = b.length >= 16 ? b.readInt32BE(8) : null;
            notes.push(`AUTH-REPLY code=${code}`);
          } else if (op === 5) {
            let body = b.subarray(16);
            if (body.length > 2 && body[0] === 0 && body[1] === 0) body = body.subarray(2);
            const s = body.toString('utf8');
            if (s.includes('DANMU_MSG')) {
              dm++;
              if (dm <= 3) notes.push('DM ' + s.slice(0, 150));
            } else if (notes.length < 5) notes.push('op5 ' + s.slice(0, 100));
          }
        }
      });
      socket.on('close', () => finish('socket closed'));
      socket.on('error', (e) => finish('err ' + e.message));
      timer = setTimeout(() => finish('timeout'), 18000);
    });
    req.on('error', (e) => finish('req err ' + e.message));
    req.end();
  });
}

console.log('=== WS auth variants ===');
await wsTest('uid=0 token=true', 0, 'token=true');
await wsTest('uid=0 no key', 0, '');
await wsTest('uid=1 token=true', 1, 'token=true');

console.log('\n=== danmaku XML size/parse ===');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const bvid = 'BV1n5na61Eev';
const view = await (
  await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
  })
).json();
const cid = view.data.cid;
console.log(`  ${bvid} cid=${cid} title=${view.data.title} dur=${view.data.duration}`);
const xmlRes = await fetch(`https://comment.bilibili.com/${cid}.xml`, {
  headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${bvid}/` },
});
const xml = await xmlRes.text();
console.log(`  xml status=${xmlRes.status} bytes=${Buffer.byteLength(xml)}`);
const re = /<d p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
let m;
let n = 0;
const modes = {};
const t0 = Date.now();
const items = [];
while ((m = re.exec(xml)) !== null) {
  const p = m[1].split(',');
  items.push([+p[0] || 0, +p[1] || 1, +p[3] || 16777215, +p[2] || 25, m[2]]);
  modes[p[1]] = (modes[p[1]] || 0) + 1;
  n++;
}
console.log(`  parsed ${n} danmaku in ${Date.now() - t0}ms; modes=${JSON.stringify(modes)}`);
console.log(`  sample: ${JSON.stringify(items.slice(0, 4))}`);
const json = JSON.stringify({ cid, items });
console.log(`  compact json bytes=${Buffer.byteLength(json)}`);
console.log(`  gz estimate=${Buffer.byteLength(require('node:zlib').gzipSync(json))}`);
