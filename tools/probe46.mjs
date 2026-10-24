// Probe v46: 能否让 B 站接口返回 JS MIME 类型（绕过 Chrome ORB）
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function req(url, headers = []) {
  const args = ['-s', '-D', '-', '--max-time', '25', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  let buf;
  try {
    buf = execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  } catch (e) { return { h: '', body: Buffer.alloc(0) }; }
  const i = buf.indexOf('\r\n\r\n');
  return { h: i > -1 ? buf.subarray(0, i).toString('utf8') : '', body: i > -1 ? buf.subarray(i + 4) : buf };
}
function decode(raw) {
  if (!raw || !raw.length) return '';
  if (raw[0] === 0x1f && raw[1] === 0x8b) { try { return zlib.gunzipSync(raw).toString('utf8'); } catch {} }
  if (raw[0] === 0x78) { try { return zlib.inflateSync(raw).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(raw).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(raw).toString('utf8'); } catch {}
  return raw.toString('utf8');
}

const base = 'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=7734200&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8';
const variants = [
  ['callback+jsonp', base + '&callback=cbfn&jsonp=jsonp', []],
  ['callback only', base + '&callback=cbfn', []],
  ['jsonp only', base + '&jsonp=jsonp', []],
  ['Accept: text/javascript', base + '&callback=cbfn&jsonp=jsonp', ['Accept: text/javascript']],
  ['Accept: application/javascript', base + '&callback=cbfn&jsonp=jsonp', ['Accept: application/javascript']],
  ['Accept: text/html', base + '&callback=cbfn&jsonp=jsonp', ['Accept: text/html']],
  ['Sec-Fetch-Dest: script', base + '&callback=cbfn&jsonp=jsonp', ['Sec-Fetch-Dest: script', 'Sec-Fetch-Mode: no-cors', 'Sec-Fetch-Site: cross-site']],
  ['no params', base, []],
];

for (const [tag, url, extra] of variants) {
  const { h, body } = req(url, ['Referer: https://live.bilibili.com/', ...extra]);
  const ct = (h.match(/content-type:\s*(.+)/i) || [])[1] || '?';
  const nosniff = /x-content-type-options:\s*nosniff/i.test(h);
  const text = decode(body);
  const wrapped = /^\s*cbfn\s*\(/.test(text);
  console.log(`  ${tag.padEnd(26)} ct=${ct.trim().padEnd(30)} nosniff=${nosniff ? 'Y' : 'n'} jsonp=${wrapped} len=${text.length}`);
}

// 看看 playInfo 的数据结构（有流地址的话就能自己播 B 站流）
console.log('\n=== playInfo 数据结构 ===');
const { body } = req(base + '&callback=cbfn&jsonp=jsonp', ['Referer: https://live.bilibili.com/']);
const text = decode(body);
const inner = text.replace(/^\s*cbfn\s*\(/, '').replace(/\);?\s*$/, '');
try {
  const j = JSON.parse(inner);
  const d = j.data || {};
  console.log('  data keys: ' + Object.keys(d).join(','));
  const pi = d.playurl_info || {};
  console.log('  playurl_info keys: ' + Object.keys(pi).join(','));
  const streams = (pi.stream || []);
  console.log('  流数量: ' + streams.length);
  streams.forEach((s) => {
    console.log(`    protocol=${s.protocol_name} format=${s.format_name} codec=${s.codec_name} qn=${s.qn} url=${String(s.url).slice(0, 70)}`);
  });
} catch (e) {
  console.log('  解析失败: ' + text.slice(0, 200));
}
