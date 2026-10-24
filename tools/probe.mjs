// One-off probe: Tencent VOD HLS URL construction + Bilibili WBI search/danmaku
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const jget = async (url, headers = {}) => {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', ...headers },
  });
  const t = await r.text();
  return { status: r.status, text: t, headers: r.headers };
};

/* ---------------- 1. Tencent getinfo: quality levels + HLS URL ---------- */
async function tencent() {
  const base =
    'https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=h41002own3j';
  for (const extra of ['', '&level=100031', '&level=100019', '&level=100003', '&format=10212']) {
    const { text } = await jget(base + extra, { Referer: 'https://lpl.qq.com/' });
    const raw = text.replace(/^cb\(/, '').replace(/\);?\s*$/, '');
    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      console.log(`  level${extra}: parse fail`, text.slice(0, 120));
      continue;
    }
    const fl = j.fl?.fi || [];
    const vi = j.vl?.vi?.[0] || {};
    console.log(
      `  [${extra || 'default'}] formats=${fl
        .map((f) => `${f.name}:${f.resolution}(id${f.id})`)
        .join(', ')}`
    );
    console.log(
      `      vi: vid=${vi.vid} keyid=${vi.keyid} fn=${vi.fn} fc=${vi.cl?.fc} td=${vi.td} fvkey=${(vi.fvkey || '').slice(0, 24)}...`
    );
    console.log(`      vi.pl=${JSON.stringify(vi.pl || []).slice(0, 300)}`);
  }

  // Try candidate HLS URL shapes with the default (480P) vkey
  const { text } = await jget(base + '&callback=cb', { Referer: 'https://lpl.qq.com/' });
  const j = JSON.parse(text.replace(/^cb\(/, '').replace(/\);?\s*$/, ''));
  const vi = j.vl.vi[0];
  const { vid, keyid, fvkey, fn, cl } = vi;
  const fi = j.fl.fi;
  const cands = [];
  for (const f of fi) {
    const fd = f.formatdefn || f.name;
    cands.push(
      [`https://hls.v.qq.com/${vid}/${fd}/${keyid}.m3u8?vkey=${fvkey}`, `${fd} fq`],
      [`https://hls.v.qq.com/${vid}/${keyid}.m3u8?vkey=${fvkey}`, `${fd} bare`],
      [`https://hls.v.qq.com/${vid}/${fd}.m3u8?vkey=${fvkey}`, `${fd} flat`],
      [`https://vip.hdcdn.qq.com/${fn}?vkey=${fvkey}`, `${fd} mp4-cdn`]
    );
  }
  cands.push([`https://hls.v.qq.com/${vid}/${keyid}.m3u8`, 'nokey']);
  console.log('\n  -- HLS candidates --');
  for (const [u, tag] of cands) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://v.qq.com/' } });
      const body = r.ok ? (await r.text()).slice(0, 90).replace(/\n/g, '|') : '';
      console.log(`   ${r.status} ${tag.padEnd(14)} ${u.slice(0, 92)} ${body}`);
    } catch (e) {
      console.log(`   ERR ${tag}: ${e.message}`);
    }
  }
}

/* ---------------- 2. Bilibili WBI search ------------------------------- */
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
  for (let i = 0; i < str.length; i++)
    c = crcTable[(c ^ str.charCodeAt(i)) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const mixinKey = (imgKey, subKey) =>
  MIXIN.map((i) => imgKey + subKey)
    .join('')
    .slice(0, 32)
    .split('')
    .map((c) => c.charCodeAt(0))
    .filter((c) => MIXIN.includes(c))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.c)
    .join('');

