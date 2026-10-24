// Probe v32: 腾讯直播弹幕（barrage）接口是否可 JSONP
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

console.log('=== A. 找腾讯直播弹幕接口 ===');
// 直播页与播放器脚本里通常带 barrage/chat 相关路径
const pages = [
  'https://lpl.qq.com/live/',
  'https://lpl.qq.com/web202301/live.html',
  'https://lol.qq.com/lol/commact/',
];
for (const p of pages) {
  const html = decode(curlBuf(p, ['Referer: https://lpl.qq.com/']));
  const js = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const hints = [...html.matchAll(/["']([^"']*(?:barrage|danmu|danmaku|chat|comment)[^"']*)["']/gi)].map(
    (m) => m[1]
  );
  console.log(`  ${p}\n     len=${html.length} js=${js.length} barrageHints=${[...new Set(hints)].slice(0, 6).join(',') || '(无)'}`);
  js.slice(0, 14).forEach((s) => console.log('       js: ' + s.slice(0, 96)));
}

console.log('\n=== B. 候选弹幕接口（JSONP 探测） ===');
const cands = [
  'https://proxy.vod.qq.com/danmu/live/764502578',
  'https://barrage.video.qq.com/barrage/live/764502578',
  'https://webvv.video.qq.com/barrage?vid=764502578',
  'https://comm.api.game.qq.com/ams/ame/livelink/getBarrageList?anchorId=764502578',
  'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getBarrageList&anchorId=764502578',
  'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList',
];
for (const u of cands) {
  const raw = decode(curlBuf(u + (u.includes('?') ? '&' : '?') + 'callback=cbfn', ['Referer: https://lpl.qq.com/']));
  const wrapped = raw.trimStart().startsWith('cbfn(');
  console.log(`  ${u.replace('https://', '').slice(0, 74)}\n     jsonp=${wrapped} head=${(raw || '(empty)').replace(/\s+/g, ' ').slice(0, 120)}`);
}
