// Probe v3: fixed parse + CORS-on-media test + bilibili
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function parseTencent(text) {
  const i = text.indexOf('{');
  const k = text.lastIndexOf('}');
  return JSON.parse(text.slice(i, k + 1));
}
async function jget(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
  });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
async function corsProbe(url, label) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Origin: 'https://example.com', Referer: 'https://v.qq.com/' },
    });
    const acao = r.headers.get('access-control-allow-origin') || 'NONE';
    const body = r.ok ? (await r.text()).slice(0, 120).replace(/\n/g, '|') : '';
    console.log(`   ${r.status} acao=${acao.padEnd(12)} ${label.padEnd(16)} ${body}`);
    return { r, body };
  } catch (e) {
    console.log(`   ERR ${label}: ${e.message}`);
    return {};
  }
}

console.log('=== A. LIVE HLS CORS (m3u8) ===');
const liveM3u8 = 'https://37055.liveplay.myqcloud.com/live/198183848_3000p.m3u8';
await corsProbe(liveM3u8, 'myqcloud m3u8');
const lr = await fetch(liveM3u8, {
  headers: { 'User-Agent': UA, Origin: 'https://example.com' },
  redirect: 'follow',
});
console.log(`   final=${lr.url} acao=${lr.headers.get('access-control-allow-origin') || 'NONE'}`);
const segTxt = await lr.text();
const segLine = (segTxt.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim();
if (segLine) {
  const segUrl = new URL(segLine, lr.url).href;
  console.log(`   segment=${segUrl.slice(0, 110)}`);
  await corsProbe(segUrl, 'live .ts seg');
}

console.log('\n=== B. VOD getinfo + URL shapes ===');
const base =
  'https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=h41002own3j';
for (const [q, tag] of [
  ['', 'default'],
  ['&level=100031', 'level=100031'],
  ['&level=100019', 'level=100019'],
  ['&fc=10217', 'fc=10217'],
]) {
  const { text } = await jget(base + q, { Referer: 'https://lpl.qq.com/' });
  try {
    const j = parseTencent(text);
    const fl = j.fl?.fi || [];
    const vi = j.vl?.vi?.[0] || {};
    console.log(
      `   ${tag.padEnd(14)} formats=[${fl.map((f) => `${f.name}:${f.resolution}`).join(' ')}] fc=${vi.cl?.fc} vh=${vi.vh} fvkey=${String(vi.fvkey).slice(0, 10)}`
    );
  } catch (e) {
    console.log(`   ${tag} parse fail ${e.message}`);
  }
}

const { text } = await jget(base, { Referer: 'https://lpl.qq.com/' });
const j = parseTencent(text);
const vi = j.vl.vi[0];
const { vid, keyid, fvkey, fn } = vi;
console.log(`\n   vi.vid=${vid} keyid=${keyid}`);
console.log(`   vi.ul.ui[0]=${vi.ul?.ui?.[0]?.url} (vt=${vi.ul?.ui?.[0]?.vt})`);
const cands = [
  [`https://hls.v.qq.com/${vid}/${vi.cl?.keyid ? 'hd' : 'hd'}/${keyid}.m3u8?vkey=${fvkey}`, 'hls fq hd'],
  [`https://hls.v.qq.com/${vid}/shd/${keyid}.m3u8?vkey=${fvkey}`, 'hls fq shd'],
  [`https://hls.v.qq.com/${vid}/${keyid}.m3u8?vkey=${fvkey}`, 'hls bare'],
  [`${vi.ul.ui[0].url}${fn}?vkey=${fvkey}`, 'mp4 cdn'],
];
for (const [u, tag] of cands) await corsProbe(u, tag);
