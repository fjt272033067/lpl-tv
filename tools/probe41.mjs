// Probe v41: 官方「最新视频列表」数据文件是否可用
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

console.log('=== A. index.js 里怎么引用 LATEST_VIDEOS ===');
const idx = decode(curlBuf('https://lpl.qq.com/web202301/js/index.js'));
const i = idx.indexOf('LATEST_VIDEOS');
if (i > -1) console.log('  ...' + idx.slice(Math.max(0, i - 320), i + 320).replace(/\s+/g, ' ') + '...');
else console.log('  未找到');

console.log('\n=== B. 候选文件名探测 ===');
const cands = [
  'LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0.js',
  'LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST.js',
  'LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_1.js',
  'LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_0.js',
  'LOL_MATCH2_NEWS_LATEST_VIDEOS_LIST.js',
  'LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_1.js',
];
for (const n of cands) {
  const raw = decode(curlBuf('https://lpl.qq.com/web201612/data/' + n));
  const isVar = /^var\s+\w+\s*=/.test(raw.trim());
  console.log(`  ${n.padEnd(48)} len=${String(raw.length).padEnd(8)} var=${isVar ? 'Y' : 'n'} sVID=${/sVID/.test(raw)}`);
  if (raw.length > 200 && raw.length < 6000) console.log('      ' + raw.replace(/\s+/g, ' ').slice(0, 400));
}

console.log('\n=== C. index.js 里所有 data/ 引用的完整文件名（找动态拼接） ===');
const refs = [...new Set([...idx.matchAll(/data\/[A-Za-z0-9_\.\$\{\}"]+/g)].map((m) => m[0]))];
console.log('  ' + refs.join('\n  '));
const vidRelated = [...new Set([...idx.matchAll(/[A-Z_]*VIDEOS[A-Z_]*/g)].map((m) => m[0]))];
console.log('  含 VIDEOS 的标识符: ' + vidRelated.join(', '));
