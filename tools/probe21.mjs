// Probe v21: bilibili live embed player + app-api jsonp + token via other routes
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
  } catch (e) {
    return Buffer.alloc(0);
  }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString('utf8'); } catch {} }
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}
const hdr = (extra = []) => ['Referer: https://live.bilibili.com/', 'Origin: https://example.com', ...extra];

console.log('=== A. 直播嵌入播放器是否存在 ===');
for (const u of [
  'https://live.bilibili.com/embed/7734200',
  'https://live.bilibili.com/embed/4.html?room_id=7734200',
  'https://live.bilibili.com/blanc/7734200',
  'https://live.bilibili.com/blackboard/activity-...html',
]) {
  const r = decode(curlBuf(u, hdr()));
  const hasPlayer = /player|Player|flash|room_id/i.test(r || '');
  console.log(`  ${u}\n     len=${(r || '').length} playerHint=${hasPlayer} head=${(r || '').replace(/\s+/g, ' ').slice(0, 100)}`);
}

console.log('\n=== B. app API / 其它取 token 途径（是否 JSONP） ===');
for (const u of [
  'https://app.bilibili.com/x/v2/live/room/getDanmuInfo?room_id=7734200&callback=cb',
  'https://app.bilibili.com/x/v2/live/room?room_id=7734200&callback=cb',
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=7734200&type=0&callback=cb',
  'https://api.live.bilibili.com/xlive/web-app/v1/index/getDanmuInfo?id=7734200&type=0',
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=7734200&type=0&web_location=444.8&platform=web',
]) {
  const r = decode(curlBuf(u, hdr()));
  console.log(`  ${u.replace(/^https:\/\//, '').slice(0, 88)}\n     -> ${(r || '(empty)').replace(/\s+/g, ' ').slice(0, 190)}`);
}

console.log('\n=== C. getRoomBaseInfo 全量字段（看是否含弹幕信息） ===');
const b = decode(curlBuf('https://api.live.bilibili.com/xlive/web-room/v1/index/getRoomBaseInfo?room_ids=7734200', hdr()));
console.log('  ' + (b || '').replace(/\s+/g, ' ').slice(0, 600));
