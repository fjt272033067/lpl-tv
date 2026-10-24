// Probe v16: real danmaku token via curl + WS with real token + no-auth WS
import https from 'node:https';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOM = 7734200;
const HOST = 'broadcastlv.chat.bilibili.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function curl(url, headers = []) {
  const args = ['curl.exe', '-s', '--max-time', '25', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  return execSync(args.join(' '), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

console.log('=== token via curl w/ buvid3 ===');
let buvid3 = '';
try {
  const spi = JSON.parse(curl('https://api.bilibili.com/x/frontend/finger/spi'));
  buvid3 = spi.data.b_3;
  console.log(`  buvid3=${String(buvid3).slice(0, 14)}...`);
} catch (e) {
  console.log(`  spi fail`);
}
const ck = `buvid3=${buvid3}; b_nut=${Math.floor(Date.now() / 1000)}; b_lsid=${buvid3}XX`;
let token = '';
for (const extra of ['', '&web_location=444.8']) {
  try {
    const raw = curl(
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0${extra}`,
      [`Referer: https://live.bilibili.com/${ROOM}`, `Cookie: ${ck}`]
    );
    console.log(`  ${extra || 'plain'} -> ${raw.slice(0, 160)}`);
    try {
      const j = JSON.parse(raw);
      if (j.data && j.data.token) token = j.data.token;
    } catch {}
  } catch (e) {
    console.log(`  ${extra} err ${e.message}`);
  }
}
console.log(`  TOKEN=${token ? token.slice(0, 40) + '...' : '(none)'}`);

function maskFrame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const mask = crypto.randomBytes(4);
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([opcode, 0x80 | len]);
  else {
    header = Buffer.alloc(4);
    header[0] = opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}
function biliPacket(op, obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16 + json.length, 0);
  head.writeUInt32BE(16, 4);
  head.writeUInt32BE(1, 8);
  head.writeUInt32BE(op, 12);
  return Buffer.concat([head, json]);
}
function parseFrames(buf) {
  const out = [];
  let pos = 0;
  while (pos + 2 <= buf.length) {
    const b0 = buf[pos], b1 = buf[pos + 1];
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let p = pos + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (b1 & 0x80) {
      if (p + 4 > buf.length) break;
      const mk = buf.subarray(p, p + 4); p += 4;
      if (p + len > buf.length) break;
      const pl = Buffer.from(buf.subarray(p, p + len));
      for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i % 4];
      out.push({ opcode, payload: pl }); pos = p + len;
    } else {
      if (p + len > buf.length) break;
      out.push({ opcode, payload: Buffer.from(buf.subarray(p, p + len)) }); pos = p + len;
    }
  }
  return { frames: out, rest: buf.subarray(pos) };
}

async function wsTest(label, opts) {
  return new Promise((resolve) => {
    const req = https.request({
      host: HOST, port: 443, path: '/sub',
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13', 'User-Agent': UA, Origin: 'https://live.bilibili.com',
      },
    });
    let acc = Buffer.alloc(0), dm = 0;
    const notes = [];
    let done = false, timer = null;
    const finish = (why) => {
      if (done) return; done = true; clearTimeout(timer);
      console.log(`   ${label}: ${why} danmaku=${dm}`);
      notes.slice(0, 3).forEach((n) => console.log(`      ${n}`));
      resolve();
    };
    req.on('upgrade', (res, socket) => {
      if (opts.auth) socket.write(maskFrame(biliPacket(7, opts.auth), 0x2));
      socket.on('data', (chunk) => {
        acc = Buffer.concat([acc, chunk]);
        const { frames, rest } = parseFrames(acc); acc = rest;
        for (const f of frames) {
          if (f.opcode === 0x8) return finish('close-frame');
          if (f.opcode !== 0x2 && f.opcode !== 0x1) continue;
          const b = f.payload; if (b.length < 4) continue;
          const op = b.readUInt32BE(0);
          if (op === 8) notes.push(`AUTH-REPLY code=${b.length >= 16 ? b.readInt32BE(8) : '?'}`);
          else if (op === 5) {
            let body = b.subarray(16);
            if (body.length > 2 && body[0] === 0 && body[1] === 0) body = body.subarray(2);
            const s = body.toString('utf8');
            if (s.includes('DANMU_MSG')) { dm++; if (dm <= 2) notes.push('DM ' + s.slice(0, 130)); }
            else if (notes.length < 3) notes.push('op5 ' + s.slice(0, 80));
          }
        }
      });
      socket.on('close', () => finish('closed'));
      socket.on('error', (e) => finish('err ' + e.message));
      timer = setTimeout(() => finish('timeout'), opts.wait || 14000);
    });
    req.on('error', (e) => finish('req err ' + e.message));
    req.end();
  });
}

console.log('\n=== WS variants ===');
await wsTest('no auth packet', {});
if (token) {
  await wsTest('real token', { auth: { uid: 0, roomid: ROOM, protover: 3, platform: 'web', type: 2, key: 'token=' + token } });
}
await wsTest('token=true', { auth: { uid: 0, roomid: ROOM, protover: 3, platform: 'web', type: 2, key: 'token=true' } });
