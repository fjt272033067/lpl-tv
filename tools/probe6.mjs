// Probe v6: format-code quality + bilibili region/newlist/live (no search risk-control)
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
const VID = 'g4102dolw2l';

console.log('=== A. format-code matrix ===');
const base = `https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=${VID}`;
for (const [q, tag] of [
  ['', 'default'],
  ['&fc=10217', 'fc=10217(shd)'],
  ['&fc=2', 'fc=2(hd)'],
  ['&format=10217', 'format=10217'],
  ['&defn=shd', 'defn=shd'],
  ['&sname=shd', 'sname=shd'],
  ['&otype=json&charge=0&rurl=1&link2=1&surl=1&hd=4&level=3', 'combo'],
]) {
  try {
    const { text } = await jget(base + q, { Referer: 'https://lpl.qq.com/' });
    const j = pT(text);
    const fl = j.fl?.fi || [];
    const vi = j.vl?.vi?.[0] || {};
    console.log(
      `   ${tag.padEnd(14)} [${fl.map((f) => `${f.name}:${f.resolution}`).join(' ')}] fc=${vi.cl?.fc} vw=${vi.vw} vh=${vi.vh} fn=${String(vi.fn).slice(0, 22)}`
    );
    if (j.ul?.video) console.log(`      ul.video: ${JSON.stringify(j.ul.video).slice(0, 400)}`);
  } catch (e) {
    console.log(`   ${tag} fail ${e.message}`);
  }
}

console.log('\n=== B. hls.v.qq.com via curl ===');
const { execSync } = await import('node:child_process');
for (const u of [
  'https://hls.v.qq.com/',
  'https://vip.hdcdn.qq.com/',
  'https://omex.tc.qq.com/',
]) {
  try {
    const out = execSync(`curl.exe -s -o NUL -w "%{http_code}" --max-time 12 -A "${UA}" "${u}"`, {
      encoding: 'utf8',
    });
    console.log(`   ${u} -> ${out}`);
  } catch (e) {
    console.log(`   ${u} -> ERR`);
  }
}

console.log('\n=== C. bilibili region feeds (rid=171 英雄联盟) ===');
for (const [name, url] of [
  ['dynamic/region', 'https://api.bilibili.com/x/web-interface/dynamic/region?rid=171&ps=30&pn=1'],
  ['newlist', 'https://api.bilibili.com/x/web-interface/newlist?rid=171&pn=1&ps=30'],
  ['popular/series', 'https://api.bilibili.com/x/web-interface/popular/series/one?number=387'],
]) {
  try {
    const { status, text } = await jget(url, { Referer: 'https://www.bilibili.com/' });
    const j = JSON.parse(text);
    console.log(`   ${name.padEnd(16)} http=${status} code=${j.code} msg=${j.message} keys=${Object.keys(j.data || {}).join(',')}`);
    const items = j.data?.archives || j.data?.list || [];
    for (const it of items.slice(0, 5)) {
      const t = (it.title || it.name || '').replace(/<[^>]+>/g, '');
      console.log(`      ${it.bvid} ${it.duration || ''} ${t.slice(0, 50)}`);
    }
  } catch (e) {
    console.log(`   ${name} fail ${e.message}`);
  }
}

console.log('\n=== D. bilibili live list (英雄联盟 area) ===');
try {
  const { status, text } = await jget(
    'https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=1&area_id=3&sort_type=online&page=1&page_size=30',
    { Referer: 'https://live.bilibili.com/' }
  );
  const j = JSON.parse(text);
  console.log(`   http=${status} code=${j.code} msg=${j.message} dataKeys=${Object.keys(j.data || {}).join(',')}`);
  const rooms = j.data?.list || [];
  console.log(`   rooms=${rooms.length}`);
  for (const r of rooms.slice(0, 12))
    console.log(`      room=${r.roomid} uid=${r.uid} ${String(r.title).slice(0, 46)}`);
} catch (e) {
  console.log(`   fail ${e.message}`);
}
