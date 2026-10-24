// Probe v26: dM/gethistory 正确参数 + JSONP 包装 + 直播间存活状态
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

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

console.log('=== A. 候选直播间存活状态 ===');
const rooms = [7734200, 8016907, 1727071300, 13242941, 3627486];
for (const r of rooms) {
  const raw = decode(
    curlBuf(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${r}`, [
      'Referer: https://live.bilibili.com/',
    ])
  );
  try {
    const j = JSON.parse(raw);
    console.log(
      `  room=${r} live_status=${j.data?.live_status} title=${String(j.data?.title).slice(0, 40)}`
    );
  } catch (e) {
    console.log(`  room=${r} parse fail`);
  }
}

console.log('\n=== B. gethistory 参数变体（带 jsonp） ===');
const base = 'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory';
const variants = [
  'room_id=1727071300',
  'room_id=1727071300&type=0',
  'room_id=1727071300&room_id=0',
  'room_id=1727071300&type=0&send_id=0',
  'room_id=1727071300&type=1',
  'room_id=1727071300&token=',
];
for (const v of variants) {
  const raw = decode(
    curlBuf(`${base}?${v}&callback=cbfn&jsonp=jsonp`, ['Referer: https://live.bilibili.com/'])
  );
  const wrapped = raw.trimStart().startsWith('cbfn(');
  const head = raw.slice(0, 170).replace(/\s+/g, ' ');
  console.log(`  ${v.padEnd(42)} jsonp=${String(wrapped).padEnd(5)} ${head}`);
}

console.log('\n=== C. 其它可能的弹幕历史接口 ===');
for (const u of [
  'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?room_id=1727071300',
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuHistory?room_id=1727071300',
  'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistoryByRoom?room_id=1727071300',
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuHistory?room_id=1727071300&type=0',
]) {
  const raw = decode(curlBuf(u + '&callback=cbfn&jsonp=jsonp', ['Referer: https://live.bilibili.com/']));
  console.log(`  ${u.replace('https://api.live.bilibili.com', '').slice(0, 76)}\n      ${raw.slice(0, 160).replace(/\s+/g, ' ')}`);
}
