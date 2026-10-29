/* =====================================================================
 * bili-live.mjs — B 站直播间信息与直播流地址抓取（构建期专用）
 *
 *  为什么必须构建期抓：
 *    - api.live.bilibili.com 的 playUrl / get_info 均无 ACAO 头，
 *      浏览器 fetch 必被 CORS 拦；
 *    - 即使加 callback 走 JSONP，响应仍是 application/json，
 *      Chrome ORB 会拒绝执行 <script src>；
 *    - 因此流地址只能在构建期拿，运行时直接喂给播放器。
 *  流地址有效期约 60 分钟（expires 参数），由定时任务刷新。
 *
 *  注意：不要给请求加 Origin 头 —— B 站对带 Origin 的匿名请求返回 403。
 * ===================================================================== */
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlBuf(url, headers = [], timeout = 25) {
  const args = ['-s', '--max-time', String(timeout), '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    // curl 的可执行名：Windows 是 curl.exe，Linux/macOS 是 curl
    return execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (e) {
    return Buffer.alloc(0);
  }
}

function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return zlib.gunzipSync(buf).toString('utf8'); } catch {}
  }
  if (buf[0] === 0x78) {
    try { return zlib.inflateSync(buf).toString('utf8'); } catch {}
  }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}

export function fetchJson(url, headers = [], timeout = 25) {
  const raw = decode(curlBuf(url, headers, timeout));
  if (!raw || raw[0] !== '{') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 直播间状态：是否在播 / 真实 room_id / 观看人数 */
export async function fetchRoomInfo(roomId) {
  const j = fetchJson(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, [
    'Referer: https://live.bilibili.com/',
  ]);
  const d = j && j.data;
  if (!d) return null;
  return {
    roomid: d.room_id || roomId,
    shortId: d.short_id || roomId,
    uid: d.uid || 0,
    title: String(d.title || '').replace(/<[^>]+>/g, ''),
    live: d.live_status === 1,
    liveStatus: d.live_status,
    // 注意：B 站 get_info 的 online 是「累计人气值」不是同时在线人数
    // （实测同一房间会从 200 万一路涨到 1 亿），拿它当「人在看」会明显失真。
    online: d.online || 0,
    attention: d.attention || 0,
    uname: d.uname || '',
    area: d.area_name || '',
    liveTime: d.live_time || '',
  };
}

const QN_NAME = {
  15000: '2K',
  10000: '原画',
  400: '蓝光',
  250: '超清',
  150: '高清',
  80: '流畅',
};

/**
 * 直播流地址。未登录状态 B 站只放行 qn=150（高清），
 * 请求更高档位会被降到 150 —— 所以这里只请求一次并按实际返回标注。
 * 返回 { url, flvUrl, expires, qn, qnName }
 *
 * 重要：B 站只给 HTTP-FLV，但同一个 CDN 路径把 .flv 换成 .m3u8 就能拿到
 * HLS（实测 200 + application/vnd.apple.mpegurl + ACAO: *）。
 * HLS 优先 —— 可以直接用 hls.js 播，iOS Safari 也能原生播。
 */
export async function fetchLiveStream(realRoomId) {
  const url =
    'https://api.live.bilibili.com/xlive/web-room/v1/playUrl/playUrl' +
    `?cid=${realRoomId}&qn=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8`;
  const j = fetchJson(url, [`Referer: https://live.bilibili.com/room/${realRoomId}`]);
  const d = j && j.data;
  if (!d || !d.durl || !d.durl.length) return null;
  const u = d.durl[0].url || '';
  if (!u) return null;
  let expires = 0;
  let qn = d.current_qn || 150;
  const mExp = u.match(/expires=(\d+)/);
  if (mExp) expires = Number(mExp[1]);
  const mQn = u.match(/qn=(\d+)/);
  if (mQn) qn = Number(mQn[1]);
  // 同一路径的 HLS 变体（.flv → .m3u8），签名一致
  const hls = u.replace(/\.flv\?/, '.m3u8?');
  return {
    url: hls,
    flvUrl: u,
    expires,
    qn,
    qnName: QN_NAME[qn] || String(qn),
    type: 'hls',
  };
}

/** 一次性把房间的「状态 + 流地址」都拿齐 */
export async function fetchLiveRoom(roomId) {
  const info = await fetchRoomInfo(roomId);
  if (!info) return null;
  let stream = null;
  if (info.live) {
    stream = await fetchLiveStream(info.roomid);
    await sleep(250);
  }
  return {
    roomid: info.roomid,
    uid: info.uid,
    title: info.title,
    live: info.live,
    online: info.online,
    attention: info.attention,
    uname: info.uname,
    area: info.area,
    stream: stream
      ? {
          url: stream.url,
          flvUrl: stream.flvUrl,
          expires: stream.expires,
          qn: stream.qn,
          qnName: stream.qnName,
          type: stream.type,
        }
      : null,
    biliUrl: `https://live.bilibili.com/${info.roomid}`,
  };
}

export { sleep };
