// Probe v35: ① commact 是否有 JSONP 的赛程/录像动作 ② 官方赛程页在哪、长什么样
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

console.log('=== A. commact 动作探测（JSONP） ===');
const actions = [
  'getMatchList', 'getMatchInfoList', 'getMatchListByGameId', 'getScheduleList',
  'getNewMatchList', 'getBMatchList', 'getHomeMatchList', 'getAllMatchList',
  'getMatchHomeList', 'getVideoList', 'getMatchListByDate', 'getGameList',
  'getMatchData', 'getMatchListAll', 'getHistoryMatchList',
];
for (const a of actions) {
  const url = `https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=${a}&callback=cbfn`;
  const raw = decode(curlBuf(url, ['Referer: https://lpl.qq.com/']));
  const ok = raw && raw.indexOf('"status":0') > -1 && raw.length > 120;
  console.log(`  ${a.padEnd(22)} ${ok ? '✅' : '·'} ${raw.replace(/\s+/g, ' ').slice(0, 90)}`);
}

console.log('\n=== B. 官方赛程页定位 ===');
const home = decode(curlBuf('https://lpl.qq.com/', ['Referer: https://lpl.qq.com/']));
const links = [...home.matchAll(/["']([^"']*(?:schedule|match|saicheng|result)[^"']*)["']/gi)].map((m) => m[1]);
console.log('  首页链接候选: ' + [...new Set(links)].slice(0, 10).join(' | '));
for (const p of [
  'https://lpl.qq.com/schedule.shtml',
  'https://lpl.qq.com/web202301/schedule.shtml',
  'https://lpl.qq.com/web202301/schedule.html',
  'https://lol.qq.com/es/ldl/',
]) {
  const raw = decode(curlBuf(p, ['Referer: https://lpl.qq.com/']));
  const code = raw.length > 500 ? '可能存在' : '无';
  console.log(`  ${p} -> ${code} len=${raw.length} title=${(raw.match(/<title>([^<]*)<\/title>/i) || [])[1] || '-'}`);
}

console.log('\n=== C. 官方赛程页结构（找分组/卡片线索） ===');
const sch = decode(curlBuf('https://lpl.qq.com/web202301/schedule.shtml', ['Referer: https://lpl.qq.com/']));
if (sch.length > 1000) {
  console.log('  len=' + sch.length);
  console.log('  class 线索: ' + [...new Set([...sch.matchAll(/class="([^"]{0,60})"/g)].map((m) => m[1]))].slice(0, 25).join(' | '));
  console.log('  js: ' + [...sch.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 8).join(' | '));
} else {
  console.log('  该页不存在，改用首页赛程入口');
}
