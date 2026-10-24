// Probe v2: fixed parsing + debug
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function parseTencent(text) {
  let t = text.trim();
  t = t.replace(/^QZOutputJson=/, '');
  t = t.replace(/^cb\(/, '').replace(/\);?\s*$/, '');
  return JSON.parse(t);
}

async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...headers,
    },
  });
  const t = await r.text();
  return { status: r.status, text: t, headers: r.headers };
}

async function tencent() {
  const base =
    'https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=h41002own3j';
  const variants = [
    ['', 'default'],
    ['&level=100031', 'level=100031(蓝光)'],
    ['&level=100019', 'level=100019(超清)'],
    ['&level=100003', 'level=100003(高清)'],
    ['&hd=4', 'hd=4'],
  ];
  for (const [q, tag] of variants) {
    const { text } = await jget(base + q, { Referer: 'https://lpl.qq.com/' });
    try {
      const j = parseTencent(text);
      const fl = j.fl?.fi || [];
      const vi = j.vl?.vi?.[0] || {};
      console.log(
        `  ${tag.padEnd(20)} formats=[${fl.map((f) => `${f.name}:${f.resolution}`).join(' ')}] vh=${vi.vh} fc=${vi.cl?.fc}`
      );
    } catch (e) {
      console.log(`  ${tag.padEnd(20)} parse fail: ${text.slice(0, 90)}`);
    }
  }

  const { text } = await jget(base, { Referer: 'https://lpl.qq.com/' });
  const j = parseTencent(text);
  const vi = j.vl.vi[0];
  const { vid, keyid, fvkey, fn } = vi;
  console.log(`\n  vi.vid=${vid} keyid=${keyid} fn=${fn}`);
  console.log(`  vi.fvkey=${String(fvkey).slice(0, 40)}... len=${fvkey.length}`);
  console.log(`  vi keys=${Object.keys(vi).join(',')}`);
  console.log(`  vi.cl=${JSON.stringify(vi.cl)}`);
  console.log(`  vi.pl=${JSON.stringify(vi.pl)}`);

  const cands = [];
  for (const f of j.fl.fi) {
    const fd = f.formatdefn || f.name;
    cands.push(
      [`https://hls.v.qq.com/${vid}/${fd}/${keyid}.m3u8?vkey=${fvkey}`, `${fd} fq`],
      [`https://hls.v.qq.com/${vid}/${keyid}.m3u8?vkey=${fvkey}`, `${fd} bare`],
      [`https://hls.v.qq.com/${vid}/${fd}.m3u8?vkey=${fvkey}`, `${fd} flat`],
      [`https://vip.hdcdn.qq.com/${fn}?vkey=${fvkey}`, `${fd} mp4`]
    );
  }
  cands.push([`https://hls.v.qq.com/${vid}/${keyid}.m3u8`, 'nokey']);
  console.log('\n  -- HLS candidates --');
  for (const [u, tag] of cands) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://v.qq.com/' } });
      const body = r.ok ? (await r.text()).slice(0, 100).replace(/\n/g, '|') : '';
      console.log(`   ${r.status} ${tag.padEnd(10)} ${u.slice(0, 78)} ${body}`);
    } catch (e) {
      console.log(`   ERR ${tag}: ${e.message}`);
    }
  }
}

const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21,
  56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(str) {
  let c = 0xffffffff;
  for (let i = 0; i < str.length; i++) c = crcTable[(c ^ str.charCodeAt(i)) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const mixinKey = (imgKey, subKey) => {
  const raw = imgKey + subKey;
  return MIXIN.filter((i) => i < raw.length)
    .map((i) => raw[i])
    .join('')
    .slice(0, 32);
};

async function bili() {
  const nav = await jget('https://api.bilibili.com/x/web-interface/nav');
  console.log(`  nav status=${nav.status} head=${nav.text.slice(0, 60)}`);
  const navJson = JSON.parse(nav.text);
  const img = navJson.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const sub = navJson.data.wbi_img.sub_url.split('/').pop().split('.')[0];
  const key = mixinKey(img, sub);
  const spi = await jget('https://api.bilibili.com/x/frontend/finger/spi');
  const buvid3 = JSON.parse(spi.text).data.b_3;
  const cookie = `buvid3=${buvid3}; b_nut=${Math.floor(Date.now() / 1000)}`;
  console.log(`  wbi mixin=${key} buvid3 ok`);

  const sign = (params) => {
    const wts = Math.round(Date.now() / 1000);
    const p = { ...params, wts };
    const q = Object.keys(p)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
      .join('&');
    return `${q}&w_rid=${crc32(q + key).toString(16).padStart(8, '0')}`;
  };

  const r = await jget(
    `https://api.bilibili.com/x/web-interface/wbi/search/type?${sign({
      search_type: 'media',
      keyword: 'LPL',
      page: 1,
      order: 'pubdate',
    })}`,
    { Cookie: cookie, Referer: 'https://search.bilibili.com/' }
  );
  console.log(`  search status=${r.status} head=${r.text.slice(0, 80)}`);
  const j = JSON.parse(r.text);
  console.log(`  search code=${j.code} dataKeys=${Object.keys(j.data || {}).join(',')}`);
  const list = j.data?.result || [];
  console.log(`  results=${list.length}`);
  for (const it of list.slice(0, 10))
    console.log(`   ${it.bvid} ${it.duration} ${String(it.title).replace(/<[^>]+>/g, '').slice(0, 56)}`);

  // danmaku via view
  const bvid = list[0]?.bvid || 'BV1GJ411x7h7';
  const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { Cookie: cookie });
  console.log(`\n  view(${bvid}) status=${view.status} head=${view.text.slice(0, 100)}`);
  return { cookie, key, bvid };
}

console.log('=== TENCENT ===');
await tencent();
console.log('\n=== BILIBILI ===');
const r = await bili();
console.log(`\n  use bvid=${r.bvid}`);
