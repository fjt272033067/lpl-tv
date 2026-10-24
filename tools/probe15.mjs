// Probe v15: FIXED bilibili auth packet (len|headerLen|protoVer|op) + danmaku xml
import https from 'node:https';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOM = 7734200;
const HOST = 'broadcastlv.chat.bilibili.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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

/** bilibili packet: [0]=totalLen [4]=headerLen(16) [8]=protoVer [12]=operation */
function biliPacket(op, obj, protoVer = 1) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16 + json.length, 0);
  head.writeUInt32BE(16, 4);
  head.writeUInt32BE(protoVer, 8);
  head.writeUInt32BE(op, 12);
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

async function wsTest(label, uid, key, protover) {
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
        'User-Agent': UA,
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
      notes.slice(0, 4).forEach((n) => console.log(`      ${n}`));
      resolve();
    };
    req.on('upgrade', (res, socket) => {
      socket.write(
        maskFrame(
          biliPacket(7, { uid, roomid: ROOM, protover, platform: 'web', type: 2, key }),
          0x2
        )
      );
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
              if (dm <= 2) notes.push('DM ' + s.slice(0, 140));
            } else if (notes.length < 4) notes.push('op5 ' + s.slice(0, 90));
          }
        }
      });
      socket.on('close', () => finish('socket closed'));
      socket.on('error', (e) => finish('err ' + e.message));
      timer = setTimeout(() => finish('timeout'), 16000);
    });
    req.on('error', (e) => finish('req err ' + e.message));
    req.end();
  });
}

console.log('=== WS auth (fixed packet layout) ===');
await wsTest('uid=0 token=true pv3', 0, 'token=true', 3);
await wsTest('uid=0 token=true pv2', 0, 'token=true', 2);

console.log('\n=== danmaku XML ===');
const spi = await (
  await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': UA } })
).json();
const ck = `buvid3=${spi.data.b_3}; b_nut=${Math.floor(Date.now() / 1000)}`;
const bvid = 'BV1n5na61Eev';
const vr = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
  headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: ck },
});
console.log(`  view status=${vr.status}`);
const vtxt = await vr.text();
let cid = null;
try {
  const vj = JSON.parse(vtxt);
  cid = vj.data.cid;
  console.log(`  cid=${cid} title=${vj.data.title} dur=${vj.data.duration} view=${vj.data.stat?.view}`);
} catch (e) {
  console.log(`  view parse fail: ${vtxt.slice(0, 120)}`);
}
if (cid) {
  const xml = await (await fetch(`https://comment.bilibili.com/${cid}.xml`, {
    headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${bvid}/` },
  })).text();
  console.log(`  xml bytes=${Buffer.byteLength(xml)}`);
  const re = /<d p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  let m;
  let n = 0;
  const modes = {};
  const items = [];
  while ((m = re.exec(xml)) !== null) {
    const p = m[1].split(',');
    items.push([+p[0] || 0, +p[1] || 1, +p[3] || 16777215, +p[2] || 25, m[2]]);
    modes[p[1]] = (modes[p[1]] || 0) + 1;
    n++;
  }
  console.log(`  parsed ${n} danmaku; modes=${JSON.stringify(modes)}`);
  console.log(`  sample ${JSON.stringify(items.slice(0, 3))}`);
  const json = JSON.stringify({ cid, items });
  console.log(`  json bytes=${Buffer.byteLength(json)} gzip=${zlib.gzipSync(json).length}`);
}
