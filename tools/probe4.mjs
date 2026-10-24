// Probe v4: recent 2026 LPL vids + quality params + hls host reachability
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

console.log('=== A. recent LPL matches from Tencent catalog ===');
const { text: cat } = await jget('https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js');
const m = cat.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
const data = JSON.parse(m[1]);
const list = data.msg || [];
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
console.log(`  with sVID=${withVid.length}`);
const recent = withVid
  .slice(0, 6)
  .map((it) => ({
    date: it.MatchDate,
    game: it.GameName,
    name: it.ext.sName,
    vid: it.ext.sVID,
    dur: it.ext.iTime,
    cover: it.ext.sImg,
    comment: it.ext.iComment,
  }));
for (const r of recent) console.log(`   ${r.date} | ${r.game} | ${r.vid} | ${r.dur}s | ${r.name}`);

// newest by date
const byDate = withVid
  .filter((it) => /2026/.test(it.GameName) || /2026/.test(it.MatchDate))
  .sort((a, b) => (a.MatchDate < b.MatchDate ? 1 : -1));
console.log('\n  -- 2026 entries --');
for (const it of byDate.slice(0, 8))
  console.log(`   ${it.MatchDate} | ${it.GameName} | ${it.ext.sVID} | ${it.ext.sName}`);
const vid2026 = byDate[0]?.ext.sVID;
const cover2026 = byDate[0]?.ext.sImg;
const name2026 = byDate[0]?.ext.sName;
console.log(`\n  pick vid=${vid2026} name=${name2026}`);

console.log('\n=== B. getinfo formats for 2026 vid ===');
if (vid2026) {
  for (const [q, tag] of [
    ['', 'default'],
    ['&level=100031', 'level=100031'],
    ['&level=100019', 'level=100019'],
    ['&level=100003', 'level=100003'],
    ['&level=100001', 'level=100001'],
    ['&fc=10212', 'fc=10212'],
    ['&platform=11001', 'platform=11001'],
    ['&otype=xml', 'otype=xml'],
  ]) {
    const { text } = await jget(
      `https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https%3A%2F%2Fvsports.qq.com%2F&vid=${vid2026}${q}`,
      { Referer: 'https://lpl.qq.com/' }
    );
    try {
      const j = parseTencent(text);
      const fl = j.fl?.fi || [];
      const vi = j.vl?.vi?.[0] || {};
      console.log(
        `   ${tag.padEnd(16)} [${fl.map((f) => `${f.name}:${f.resolution}`).join(' ')}] fc=${vi.cl?.fc} vh=${vi.vh} fn=${String(vi.fn).slice(0, 24)}`
      );
    } catch (e) {
      console.log(`   ${tag.padEnd(16)} parse fail ${e.message} :: ${text.slice(0, 70)}`);
    }
  }
}

console.log('\n=== C. hls.v.qq.com reachability ===');
for (const h of ['hls.v.qq.com', 'vip.hdcdn.qq.com', 'omex.tc.qq.com', '37055.liveplay.myqcloud.com']) {
  try {
    const dns = await import('node:dns/promises');
    const a = await dns.resolve4(h);
    console.log(`   ${h} -> ${a.slice(0, 2).join(',')}`);
  } catch (e) {
    console.log(`   ${h} -> DNS FAIL ${e.code || e.message}`);
  }
}

console.log('\n=== D. superplayer.js getinfo params ===');
const sp = await jget('https://vm.gtimg.cn/thumbplayer/superplayer/superplayer.js');
console.log(`  len=${sp.text.length}`);
const idx = [...sp.text.matchAll(/getinfo/g)].map((m) => m.index);
console.log(`  getinfo occurrences=${idx.length}`);
for (const i of idx.slice(0, 6)) {
  console.log(`   ...${sp.text.slice(Math.max(0, i - 200), i + 200).replace(/\s+/g, ' ')}...`);
}
