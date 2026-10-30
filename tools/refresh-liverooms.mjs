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
  'LPL 比赛',
  '一点看lpl比赛',
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
const COVER_DIR = path.join(DATA, 'cover');
const livePath = path.join(DATA, 'liverooms.json');

// 复用上一轮仍然有效的流地址：B 站签名约 60 分钟过期，
// 没过期就没必要重新签发（重新签发还要重抓封面帧，耗时 40 秒）。
// 阈值留 15 分钟余量，避免「刚签发完就过期」。
const REUSE_MINUTES = 15;
let prevByRoom = new Map();
try {
  if (fs.existsSync(livePath)) {
    const prev = JSON.parse(fs.readFileSync(livePath, 'utf8'));
    (prev.rooms || []).forEach((r) => prevByRoom.set(String(r.roomid), r));
  }
} catch (e) {
  /* 旧文件损坏就全部重签 */
}

const out = [];
let reused = 0;
let resigned = 0;
const resignedRooms = new Set();
for (const r of rooms.values()) {
  const info = await fetchLiveRoom(r.roomid);
  if (!info) continue;
  const prev = prevByRoom.get(String(info.roomid));
  let stream = info.stream || null;
  const prevLeft = prev && prev.stream ? Math.round((prev.stream.expires - Date.now() / 1000) / 60) : -1;
  if (stream && prev && prevLeft > REUSE_MINUTES) {
    // 旧地址还够用 → 复用，省一次 playUrl 请求
    stream = prev.stream;
    reused++;
  } else if (stream) {
    resigned++;
    resignedRooms.add(String(info.roomid));
  }
  out.push({
    roomid: info.roomid,
    uid: info.uid || r.uid || 0,
    title: info.title || r.title,
    live: info.live,
    online: info.online || 0,
    attention: info.attention || 0,
    uname: info.uname || '',
    area: info.area || '',
    cover: '',
    stream,
    biliUrl: info.biliUrl,
  });
  await sleep(220);
}
console.log(`  流地址：复用 ${reused} 个 / 重新签发 ${resigned} 个`);

// 抓封面帧（必须在写 json 之前：流地址有效期约 60 分钟，抓帧要趁新）
let txCovers = {};
try {
  const { captureCovers, captureTencentCovers } = await import('./capture-covers.mjs');
  // 只有本次新签发流地址的房间才需要重抓封面（复用地址的封面已在磁盘上）
  captureCovers(
    out.filter((r) => r.live && r.stream && resignedRooms.has(String(r.roomid))),
    COVER_DIR
  );
  txCovers = captureTencentCovers(COVER_DIR);
} catch (e) {
  console.log('封面抓取跳过：' + (e.message || '').split('\n')[0]);
}
out.forEach((r) => {
  const f = path.join(COVER_DIR, `${r.roomid}.jpg`);
  // 没有封面就留空，前端显示平台占位而不是 404
  r.cover = fs.existsSync(f) && fs.statSync(f).size > 2000 ? 'data/cover/' + r.roomid + '.jpg' : '';
});
out.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
fs.writeFileSync(
  path.join(DATA, 'liverooms.json'),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      currentMatch: subtitles[0] || '',
      rooms: out,
      externalRooms: EXTERNAL_ROOMS,
      // 腾讯官方源的封面（anchorId → 图片路径）
      txCovers: txCovers,
    },
    null,
    1
  )
);
console.log(`\n已写入 liverooms.json：${out.length} 个直播间，其中 ${out.filter((r) => r.live).length} 个正在直播`);
out.slice(0, 12).forEach((r) => console.log(`   ${r.live ? '●' : '○'} ${r.roomid}  ${r.title.slice(0, 52)}${r.cover ? '  [有封面]' : ''}`));

/* 4) 更新版本文件 —— 站点用 version.json 的 updatedAt 判断「数据有多新」。
 *    轻量刷新只动 liverooms，schedule/catalog 的内容时间戳保持原样。 */
const versionPath = path.join(DATA, 'version.json');
let version = { updatedAt: new Date().toISOString(), files: {} };
try {
  if (fs.existsSync(versionPath)) version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
} catch (e) {
  /* 版本文件损坏就重建 */
}
version.updatedAt = new Date().toISOString();
version.files = version.files || {};
version.files.liverooms = version.files.liverooms || new Date().toISOString();
// schedule/catalog 的内容时间戳：文件在就沿用，不在就记当前时间
for (const f of ['schedule', 'catalog']) {
  const p = path.join(DATA, f + '.json');
  try {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      version.files[f] = j.updatedAt || version.files[f] || version.updatedAt;
    }
  } catch (e) {
    /* 读不了就保留旧值 */
  }
}
fs.writeFileSync(versionPath, JSON.stringify(version));
console.log(`已更新 version.json（刷新时间 ${version.updatedAt}）`);
