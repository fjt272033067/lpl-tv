// Probe v23: 用完整浏览器请求头 + 全套 buvid cookie 强取 getDanmuInfo token
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

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

// 1) 收集 buvid 系
const spiRaw = decode(curlBuf('https://api.bilibili.com/x/frontend/finger/spi'));
let spi = {};
try { spi = JSON.parse(spiRaw).data || {}; } catch {}
console.log('spi keys: ' + Object.keys(spi).join(','));

// buvid_fp：再打一个 spi，带 x5sec 之类
let fp = '';
try {
  const fpRaw = decode(
    curlBuf('https://api.bilibili.com/x/frontend/finger/spi', [
      `Cookie: buvid3=${spi.b_3}`,
      'Referer: https://www.bilibili.com/',
    ])
  );
  fp = JSON.parse(fpRaw).data.b_3 || '';
} catch {}

const cookies = [
  `buvid3=${spi.b_3}`,
  `buvid4=${spi.b_4}`,
  `b_nut=${Math.floor(Date.now() / 1000)}`,
  `b_lsid=${spi.b_3}XX`,
  `buvid_fp=${fp || spi.b_3}`,
  `CURRENT_FNVAL=4048`,
  `CURRENT_QUALITY=80`,
  `sid=`,
].join('; ');

const CHROME_HDRS = [
  `Accept: application/json, text/plain, */*`,
  `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`,
  `Accept-Encoding: gzip, deflate, br`,
  `sec-ch-ua: "Chromium";v="126", "Not)A;Brand";v="24", "Google Chrome";v="126"`,
  `sec-ch-ua-mobile: ?0`,
  `sec-ch-ua-platform: "Windows"`,
  `sec-fetch-dest: empty`,
  `sec-fetch-mode: cors`,
  `sec-fetch-site: same-site`,
  `origin: https://live.bilibili.com`,
  `referer: https://live.bilibili.com/${ROOM}/`,
];

console.log('\n=== 逐个尝试取 token ===');
const urls = [
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0`,
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0&web_location=444.8`,
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?room_id=${ROOM}&type=0`,
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0&token=`,
];
let token = '';
for (const u of urls) {
  const raw = decode(curlBuf(u, [...CHROME_HDRS, `Cookie: ${cookies}`]));
  const ok = raw && raw.indexOf('"token"') > -1;
  console.log(`  ${ok ? '✓' : '·'} ${u.replace(/^https:\/\/api\.live\.bilibili\.com/, '')}\n      ${(raw || '(empty)').replace(/\s+/g, ' ').slice(0, 180)}`);
  if (ok) {
    try {
      const j = JSON.parse(raw);
      if (j.data && j.data.token) token = j.data.token;
    } catch {}
  }
}
console.log('\nTOKEN=' + (token ? token.slice(0, 60) + '...' : '(none)'));
if (token) {
  const fs = await import('node:fs');
  fs.writeFileSync('tools/.danmu-token.txt', token);
  console.log('已保存 tools/.danmu-token.txt');
}
