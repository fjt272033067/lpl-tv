// Probe v42: LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST.js 的格式与内容
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

const url = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST.js';
const raw = decode(curlBuf(url, ['Referer: https://lpl.qq.com/']));
console.log('=== A. 文件头（前 220 字符） ===');
console.log('  ' + raw.slice(0, 220).replace(/\s+/g, ' '));
console.log('  是否 var 赋值: ' + /^var\s+\w+\s*=/.test(raw.trim()));
console.log('  能否直接 JSON.parse: ' + (() => { try { JSON.parse(raw); return true; } catch { return false; } })());

console.log('\n=== B. 解析并看最新几条 ===');
let j = null;
try { j = JSON.parse(raw); } catch (e) {
  const m = raw.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (m) { try { j = JSON.parse(m[1]); } catch (e2) {} }
}
if (j) {
  console.log('  top keys: ' + Object.keys(j).join(','));
  const msg = j.msg || {};
  const keys = Object.keys(msg);
  console.log('  msg keys: ' + keys.slice(0, 12).join(',') + (keys.length > 12 ? ' ...' : ''));
  // 找数组
  let arr = null;
  for (const k of keys) {
    const v = msg[k];
    if (Array.isArray(v) && v.length) { arr = v; console.log('  数组在 msg.' + k + '，长度 ' + v.length); break; }
    if (v && typeof v === 'object') {
      for (const k2 of Object.keys(v)) {
        if (Array.isArray(v[k2]) && v[k2].length) { arr = v[k2]; console.log('  数组在 msg.' + k + '.' + k2 + '，长度 ' + v[k2].length); break; }
      }
    }
    if (arr) break;
  }
  if (arr) {
    console.log('  首条字段: ' + Object.keys(arr[0]).join(','));
    arr.slice(0, 6).forEach((x) =>
      console.log(`    ${x.sCreated || x.sIdxTime || ''} | vid=${x.sVID || ''} | ${x.sName || x.sTitle || ''}`)
    );
    // 最新的一条带 sVID 的
    const withVid = arr.filter((x) => x.sVID);
    console.log(`  含 sVID: ${withVid.length}/${arr.length}`);
    if (withVid.length) {
      const newest = withVid[0];
      console.log(`  最新带 VOD 的: ${newest.sCreated || newest.sIdxTime} ${newest.sVID} ${newest.sName || newest.sTitle}`);
      console.log('    完整: ' + JSON.stringify(newest).slice(0, 500));
    }
  }
}
