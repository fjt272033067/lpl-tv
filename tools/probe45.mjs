// Probe v45: B 站直播接口族是否整体支持 JSONP（getRoomPlayInfo / getDanmuInfo）
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url, headers = []) {
  const args = ['-s', '-D', '-', '--max-time', '25', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  } catch (e) { return Buffer.alloc(0); }
}
function split(buf) {
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

const ROOMS = [6, 7734200, 8016907];
for (const room of ROOMS) {
  console.log(`\n############ 房间 ${room} ############`);
  const eps = [
    ['getRoomPlayInfo', `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${room}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&ptype=8&dolby=5&panorama=1`],
    ['getRoomBaseInfo', `https://api.live.bilibili.com/xlive/web-room/v1/index/getRoomBaseInfo?room_ids=${room}`],
    ['getDanmuInfo', `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${room}&type=0`],
    ['dM/gethistory', `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?room_id=${room}`],
  ];
  for (const [tag, u] of eps) {
    const { h, body } = split(curlBuf(u + '&callback=cbfn&jsonp=jsonp', ['Referer: https://live.bilibili.com/']));
    const ct = (h.match(/content-type:\s*(.+)/i) || [])[1] || '?';
    const text = decode(body);
    const wrapped = /^\s*cbfn\s*\(/.test(text);
    const code = (text.match(/"code":(-?\d+)/) || [])[1];
    console.log(`  ${tag.padEnd(18)} jsonp=${String(wrapped).padEnd(5)} code=${code} ct=${ct.trim()}`);
    if (wrapped) {
      // 提取流地址
      const urls = [...text.matchAll(/https?:\\?\/\\?\/[^"'\\ ]+?(?:m3u8|flv)/g)].map((m) => m[0].replace(/\\/g, ''));
      console.log(`      流地址: ${urls.slice(0, 3).join(' | ') || '(无)'}`);
      console.log(`      头: ${text.slice(0, 150).replace(/\s+/g, ' ')}`);
    } else if (text.includes('"code"')) {
      console.log(`      ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
}
