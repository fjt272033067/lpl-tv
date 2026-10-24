// Probe v38: 最近几天的比赛有没有 sVID；官方 progress 分组结构
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

const data = JSON.parse(
  decode(curlBuf('https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js'))
);
const all = data.msg;
console.log(`表内 ${all.length} 条，lastUpTime=${data.lastUpTime}`);

const byDate = new Map();
all.forEach((it) => {
  const d = (it.MatchDate || '').slice(0, 10);
  if (!byDate.has(d)) byDate.set(d, []);
  byDate.get(d).push(it);
});
const dates = Array.from(byDate.keys()).sort().reverse().slice(0, 12);
console.log('\n=== 最近 12 个有比赛的日期 ===');
for (const d of dates) {
  const items = byDate.get(d);
  let withVid = 0;
  const names = [];
  for (const it of items) {
    let ext = {};
    try { ext = JSON.parse(it.sExt1 || '{}'); } catch {}
    if (ext.sVID) { withVid++; names.push((it.TeamShortNameA || '?') + 'vs' + (it.TeamShortNameB || '?')); }
  }
  console.log(`  ${d}  共 ${items.length} 场，有 sVID ${withVid} 场  ${names.slice(0, 6).join(' ')}`);
}

console.log('\n=== 10-19 之后的全部条目明细 ===');
all
  .filter((x) => (x.MatchDate || '') >= '2026-10-19')
  .forEach((it) => {
    let ext = {};
    try { ext = JSON.parse(it.sExt1 || '{}'); } catch {}
    console.log(
      `  ${it.MatchDate} | ${it.GameName} | ${it.bMatchName} | GameProc=${it.GameProcName} | sVID=${ext.sVID || '(无)'} | sExt1长度=${(it.sExt1 || '').length}`
    );
  });

console.log('\n=== 官方 lplMatchConfig.js（分组/阶段结构）===');
const cfg = decode(curlBuf('https://lpl.qq.com/web201612/js/lplMatchConfig.js', ['Referer: https://lpl.qq.com/']));
console.log('  len=' + cfg.length);
console.log('  ' + cfg.replace(/\s+/g, ' ').slice(0, 1400));
