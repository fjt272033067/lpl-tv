// Probe v9: https CDN variants + bilibili search/live discovery + live WS
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
  });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
function pT(t) {
  const i = t.indexOf('{');
  const k = t.lastIndexOf('}');
  return JSON.parse(t.slice(i, k + 1));
}
const spi = JSON.parse((await jget('https://api.bilibili.com/x/frontend/finger/spi')).text).data;
const ck = `buvid3=${spi.b_3}; buvid4=${spi.b_4}; b_nut=${Math.floor(Date.now() / 1000)}`;

console.log('=== A. HTTPS CDN variants for VOD mp4 ===');
const { text } = await jget(
  'https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=g4102dolw2l&defn=shd',
  { Referer: 'https://lpl.qq.com/' }
);
const j = pT(text);
const vi = j.vl.vi[0];
console.log(`  ul.ui entries:`);
for (const u of vi.ul?.ui || []) console.log(`    vt=${u.vt} ${u.url.slice(0, 90)}`);
const base = vi.ul.ui.find((u) => u.vt === 503)?.url || vi.ul.ui[0].url;
const mp4 = `${base}${vi.fn}?vkey=${vi.fvkey}`;
for (const cand of [mp4, mp4.replace(/^http:/, 'https:')]) {
  try {
    const r = await fetch(cand, {
      method: 'GET',
      headers: { 'User-Agent': UA, Origin: 'https://example.com', Referer: 'https://v.qq.com/', Range: 'bytes=0-65535' },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`   ${r.status} acao=${(r.headers.get('access-control-allow-origin') || 'NONE').padEnd(10)} cr=${r.headers.get('content-range') || '-'} len=${buf.length} ${cand.slice(0, 60)}`);
  } catch (e) {
    console.log(`   ERR ${cand.slice(0, 60)} ${e.message}`);
  }
}
// check if mp4 is actually 720p (probe moov/vp? use ffmpeg if present) - just report size difference
const hd = pT(
  (await jget(
    'https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=g4102dolw2l&defn=hd',
    { Referer: 'https://lpl.qq.com/' }
  )).text
);
const hdUrl = `${(hd.vl.vi[0].ul.ui.find((u) => u.vt === 503)?.url || hd.vl.vi[0].ul.ui[0].url)}${hd.vl.vi[0].fn}?vkey=${hd.vl.vi[0].fvkey}`;
for (const [tag, u] of [
  ['hd', hdUrl],
  ['shd', mp4],
]) {
  const r = await fetch(u, { headers: { 'User-Agent': UA, Range: 'bytes=0-1023' } });
  console.log(`   ${tag} content-length=${r.headers.get('content-length')} range=${r.headers.get('content-range')}`);
}

console.log('\n=== B. bilibili search/all/v2 ===');
for (const kw of ['英雄联盟赛事', 'LPL 全球总决赛']) {
  const r = await jget(`https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(kw)}&page=1`, {
    Cookie: ck,
    Referer: 'https://search.bilibili.com/',
  });
  const sj = JSON.parse(r.text);
  console.log(`  kw="${kw}" code=${sj.code}`);
  for (const res of sj.data?.result || []) {
    console.log(`    [${res.result_type}] n=${res.data?.length}`);
    for (const it of (res.data || []).slice(0, 5)) {
      if (it.bvid)
        console.log(`       ${it.bvid} ${it.duration || ''} ${String(it.title).replace(/<[^>]+>/g, '').slice(0, 44)}`);
      else if (it.roomid)
        console.log(`       room=${it.roomid} uid=${it.uid} ${String(it.title || '').slice(0, 40)}`);
      else if (it.uname) console.log(`       user mid=${it.mid} ${it.uname}`);
    }
  }
}

console.log('\n=== C. live room candidates ===');
for (const rid of [1, 21452525, 7734200, 13169625, 22625025]) {
  const r = await jget(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${rid}`, {
    Referer: 'https://live.bilibili.com/',
  });
  try {
    const j2 = JSON.parse(r.text);
    console.log(`   room=${rid} code=${j2.code} title=${String(j2.data?.title).slice(0, 40)} uid=${j2.data?.uid} live=${j2.data?.live_status}`);
  } catch {
    console.log(`   room=${rid} http=${r.status} non-json`);
  }
}

console.log('\n=== D. bilibili live WS handshake test ===');
for (const rid of [1, 21452525]) {
  try {
    const ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
    const got = [];
    const done = new Promise((res) => {
      const t = setTimeout(() => res('timeout'), 9000);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            uid: 0,
            roomid: rid,
            protover: 3,
            platform: 'web',
            type: 2,
            key: 'token=true',
          })
        );
      };
      ws.onmessage = (e) => {
        const b = Buffer.from(e.data);
        got.push(b.slice(0, 24).toString('hex'));
        if (got.length >= 3) {
          clearTimeout(t);
          ws.close();
          res('ok');
        }
      };
      ws.onerror = () => {
        clearTimeout(t);
        res('error');
      };
    });
    const r = await done;
    console.log(`   room=${rid} -> ${r} packets=${got.length} ${got.slice(0, 2).join(' ')}`);
  } catch (e) {
    console.log(`   room=${rid} ERR ${e.message}`);
  }
}
