// Probe v39: 找「运行时可取到的最新比赛录像」数据源
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
function loadVar(url, globalName) {
  const raw = decode(curlBuf(url));
  if (!raw) return null;
  const body = raw.replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '');
  try { return JSON.parse(body); } catch { return null; }
}

console.log('=== A. FirPageRecoInfo（var，可 script 加载）里有没有 sVID ===');
const fr = loadVar('https://lpl.qq.com/web201612/data/LOL_NEWMATCH_FIR_PAGE_RECO_INFO.js', 'FirPageRecoInfo');
if (fr) {
  const s = JSON.stringify(fr);
  console.log('  len=' + s.length + '  含sVID=' + /sVID/.test(s) + '  含sDocid=' + /sDocid/i.test(s));
  console.log('  ' + s.slice(0, 700));
}

console.log('\n=== B. 官方账号内容列表：翻页找「录像/回放」 ===');
const allFeed = [];
for (let pg = 1; pg <= 6; pg++) {
  const raw = decode(
    curlBuf(
      `https://apps.game.qq.com/cmc/zmMcnAuthorContentList?type=1&page=${pg}&num=40&r1=authorid&authorid=288&source=web_pc`,
      ['Referer: https://lpl.qq.com/']
    )
  );
  const body = raw.replace(/^var authorid=/, '').replace(/;\s*$/, '');
  let j = null;
  try { j = JSON.parse(body); } catch {}
  const res = (j && j.data && j.data.result) || [];
  if (!res.length) { console.log(`  page${pg}: 空`); break; }
  res.forEach((r) => allFeed.push(r));
  console.log(`  page${pg}: ${res.length} 条`);
}
console.log(`  合计 ${allFeed.length} 条`);
const replay = allFeed.filter((r) => /录像|回放|比赛|战报|复盘|集锦/.test(r.sTitle || ''));
console.log(`  标题含 录像/回放/比赛 的: ${replay.length} 条`);
replay.slice(0, 15).forEach((r) =>
  console.log(`    ${r.sCreated} | vid=${r.sVID} | ${r.sTitle}`)
);
console.log(`  含 sVID 的总条数: ${allFeed.filter((r) => r.sVID).length}`);
console.log(`  时间范围: ${allFeed.length ? allFeed[allFeed.length - 1].sCreated : '-'} ~ ${allFeed.length ? allFeed[0].sCreated : '-'}`);

console.log('\n=== C. 官方账号列表换关键词/类型 ===');
for (const q of [
  'type=1&page=1&num=40&r1=authorid&authorid=288',
  'type=1&page=1&num=40&r1=authorid&authorid=288&tagIds=1260',
  'type=2&page=1&num=40&r1=authorid&authorid=288',
  'type=3&page=1&num=40&r1=authorid&authorid=288',
]) {
  const raw = decode(
    curlBuf(`https://apps.game.qq.com/cmc/zmMcnAuthorContentList?${q}&source=web_pc`, [
      'Referer: https://lpl.qq.com/',
    ])
  );
  const body = raw.replace(/^var authorid=/, '').replace(/;\s*$/, '');
  let j = null;
  try { j = JSON.parse(body); } catch {}
  const res = (j && j.data && j.data.result) || [];
  console.log(`  ${q} -> ${res.length} 条  首条: ${res[0] ? res[0].sTitle : '-'}`);
}
