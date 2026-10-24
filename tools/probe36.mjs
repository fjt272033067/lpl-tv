// Probe v36: 找官方「最新视频列表」数据文件 —— 能否运行时拿到刚打完的比赛
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url) {
  try {
    return execFileSync('curl.exe', ['-s', '--max-time', '25', '-A', UA, url], {
      encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    });
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
const names = [...new Set([...idx.matchAll(/LOL_[A-Z0-9_]+\.js/g)].map((m) => m[0]))];
console.log(`index.js 引用 ${names.length} 个数据文件`);
const withVid = [];
for (const n of names) {
  const raw = decode(curlBuf('https://lpl.qq.com/web201612/data/' + n));
  if (!raw) { console.log(`  ${n} -> 空`); continue; }
  const isVar = /^var\s+\w+\s*=/.test(raw.trim());
  const vidCount = (raw.match(/"sVID"|"sVid"|"vid"/g) || []).length;
  console.log(
    `  ${n.padEnd(52)} len=${String(raw.length).padEnd(8)} var=${isVar ? 'Y' : 'n'} vid字段=${vidCount}`
  );
  if (vidCount > 0) withVid.push(n);
}
console.log('\n含 vid 的文件: ' + (withVid.join(', ') || '(无)'));

for (const n of withVid.slice(0, 3)) {
  const raw = decode(curlBuf('https://lpl.qq.com/web201612/data/' + n));
  console.log(`\n--- ${n} 样本 ---`);
  const idx2 = raw.indexOf('"sVID"');
  if (idx2 > -1) console.log('  ' + raw.slice(Math.max(0, idx2 - 260), idx2 + 220).replace(/\s+/g, ' '));
}
