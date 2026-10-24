// Probe v10: danmaku token (no Origin) + live WS + space arc list + cover hotlink
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
  });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const spi = JSON.parse((await jget('https://api.bilibili.com/x/frontend/finger/spi')).text).data;
const ck = `buvid3=${spi.b_3}; buvid4=${spi.b_4}; b_nut=${Math.floor(Date.now() / 1000)}`;
const ROOM = 7734200;

console.log('=== A. getDanmuInfo WITHOUT Origin ===');
for (const u of [
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0`,
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0&web_location=444.8`,
]) {
  const r = await jget(u, { Referer: `https://live.bilibili.com/${ROOM}` });
  console.log(`   ${r.status} ${u.slice(58)}`);
  console.log(`      ${r.text.slice(0, 300)}`);
}

console.log('\n=== B. live WS with token ===');
let token = '';
try {
  const t = JSON.parse(
    (await jget(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0`, {
      Referer: `https://live.bilibili.com/${ROOM}`,
    })).text
  );
  token = t.data?.token || '';
  console.log(`   token=${token}`);
} catch (e) {
  console.log(`   token fail ${e.message}`);
}

async function wsTest(label, key) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
    const packets = [];
    let done = false;
    const fin = (why) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      console.log(`   ${label}: ${why} packets=${packets.length}`);
      for (const p of packets.slice(0, 3)) console.log(`      ${p}`);
      resolve();
    };
    const timer = setTimeout(() => fin('timeout'), 12000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          uid: 0,
          roomid: ROOM,
          protover: 3,
          platform: 'web',
          type: 2,
          key: key,
        })
      );
    };
    ws.onmessage = (ev) => {
      const b = Buffer.from(ev.data);
      const op = b.readUInt32BE(0);
      let desc = `op=${op} len=${b.length}`;
      if (op === 8) {
        const code = b.readInt32BE(8);
        desc += ` authcode=${code}`;
      } else if (op === 5 && b.length > 16) {
        const body = b.subarray(16).toString('utf8');
        desc += ` body=${body.slice(0, 120)}`;
      }
      packets.push(desc);
      if (packets.length >= 4) {
        clearTimeout(timer);
        fin('ok');
      }
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      fin('error ' + (e.message || ''));
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      fin(`closed code=${e.code}`);
    };
  });
}
await wsTest('token=true', 'token=true');
if (token) await wsTest('real token', `token=${token}`);

console.log('\n=== C. 英雄联盟赛事 space video list (mid=108532523) ===');
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
const nav = JSON.parse((await jget('https://api.bilibili.com/x/web-interface/nav')).text);
const raw = nav.data.wbi_img.img_url.split('/').pop().split('.')[0] + nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];
const key = MIXIN.filter((i) => i < raw.length)
  .map((i) => raw[i])
  .join('')
  .slice(0, 32);
const sign = (p) => {
  const wts = Math.round(Date.now() / 1000);
  const o = { ...p, wts };
  const q = Object.keys(o)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(o[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${q}&w_rid=${crc32(q + key).toString(16).padStart(8, '0')}`;
};
for (const [name, url] of [
  ['space arc wbi', `https://api.bilibili.com/x/space/wbi/arc/search?${sign({ mid: 108532523, pn: 1, ps: 50, order: 'pubdate' })}`],
  ['app cursor', 'https://app.bilibili.com/x/v2/space/archive/cursor?vmid=108532523&ps=50'],
  ['space arc no-wbi', 'https://api.bilibili.com/x/space/arc/search?mid=108532523&pn=1&ps=50'],
]) {
  const r = await jget(url, { Cookie: ck, Referer: 'https://space.bilibili.com/108532523/video' });
  try {
    const j = JSON.parse(r.text);
    const list = j.data?.list?.vlist || j.data?.items || j.data?.archives || [];
    console.log(`   ${name.padEnd(18)} http=${r.status} code=${j.code} msg=${j.message} n=${list.length} keys=${Object.keys(j.data || {}).join(',').slice(0, 60)}`);
    for (const it of list.slice(0, 6))
      console.log(`      ${it.bvid} ${it.length || it.duration || ''} ${String(it.title || it.name || '').replace(/<[^>]+>/g, '').slice(0, 50)}`);
  } catch {
    console.log(`   ${name.padEnd(18)} http=${r.status} non-json len=${r.text.length}`);
  }
}

console.log('\n=== D. cover hotlink test ===');
const covers = [
  'https://puui.qpic.cn/vpic_cover/h41002own3j/h41002own3j_hz.jpg/640',
  'https://puui.qpic.cn/vpic_cover/g4102dolw2l/g4102dolw2l_hz.jpg/640',
];
for (const c of covers) {
  for (const ref of ['https://example.com/', 'https://v.qq.com/']) {
    const r = await fetch(c, { headers: { 'User-Agent': UA, Referer: ref } });
    console.log(`   ${r.status} ref=${ref.padEnd(20)} ${c.slice(0, 60)}`);
  }
}
