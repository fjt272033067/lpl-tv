// Probe v20: live danmaku token (brotli + jsonp) + WS with real token
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import https from 'node:https';
import crypto from 'node:crypto';

const ROOM = 7734200;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function curlBuf(url, headers = []) {
  const args = ['-s', '--max-time', '25', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (e) {
    return Buffer.alloc(0);
  }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString('utf8'); } catch {} }
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}

const spi = JSON.parse(decode(curlBuf('https://api.bilibili.com/x/frontend/finger/spi')) || '{}');
const buvid3 = spi?.data?.b_3 || '';
const ck = `buvid3=${buvid3}; b_nut=${Math.floor(Date.now() / 1000)}; b_lsid=${buvid3}XX`;
console.log('buvid3 ok=' + !!buvid3);

for (const enc of ['gzip, deflate, br', 'br', 'identity', '']) {
  const hdrs = [`Referer: https://live.bilibili.com/${ROOM}`, `Cookie: ${ck}`];
  if (enc) hdrs.push(`Accept-Encoding: ${enc}`);
  const raw = decode(curlBuf(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0`, hdrs));
  console.log(`  enc="${enc}" -> ${(raw || '(empty)').slice(0, 170)}`);
}

// JSONP?
for (const cb of ['cb', 'jQuery1234_5678']) {
  const raw = decode(
    curlBuf(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0&callback=${cb}`, [
      `Referer: https://live.bilibili.com/${ROOM}`,
      `Cookie: ${ck}`,
    ])
  );
  console.log(`  jsonp cb=${cb} -> ${(raw || '(empty)').slice(0, 170)}`);
}

// gethistory (历史弹幕) —— 也许支持 jsonp
const gh = decode(
  curlBuf(`https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?room_id=${ROOM}`, [
    `Referer: https://live.bilibili.com/${ROOM}`,
    `Cookie: ${ck}`,
  ])
);
console.log('  gethistory -> ' + (gh || '(empty)').slice(0, 200));
