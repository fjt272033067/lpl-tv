/* =====================================================================
 * refresh-liverooms.mjs — 重建 B 站直播间映射
 *  1) 读腾讯当前直播（拿到正在进行的对阵）
 *  2) 针对该对阵 + 若干通用关键词检索 B 站直播间
 *  3) 用 room/v1/Room/get_info 标记 live_status
 *  → site/data/liverooms.json
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson, fetchLiveRoom, sleep } from './bili-live.mjs';
import { EXTERNAL_ROOMS } from './live-rooms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'site', 'data');

/* 1) 腾讯当前直播（偶发返回空，重试几次） */
let live = null;
let subtitles = [];
for (let attempt = 0; attempt < 3 && !subtitles.length; attempt++) {
  if (attempt) await sleep(1500);
  live = await fetchJson(
    'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList',
    ['Referer: https://lpl.qq.com/']
  );
  for (const a of (live?.data?.anchorList || [])) {
    let prog = {};
    try { prog = JSON.parse(a.extInfo?.gameProgram || '{}'); } catch {}
    if (prog.subTitle) subtitles.push(prog.subTitle);
    console.log(`  直播线路: ${prog.subTitle || '(无副标题)'}  标题=${a.roomInfo?.roomTitle || ''}`);
  }
}
console.log('  当前对阵: ' + (subtitles.join(' / ') || '(无)'));

/* 2) 检索 B 站直播间 */
const rooms = new Map();
function collect(j) {
  for (const g of j?.data?.result || []) {
    if (g.result_type !== 'video') continue;
    for (const it of g.data || []) {
      if (!it.roomid) continue;
      const title = String(it.title || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
      if (!/英雄联盟|LPL|总决赛|赛事|二路|4K|S16|S15/i.test(title)) continue;
      rooms.set(String(it.roomid), { roomid: it.roomid, uid: it.uid || 0, title });
    }
  }
}
const keywords = [
  ...subtitles.map((s) => s.replace(/\s*[:：]\s*/g, ' ')),
  '英雄联盟赛事',
  '英雄联盟全球总决赛',
  '英雄联盟全球总决赛二路',
  'LPL 直播',
  '英雄联盟 比赛',
  '英雄联盟S16',
  '英雄联盟 决赛',
  '电竞比赛',
];
for (const kw of keywords) {
  if (!kw) continue;
  for (const pg of [1, 2]) {
    collect(fetchJson(`https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(kw)}&page=${pg}`, [
      'Referer: https://search.bilibili.com/',
    ]));
    await sleep(450);
  }
  console.log(`  检索 "${kw}" 累计 ${rooms.size} 个直播间`);
}

/* 3) 标记 live_status，并抓取直播流地址（只有构建期能拿到，运行时无 CORS） */
const out = [];
for (const r of rooms.values()) {
  const info = await fetchLiveRoom(r.roomid);
  if (!info) continue;
  out.push({
    roomid: info.roomid,
    uid: info.uid || r.uid || 0,
    title: info.title || r.title,
    live: info.live,
    online: info.online || 0,
    uname: info.uname || '',
    area: info.area || '',
    stream: info.stream || null,
    biliUrl: info.biliUrl,
  });
  await sleep(220);
}
out.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
fs.writeFileSync(
  path.join(DATA, 'liverooms.json'),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      currentMatch: subtitles[0] || '',
      rooms: out,
      externalRooms: EXTERNAL_ROOMS,
    },
    null,
    1
  )
);
console.log(`\n已写入 liverooms.json：${out.length} 个直播间，其中 ${out.filter((r) => r.live).length} 个正在直播`);
out.slice(0, 12).forEach((r) => console.log(`   ${r.live ? '●' : '○'} ${r.roomid}  ${r.title.slice(0, 52)}`));
