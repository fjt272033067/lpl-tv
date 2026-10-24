// Probe v37: ① 腾讯赛程大表最新几场长什么样（为何停在 10.19）② 官方 progress 页结构
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url, headers = []) {
  const args = ['-s', '--max-time', '30', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (e) { return Buffer.alloc(0); }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString('utf8'); } catch {} }
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}

console.log('=== A. 赛程大表：最近 12 场的原始字段 ===');
const raw = decode(curlBuf('https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js'));
const data = JSON.parse(raw);
console.log(`  lastUpTime=${data.lastUpTime}  msg 条数=${data.msg.length}`);
const recent = data.msg.slice(0, 12);
for (const it of recent) {
  let ext = {};
  try { ext = JSON.parse(it.sExt1 || '{}'); } catch {}
  const keys = Object.keys(ext).join(',');
  console.log(
    `  ${it.MatchDate} | ${it.GameName || ''} | ${it.bMatchName || ''} | sVID=${ext.sVID || '(无)'} | sExt1键=${keys.slice(0, 60)}`
  );
}
console.log('\n  -- 最近 30 条里 sExt1 为空/无 sVID 的数量 --');
const n30 = data.msg.slice(0, 30);
console.log('   ' + n30.filter((x) => { try { return !JSON.parse(x.sExt1 || '{}').sVID; } catch { return true; } }).length + ' / 30');
console.log('   最近一条有 sVID 的：');
for (const it of data.msg) {
  let ext = {};
  try { ext = JSON.parse(it.sExt1 || '{}'); } catch {}
  if (ext.sVID) { console.log(`     ${it.MatchDate} ${ext.sVID} ${ext.sName || ''}`); break; }
}

console.log('\n=== B. 官方 event.html?gameId=246&tabId=progress 结构 ===');
const ev = decode(curlBuf('https://lpl.qq.com/web202301/event.html?gameId=246&tabId=progress', ['Referer: https://lpl.qq.com/']));
console.log('  len=' + ev.length);
const classes = [...new Set([...ev.matchAll(/class="([^"]{0,80})"/g)].map((m) => m[1]))];
console.log('  关键 class: ' + classes.filter((c) => /match|progress|schedule|team|logo|score|tab|game/i.test(c)).slice(0, 30).join(' | '));
console.log('  js: ' + [...ev.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 10).join(' | '));
// 官方赛程用哪个数据文件
const evJs = decode(curlBuf('https://lpl.qq.com/web202301/js/event.js', ['Referer: https://lpl.qq.com/']));
if (evJs.length > 500) {
  console.log('  event.js len=' + evJs.length);
  console.log('  引用数据文件: ' + [...new Set([...evJs.matchAll(/LOL_[A-Z0-9_]+\.js/g)].map((m) => m[0]))].join(', '));
  const cls = [...new Set([...evJs.matchAll(/["']([a-z0-9-]*(?:match|progress|schedule|team|group)[a-z0-9-]*)["']/gi)].map((m) => m[1]))];
  console.log('  相关类名: ' + cls.slice(0, 30).join(' | '));
} else {
  console.log('  event.js 未找到');
}
