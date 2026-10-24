// Probe v7: quality ladder + superplayer truth + bilibili discovery
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
  });
  return { status: r.status, text: await r.text(), headers: r.headers, buf: null };
}
function pT(t) {
  const i = t.indexOf('{');
  const k = t.lastIndexOf('}');
  return JSON.parse(t.slice(i, k + 1));
}
const VID = 'g4102dolw2l';

console.log('=== A. defn ladder ===');
const base = `https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=${VID}`;
for (const d of ['', 'hd', 'shd', 'fhd', 'fhd2', 'uhd', 'hdr', 'dolby', '4k']) {
  try {
    const { text } = await jget(base + (d ? `&defn=${d}` : ''), { Referer: 'https://lpl.qq.com/' });
    const j = pT(text);
    const vi = j.vl?.vi?.[0] || {};
    const fl = (j.fl?.fi || []).map((f) => f.name).join(',');
    console.log(
      `   defn=${(d || '(none)').padEnd(7)} vw=${String(vi.vw).padEnd(5)} vh=${String(vi.vh).padEnd(5)} fn=${String(vi.fn).slice(0, 20)} vkey=${String(vi.fvkey).slice(0, 12)} avail=[${fl}]`
    );
  } catch (e) {
    console.log(`   defn=${d} fail ${e.message}`);
  }
}

console.log('\n=== B. superplayer.js: m3u8 + defn + format list ===');
try {
  const { text } = await jget('https://vm.gtimg.cn/thumbplayer/superplayer/superplayer.js');
  console.log(`  len=${text.length}`);
  for (const kw of ['m3u8', 'defn', 'getinfo']) {
    const idx = [...text.matchAll(new RegExp(kw, 'g'))].map((m) => m.index);
    console.log(`  -- ${kw} (${idx.length}) --`);
    for (const i of idx.slice(0, 5))
      console.log(`     ${text.slice(Math.max(0, i - 160), i + 160).replace(/\s+/g, ' ')}`);
  }
} catch (e) {
  console.log(`  fail ${e.message}`);
}

console.log('\n=== C. bilibili newlist rid=171 ===');
for (const pn of [1, 2, 3]) {
  try {
    const { text } = await jget(`https://api.bilibili.com/x/web-interface/newlist?rid=171&pn=${pn}&ps=50`, {
      Referer: 'https://www.bilibili.com/',
    });
    const j = JSON.parse(text);
    const arr = j.data?.archives || [];
    console.log(`   pn=${pn} code=${j.code} n=${arr.length}`);
    for (const it of arr.slice(0, 6))
      console.log(`      ${it.bvid} ${it.duration} ${String(it.title).replace(/<[^>]+>/g, '').slice(0, 48)}`);
  } catch (e) {
    console.log(`   pn=${pn} fail ${e.message}`);
  }
}

console.log('\n=== D. bilibili live area list w/ cookie ===');
const spi = await jget('https://api.bilibili.com/x/frontend/finger/spi');
const buvid3 = JSON.parse(spi.text).data.b_3;
const ck = `buvid3=${buvid3}; b_nut=${Math.floor(Date.now() / 1000)}`;
for (const [name, url] of [
  [
    'second/getList',
    'https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=1&area_id=3&sort_type=online&page=1&page_size=30',
  ],
  [
    'room/v3/area/getRoomList',
    'https://api.live.bilibili.com/xlive/web-interface/v1/index/getRoomList?platform=web&parent_area_id=1&area_id=3&page=1&page_size=30',
  ],
  [
    'web-room/v1/index/getList',
    'https://api.live.bilibili.com/xlive/web-room/v1/index/getList?platform=web&parent_area_id=1&area_id=3&page=1&page_size=30',
  ],
]) {
  try {
    const { status, text } = await jget(url, { Cookie: ck, Referer: 'https://live.bilibili.com/' });
    const j = JSON.parse(text);
    const rooms = j.data?.list || j.data?.room_list?.list || [];
    console.log(`   ${name.padEnd(26)} http=${status} code=${j.code} msg=${j.message} rooms=${rooms.length}`);
    for (const r of rooms.slice(0, 6))
      console.log(`      room=${r.roomid} ${String(r.title || r.uname).slice(0, 46)}`);
  } catch (e) {
    console.log(`   ${name} fail ${e.message}`);
  }
}
