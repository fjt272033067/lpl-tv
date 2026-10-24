// Probe v8: bilibili discovery routes + danmaku CORS
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
  });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const spi = JSON.parse((await jget('https://api.bilibili.com/x/frontend/finger/spi')).text).data;
const ck = `buvid3=${spi.b_3}; buvid4=${spi.b_4}; b_nut=${Math.floor(Date.now() / 1000)}; b_lsid=${spi.b_3}XX`;

console.log('=== A. bilibili discovery endpoints ===');
const eps = [
  ['search/type no-wbi', 'https://api.bilibili.com/x/web-interface/search/type?search_type=media&keyword=LPL&page=1', {}],
  ['search/all/v2', 'https://api.bilibili.com/x/web-interface/search/all/v2?keyword=LPL', {}],
  ['newlist ps=20', 'https://api.bilibili.com/x/web-interface/newlist?rid=171&pn=1&ps=20', {}],
  ['dynamic/region', 'https://api.bilibili.com/x/web-interface/dynamic/region?rid=171&pn=1&ps=20', {}],
  ['polymer feed region', 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/region?rid=171&ps=20', {}],
  ['ranking/region', 'https://api.bilibili.com/x/web-interface/ranking/region?rid=171&day=3', {}],
  ['live area tree', 'https://api.live.bilibili.com/xlive/web-interface/v1/index/getWebAreaList', { Referer: 'https://live.bilibili.com/' }],
  ['live area list2', 'https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=1&area_id=3&sort_type=online&page=1&page_size=30&web_location=333.1387', { Referer: 'https://live.bilibili.com/' }],
  ['live room/roomList', 'https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=30&room_id=1', { Referer: 'https://live.bilibili.com/' }],
  ['live recommend2', 'https://api.live.bilibili.com/xlive/web-interface/v1/index/getWebAreaList?source_id=2', { Referer: 'https://live.bilibili.com/' }],
  ['space arc no-wbi', 'https://api.bilibili.com/x/space/arc/search?mid=401742021&pn=1&ps=30', {}],
  ['app space cursor', 'https://app.bilibili.com/x/v2/space/archive/cursor?vmid=401742021&ps=30', {}],
  ['card', 'https://api.bilibili.com/x/web-interface/card?mid=401742021&photo=false', {}],
];
for (const [name, url, h] of eps) {
  try {
    const { status, text } = await jget(url, { Cookie: ck, ...h });
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      console.log(`   ${name.padEnd(20)} http=${status} NON-JSON len=${text.length} head=${text.slice(0, 60).replace(/\s+/g, ' ')}`);
      continue;
    }
    const d = j.data || {};
    const n =
      d.archives?.length || d.result?.length || d.list?.length || d.rooms?.length || 0;
    console.log(`   ${name.padEnd(20)} http=${status} code=${j.code} msg=${j.message} n=${n} keys=${Object.keys(d).join(',').slice(0, 70)}`);
    const arr = d.archives || d.result || d.list || [];
    for (const it of arr.slice(0, 4)) {
      if (it.bvid)
        console.log(`      ${it.bvid} ${it.duration || ''} ${String(it.title || '').replace(/<[^>]+>/g, '').slice(0, 44)}`);
      else if (it.roomid)
        console.log(`      room=${it.roomid} ${String(it.title || '').slice(0, 44)}`);
    }
  } catch (e) {
    console.log(`   ${name.padEnd(20)} fail ${e.message}`);
  }
}

console.log('\n=== B. real cid + danmaku endpoints CORS ===');
const v = await jget('https://api.bilibili.com/x/web-interface/view?bvid=BV1GJ411x7h7', { Cookie: ck });
const vj = JSON.parse(v.text);
const cid = vj.data?.cid;
console.log(`  cid=${cid} title=${vj.data?.title}`);
for (const u of [
  `https://comment.bilibili.com/${cid}.xml`,
  `https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=1`,
  `https://api.bilibili.com/x/v2/dm/view?type=1&oid=${cid}`,
  `https://api.bilibili.com/x/v2/dm/web/list.so?type=1&oid=${cid}`,
]) {
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': UA, Origin: 'https://example.com', Referer: 'https://www.bilibili.com/video/BV1GJ411x7h7/', Cookie: ck },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`   ${r.status} acao=${(r.headers.get('access-control-allow-origin') || 'NONE').padEnd(10)} len=${String(buf.length).padEnd(7)} ${u.slice(0, 74)}`);
    if (buf.length && buf.length < 400) console.log(`      ${buf.toString('utf8').slice(0, 200)}`);
  } catch (e) {
    console.log(`   ERR ${u.slice(0, 74)} ${e.message}`);
  }
}

console.log('\n=== C. live danmaku WS auth endpoints ===');
for (const u of [
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=1&type=0',
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=1',
  'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=1',
]) {
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': UA, Origin: 'https://example.com', Referer: 'https://live.bilibili.com/', Cookie: ck },
    });
    const t = await r.text();
    console.log(`   ${r.status} acao=${(r.headers.get('access-control-allow-origin') || 'NONE').padEnd(10)} ${u.slice(0, 68)}`);
    console.log(`      ${t.slice(0, 180).replace(/\s+/g, ' ')}`);
  } catch (e) {
    console.log(`   ERR ${u.slice(0, 68)} ${e.message}`);
  }
}
