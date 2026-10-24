// Probe v44: 官方「最新录像」的分频道文件是否有 var 赋值版（可运行时加载）
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url, headers = []) {
  const args = ['-s', '--max-time', '20', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
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

const idx = decode(curlBuf('https://lpl.qq.com/web202301/js/index.js'));
// 取出 subnavConfigArr 的 id
const ids = [...new Set([...idx.matchAll(/"(\d{3,5})"\s*:\s*\{\s*iSecond/g)].map((m) => m[1]))];
console.log('subnav ids: ' + ids.join(', '));

const cands = [];
for (const id of ids.slice(0, 14)) {
  cands.push(`LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_${id}.js`);
  cands.push(`LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_${id}_20.js`);
}
cands.push('LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_246.js');
cands.push('LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_246_20.js');
cands.push('LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_0.js');
cands.push('LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_20.js');

console.log('\n=== 探测 ===');
let hits = 0;
for (const n of [...new Set(cands)]) {
  const raw = decode(curlBuf('https://lpl.qq.com/web201612/data/' + n, ['Referer: https://lpl.qq.com/']));
  if (!raw || raw.length < 400) continue;
  const isVar = /^var\s+[A-Za-z_$][\w$]*\s*=/.test(raw.trim());
  const hasVid = /sVID/.test(raw);
  const hasExt = /sExt1/.test(raw);
  if (isVar || (hasVid && raw.length < 200000)) {
    hits++;
    console.log(`  ${n.padEnd(58)} len=${String(raw.length).padEnd(8)} var=${isVar ? 'Y' : 'n'} sVID=${hasVid}`);
    console.log(`      ${raw.slice(0, 150).replace(/\s+/g, ' ')}`);
  }
}
console.log(`\n命中 ${hits} 个`);
