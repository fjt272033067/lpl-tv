// Probe v43: 全场回顾列表的内容（日期 / sVID / 标题）
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

const raw = decode(
  curlBuf('https://lpl.qq.com/web201612/data/LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST.js', [
    'Referer: https://lpl.qq.com/',
  ])
);
const j = JSON.parse(raw);
const msg = j.msg || {};
const items = Object.keys(msg).map((k) => msg[k]);
console.log(`条目 ${items.length}  lastUpdateTime=${j.lastUpdateTime}`);
console.log('首条字段: ' + Object.keys(items[0]).join(','));
console.log('\n=== 前 20 条 ===');
items.slice(0, 20).forEach((x) => {
  console.log(
    `  ${x.sCreated || x.sIdxTime || ''} | vid=${x.sVID || '(无)'} | ${x.sName || x.sTitle || ''} | cat=${x.sCateName || ''} | game=${x.sGameName || ''} | team=${x.sTeamName || x.sTitle || ''} | iTime=${x.iTime || ''}`
  );
});
const withVid = items.filter((x) => x.sVID);
console.log(`\n含 sVID: ${withVid.length}/${items.length}`);
const dates = items.map((x) => (x.sCreated || x.sIdxTime || '').slice(0, 10)).filter(Boolean).sort();
console.log('日期范围: ' + dates[0] + ' ~ ' + dates[dates.length - 1]);
console.log('\n=== 10-19 之后的条目 ===');
items
  .filter((x) => (x.sCreated || x.sIdxTime || '').slice(0, 10) >= '2026-10-19')
  .forEach((x) =>
    console.log(`  ${x.sCreated || x.sIdxTime} | vid=${x.sVID || '(无)'} | ${x.sName || x.sTitle} | ${x.sCateName || ''}`)
  );
console.log('\n=== 一条完整样例 ===');
console.log(JSON.stringify(items[0]).slice(0, 700));
