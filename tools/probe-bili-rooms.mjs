/* =====================================================================
 * probe-bili-rooms.mjs — 广撒网找 B 站赛事直播间，并测每个房间的清晰度上限
 * 关注 suffix（推流档位）：2500=720P，4000/6000=1080P+
 * ===================================================================== */
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

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
const json = (url, headers) => {
  const raw = decode(curlBuf(url, headers));
  try { return JSON.parse(raw); } catch { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 搜直播间
const KEYWORDS = [
  '英雄联盟全球总决赛', 'LPL 直播', '英雄联盟赛事', 'S16 瑞士轮', '全球总决赛 二路',
  '英雄联盟 决赛 直播', 'LPL 解说', '英雄联盟 官方直播间', '电竞比赛 直播', 'LPL 2026',
];
const rooms = new Map();
for (const kw of KEYWORDS) {
  for (const pg of [1, 2]) {
    const j = json(
      `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(kw)}&page=${pg}`,
      ['Referer: https://search.bilibili.com/']
    );
    for (const g of (j?.data?.result || [])) {
      if (g.result_type !== 'video') continue;
      for (const it of g.data || []) {
        if (!it.roomid) continue;
        const title = String(it.title || '').replace(/<[^>]+>/g, '');
        if (!/英雄联盟|LPL|总决赛|赛事|瑞士轮|S16/i.test(title)) continue;
        rooms.set(String(it.roomid), { roomid: it.roomid, title, kw });
      }
    }
    await sleep(450);
  }
}
console.log(`搜到候选直播间 ${rooms.size} 个\n`);

// 2) 逐个测清晰度上限
const results = [];
for (const r of rooms.values()) {
  const j = json(
    `https://api.live.bilibili.com/xlive/web-room/v1/playUrl/playUrl?cid=${r.roomid}&qn=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8`,
    [`Referer: https://live.bilibili.com/room/${r.roomid}`]
  );
  const d = j?.data;
  if (!d || !d.durl || !d.durl.length) continue;
  const url = d.durl[0].url || '';
  const sfx = (url.match(/suffix=(\d+)/) || [])[1] || '0';
  const ob = (url.match(/origin_bitrate=(\d+)/) || [])[1] || '0';
  const info = json(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${r.roomid}`, [
    'Referer: https://live.bilibili.com/',
  ]);
  const live = info?.data?.live_status === 1;
  const online = info?.data?.online || 0;
  const area = info?.data?.area_name || '';
  results.push({ ...r, live, online, area, qn: d.current_qn, suffix: +sfx, origin: +ob });
  await sleep(250);
}

results.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.suffix - a.suffix || b.online - a.online);
console.log('roomid  suffix qn  origin  live  online   area        标题');
for (const r of results) {
  console.log(
    `${String(r.roomid).padEnd(8)} ${String(r.suffix).padEnd(6)} ${String(r.qn).padEnd(3)} ${String(r.origin).padEnd(6)} ${r.live ? '●' : '○'}    ${String(r.online).padEnd(8)} ${(r.area || '').padEnd(10)} ${r.title.slice(0, 40)}`
  );
}
const top = results.filter((r) => r.live).sort((a, b) => b.suffix - a.suffix);
console.log('\n最高档位在播房间:');
top.slice(0, 8).forEach((r) => console.log(`  ${r.roomid}  suffix=${r.suffix}  qn=${r.qn}  ${r.online}人在看  ${r.title.slice(0, 36)}`));
