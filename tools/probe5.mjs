// Probe v5: catalog parse + 2026 vid quality + bilibili WBI/danmaku
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
  });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
function parseTencent(text) {
  const i = text.indexOf('{');
  const k = text.lastIndexOf('}');
  return JSON.parse(text.slice(i, k + 1));
}

let catalog = null;
console.log('=== A. catalog ===');
const { text: cat } = await jget(
  'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js'
);
console.log(`  head=${cat.slice(0, 40)}`);
try {
  catalog = JSON.parse(cat);
} catch {
  const m = cat.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
  catalog = JSON.parse(m[1]);
}
const list = catalog.msg || [];
console.log(`  total=${list.length}`);
const withVid = list
  .map((it) => {
    let ext = {};
    try {
      ext = JSON.parse(it.sExt1 || '{}');
    } catch {}
    return { ...it, ext };
  })
  .filter((it) => it.ext && it.ext.sVID);
console.log(`  withVid=${withVid.length}`);
const recent = withVid.slice(0, 8);
for (const it of recent)
  console.log(`   ${it.MatchDate} | ${it.GameName} | ${it.ext.sVID} | ${it.ext.iTime}s | ${it.ext.sName}`);
const y26 = withVid
  .filter((it) => /2026/.test(it.GameName + it.MatchDate))
  .sort((a, b) => (a.MatchDate < b.MatchDate ? 1 : -1));
console.log(`\n  -- 2026 (${y26.length}) --`);
for (const it of y26.slice(0, 10))
  console.log(`   ${it.MatchDate} | ${it.GameName} | ${it.ext.sVID} | ${it.ext.sName}`);
const pick = y26[0]?.ext.sVID;
console.log(`\n  pick=${pick}`);

console.log('\n=== B. getinfo quality matrix ===');
for (const [q, tag] of [
  ['', 'default'],
  ['&level=100031', '100031'],
  ['&level=100019', '100019'],
  ['&level=100003', '100003'],
  ['&level=100001', '100001'],
  ['&fc=10212', 'fc=10212'],
  ['&hd=4', 'hd=4'],
  ['&platform=11001', 'plat11001'],
]) {
  try {
    const { text } = await jget(
      `https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=${pick}${q}`,
      { Referer: 'https://lpl.qq.com/' }
    );
    const j = parseTencent(text);
    const fl = j.fl?.fi || [];
    const vi = j.vl?.vi?.[0] || {};
    console.log(
      `   ${tag.padEnd(11)} [${fl.map((f) => `${f.name}:${f.resolution}`).join(' ')}] fc=${vi.cl?.fc} vh=${vi.vh} fn=${String(vi.fn).slice(0, 20)}`
    );
  } catch (e) {
    console.log(`   ${tag} fail ${e.message}`);
  }
}

console.log('\n=== C. dns ===');
const dns = await import('node:dns/promises');
for (const h of ['hls.v.qq.com', 'vip.hdcdn.qq.com', 'omex.tc.qq.com', '37055.liveplay.myqcloud.com']) {
  try {
    const a = await dns.resolve4(h);
    console.log(`   ${h} -> ${a.slice(0, 2).join(',')}`);
  } catch (e) {
    console.log(`   ${h} -> DNS FAIL ${e.code || e.message}`);
  }
}

console.log('\n=== D. bilibili ===');
const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21,
  56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
const ct = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (s) => {
  let c = 0xffffffff;
  for (let i = 0; i < s.length; i++) c = ct[(c ^ s.charCodeAt(i)) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const nav = await jget('https://api.bilibili.com/x/web-interface/nav');
const nj = JSON.parse(nav.text);
const img = nj.data.wbi_img.img_url.split('/').pop().split('.')[0];
const sub = nj.data.wbi_img.sub_url.split('/').pop().split('.')[0];
const raw = img + sub;
const key = MIXIN.filter((i) => i < raw.length)
  .map((i) => raw[i])
  .join('')
  .slice(0, 32);
const spi = JSON.parse((await jget('https://api.bilibili.com/x/frontend/finger/spi')).text).data.b_3;
const cookie = `buvid3=${spi}; b_nut=${Math.floor(Date.now() / 1000)}; b_lsid=${spi}XX`;
const sign = (p) => {
  const wts = Math.round(Date.now() / 1000);
  const o = { ...p, wts };
  const q = Object.keys(o)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(o[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${q}&w_rid=${crc32(q + key).toString(16).padStart(8, '0')}`;
};
const kw = process.argv[2] || '英雄联盟 全球总决赛';
const sr = await jget(
  `https://api.bilibili.com/x/web-interface/wbi/search/type?${sign({
    search_type: 'media',
    keyword: kw,
    page: 1,
    order: 'pubdate',
  })}`,
  { Cookie: cookie, Referer: 'https://search.bilibili.com/' }
);
console.log(`  search(${kw}) status=${sr.status}`);
const sj = JSON.parse(sr.text);
console.log(`  code=${sj.code} msg=${sj.message} dataKeys=${Object.keys(sj.data || {}).join(',')}`);
const res = sj.data?.result || [];
console.log(`  results=${res.length}`);
for (const it of res.slice(0, 10))
  console.log(`   ${it.bvid} ${it.duration} ${String(it.title).replace(/<[^>]+>/g, '').slice(0, 56)}`);

if (res[0]) {
  const bvid = res[0].bvid;
  const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { Cookie: cookie });
  console.log(`\n  view(${bvid}) status=${view.status} head=${view.text.slice(0, 80)}`);
  try {
    const vj = JSON.parse(view.text);
    const cid = vj.data.cid;
    const dm = await fetch(
      `https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=1`,
      { headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${bvid}/`, Cookie: cookie } }
    );
    const buf = Buffer.from(await dm.arrayBuffer());
    console.log(`  dm status=${dm.status} bytes=${buf.length}`);
  } catch (e) {
    console.log(`  view parse fail ${e.message}`);
  }
}