async function bili() {
  const nav = await jget('https://api.bilibili.com/x/web-interface/nav');
  const navJson = JSON.parse(nav.text);
  const img = navJson.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const sub = navJson.data.wbi_img.sub_url.split('/').pop().split('.')[0];
  const key = mixinKey(img, sub);
  console.log(`  wbi keys ok (img=${img} sub=${sub})`);

  const spi = await jget('https://api.bilibili.com/x/frontend/finger/spi');
  const buvid3 = JSON.parse(spi.text).data.b_3;
  console.log(`  buvid3=${String(buvid3).slice(0, 12)}...`);

  const sign = (params) => {
    const wts = Math.round(Date.now() / 1000);
    const p = { ...params, wts };
    const q = Object.keys(p)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
      .join('&');
    return `${q}&w_rid=${crc32(q + key).toString(16).padStart(8, '0')}`;
  };

  const cookie = `buvid3=${buvid3}; b_nut=${Math.floor(Date.now() / 1000)}`;
  const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${sign({
    search_type: 'media',
    keyword: 'LPL',
    page: 1,
  })}`;
  const r = await jget(url, { Cookie: cookie });
  const j = JSON.parse(r.text);
  console.log(`  search code=${j.code} msg=${j.message}`);
  const list = j.data?.result || [];
  for (const it of list.slice(0, 8)) {
    console.log(
      `   ${it.bvid} dur=${it.duration} ${String(it.title).replace(/<[^>]+>/g, '').slice(0, 60)}`
    );
  }
  return { cookie, key };
}

/* ---------------- 3. Bilibili danmaku (protobuf) ------------------------ */
function decodeVarint(buf, pos) {
  let res = 0,
    shift = 0;
  for (; ;) {
    const b = buf[pos++];
    res |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [res >>> 0, pos];
}
function parseDanmaku(buf) {
  // DanmakuSegment: field 1 repeated DanmakuElem
  const out = [];
  let p = 0;
  while (p < buf.length) {
    const [tag, np] = decodeVarint(buf, p);
    p = np;
    const field = tag >> 3,
      wire = tag & 7;
    if (wire === 2) {
      const [len, np2] = decodeVarint(buf, p);
      p = np2;
      const data = buf.subarray(p, p + len);
      p += len;
      if (field === 1) {
        const el = {};
        let q = 0;
        while (q < data.length) {
          const [t2, nq] = decodeVarint(data, q);
          q = nq;
          const f2 = t2 >> 3,
            w2 = t2 & 7;
          if (w2 === 2) {
            const [l2, nq2] = decodeVarint(data, q);
            q = nq2;
            const s = data.subarray(q, q + l2).toString('utf8');
            q += l2;
            if (f2 === 7) el.content = s;
            else if (f2 === 6) el.midHash = s;
          } else if (w2 === 0) {
            const [v, nq2] = decodeVarint(data, q);
            q = nq2;
            if (f2 === 1) el.id = v;
            else if (f2 === 2) el.progress = v;
            else if (f2 === 3) el.mode = v;
            else if (f2 === 4) el.fontsize = v;
            else if (f2 === 5) el.color = v;
          } else if (w2 === 5) {
            q += 4;
          } else if (w2 === 1) {
            q += 8;
          } else break;
        }
        if (el.content) out.push(el);
      }
    } else if (wire === 0) {
      const [, np2] = decodeVarint(buf, p);
      p = np2;
    } else if (wire === 5) {
      p += 4;
    } else if (wire === 1) {
      p += 8;
    } else break;
  }
  return out;
}

async function danmaku(cookie) {
  const bvid = process.argv[2] || 'BV1GJ411x7h7';
  const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { Cookie: cookie });
  const vj = JSON.parse(view.text);
  if (vj.code !== 0) {
    console.log(`  view failed: ${vj.code} ${vj.message}`);
    return;
  }
  const cid = vj.data.cid;
  console.log(`  ${bvid} cid=${cid} title=${vj.data.title} pages=${vj.data.videos}`);
  const r = await fetch(
    `https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=1`,
    { headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${bvid}/`, Cookie: cookie } }
  );
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(`  seg.so status=${r.status} bytes=${buf.length}`);
  const list = parseDanmaku(buf);
  console.log(`  parsed ${list.length} danmaku; sample:`);
  for (const d of list.slice(0, 5))
    console.log(`    t=${d.progress}ms mode=${d.mode} color=${d.color} "${d.content}"`);
  const modes = {};
  for (const d of list) modes[d.mode] = (modes[d.mode] || 0) + 1;
  console.log('  mode histogram:', JSON.stringify(modes));
}

console.log('=== TENCENT ===');
await tencent();
console.log('\n=== BILIBILI ===');
const { cookie } = await bili();
console.log('\n=== DANMAKU ===');
await danmaku(cookie);
