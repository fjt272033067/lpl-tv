// Probe v13: raw WS client to bilibili danmaku, verify danmaku actually arrives
import https from 'node:https';
import crypto from 'node:crypto';

const ROOM = 7734200;
const HOST = 'broadcastlv.chat.bilibili.com';

function maskFrame(payload) {
  const data = Buffer.from(payload, 'utf8');
  const mask = crypto.randomBytes(4);
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** parse server frames from a buffer accumulator */
function parseFrames(buf) {
  const out = [];
  let pos = 0;
  while (pos + 2 <= buf.length) {
    const b0 = buf[pos];
    const b1 = buf[pos + 1];
    const fin = b0 & 0x80;
    const opcode = b0 & 0x0f;
    const masked = b1 & 0x80;
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
    let maskKey = null;
    if (masked) {
      if (p + 4 > buf.length) break;
      maskKey = buf.subarray(p, p + 4);
      p += 4;
    }
    if (p + len > buf.length) break;
    let payload = Buffer.from(buf.subarray(p, p + len));
    if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    out.push({ fin, opcode, payload });
    pos = p + len;
  }
  return { frames: out, rest: buf.subarray(pos) };
}

async function run() {
  const key = crypto.randomBytes(16).toString('base64');
  return new Promise((resolve) => {
    const req = https.request({
      host: HOST,
      port: 443,
      path: '/sub',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Origin: 'https://live.bilibili.com',
      },
    });
    let acc = Buffer.alloc(0);
    const seen = [];
    let danmakuCount = 0;
    const samples = [];
    let timer = null;

    req.on('upgrade', (res, socket) => {
      console.log(`  upgraded ${res.statusCode}`);
      const auth = JSON.stringify({
        uid: 0,
        roomid: ROOM,
        protover: 3,
        platform: 'web',
        type: 2,
        key: 'token=true',
      });
      socket.write(maskFrame(auth));
      socket.write(maskFrame(JSON.stringify({ uid: 0, roomid: ROOM, protover: 2, platform: 'web', type: 2, key: 'token=true' })));

      socket.on('data', (chunk) => {
        acc = Buffer.concat([acc, chunk]);
        const { frames, rest } = parseFrames(acc);
        acc = rest;
        for (const f of frames) {
          if (f.opcode === 0x8) {
            console.log('  server close frame');
            return;
          }
          if (f.opcode !== 0x2 && f.opcode !== 0x1) continue;
          const b = f.payload;
          if (b.length < 4) continue;
          const op = b.readUInt16BE(0);
          const ver = b.readUInt16BE(2);
          if (op === 8) {
            const code = b.length >= 16 ? b.readInt32BE(8) : null;
            seen.push(`op=8 auth-reply code=${code}`);
            console.log(`  AUTH REPLY code=${code}`);
          } else if (op === 5) {
            let body = b.subarray(16);
            if (ver === 1 && body.length > 2 && body[0] === 0 && body[1] === 0) body = body.subarray(2);
            const s = body.toString('utf8');
            if (s.includes('DANMU_MSG')) {
              danmakuCount++;
              if (samples.length < 4) samples.push(s.slice(0, 200));
            } else {
              seen.push('op=5 ' + s.slice(0, 90));
            }
          } else if (op === 3) {
            seen.push('op=3 heartbeat');
          }
        }
      });
      socket.on('close', () => finish('closed'));
      socket.on('error', (e) => finish('error ' + e.message));

      timer = setTimeout(() => finish('timeout'), 20000);
    });

    function finish(why) {
      clearTimeout(timer);
      console.log(`  result: ${why} | danmaku=${danmakuCount} | other=${seen.length}`);
      seen.slice(0, 6).forEach((s) => console.log(`    ${s}`));
      samples.forEach((s) => console.log(`    DM ${s}`));
      resolve();
    }
    req.on('error', (e) => finish('req error ' + e.message));
    req.end();
  });
}

console.log(`=== bilibili live danmaku WS test room=${ROOM} ===`);
await run();
