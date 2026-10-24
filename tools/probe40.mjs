// Probe v40: cmc/cross 能否拿到「最新比赛录像(sVID)」，且是否支持 JSONP
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url, headers = []) {
  const args = ['-s', '-D', '-', '--max-time', '30', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (e) { return Buffer.alloc(0); }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  // 跳过 HTTP 响应头
  const i = buf.indexOf('\r\n\r\n');
  const raw = i > -1 ? buf.subarray(i + 4) : buf;
  if (raw[0] === 0x1f && raw[1] === 0x8b) { try { return zlib.gunzipSync(raw).toString('utf8'); } catch {} }
  if (raw[0] === 0x78) { try { return zlib.inflateSync(raw).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(raw).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(raw).toString('utf8'); } catch {}
  return raw.toString('utf8');
}
function headers(buf) {
  const i = buf.indexOf('\r\n\r\n');
  return i > -1 ? buf.subarray(0, i).toString('utf8') : '';
}

console.log('=== A. cmc/cross：content-type / CORS / 是否 JSONP ===');
const base = 'https://apps.game.qq.com/cmc/cross?serviceId=3&filter=channel&chanid=30&source=web_pc&typeids=1,2&start=0&limit=10';
for (const [tag, url] of [
  ['原样', base],
  ['+callback', base + '&callback=cbfn'],
  ['+callback+jsonp', base + '&callback=cbfn&jsonp=jsonp'],
]) {
  const buf = curlBuf(url, ['Referer: https://lpl.qq.com/', 'Origin: https://example.com']);
  const h = headers(buf);
  const ct = (h.match(/content-type:\s*(.+)/i) || [])[1] || '?';
  const acao = (h.match(/access-control-allow-origin:\s*(.+)/i) || [])[1] || 'NONE';
  const body = decode(buf);
  const wrapped = /^\s*cbfn\s*\(/.test(body);
  console.log(`  ${tag.padEnd(20)} ct=${ct.trim().padEnd(28)} acao=${acao} jsonp=${wrapped}`);
  console.log(`      ${body.replace(/\s+/g, ' ').slice(0, 150)}`);
}

console.log('\n=== B. cmc/cross 的 item 字段（有没有 sVID / 视频）===');
const raw = decode(curlBuf(base, ['Referer: https://lpl.qq.com/']));
try {
  const j = JSON.parse(raw);
  const items = j.data?.items || [];
  console.log('  items=' + items.length + '  total=' + j.data?.total);
  if (items[0]) {
    console.log('  首条字段: ' + Object.keys(items[0]).join(','));
    console.log('  ' + JSON.stringify(items[0]).slice(0, 600));
  }
  const withVid = items.filter((x) => x.sVID || x.sVid);
  console.log('  含 sVID 的 item: ' + withVid.length);
  // 其它 filter 组合
  for (const f of [
    'serviceId=3&filter=channel&chanid=30&source=web_pc&typeids=3&start=0&limit=20',
    'serviceId=3&filter=channel&chanid=30&source=web_pc&typeids=1,2,3&start=0&limit=20',
    'serviceId=3&filter=newest&source=web_pc&start=0&limit=20',
  ]) {
    const r2 = decode(curlBuf('https://apps.game.qq.com/cmc/cross?' + f, ['Referer: https://lpl.qq.com/']));
    try {
      const j2 = JSON.parse(r2);
      const it2 = j2.data?.items || [];
      console.log(`  ${f.slice(0, 78)} -> ${it2.length} 条, 首条标题=${it2[0] ? String(it2[0].sTitle).slice(0, 30) : '-'}`);
    } catch { console.log('  解析失败 ' + f.slice(0, 50)); }
  }
} catch (e) {
  console.log('  解析失败: ' + raw.slice(0, 200));
}
