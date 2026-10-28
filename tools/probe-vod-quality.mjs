/* 测试腾讯点播各清晰度档位 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const vid = process.argv[2] || 'd4102p8y5qd';

for (const defn of ['fhd', 'shd', 'hd', 'std']) {
  const u =
    `https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&ehost=https://vsports.qq.com&vid=${vid}&defn=${defn}&callback=cbtest`;
  const res = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' } });
  const text = await res.text();
  const m = text.match(/^cbtest\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) {
    console.log(`defn=${defn}  非 JSONP: ${text.slice(0, 90)}`);
    continue;
  }
  let j = null;
  try {
    j = JSON.parse(m[1]);
  } catch (e) {
    console.log(`defn=${defn}  解析失败 ${e.message}`);
    continue;
  }
  const vi = j.vl && j.vl.vi && j.vl.vi[0];
  if (!vi) {
    console.log(`defn=${defn.padEnd(4)} 无 vl.vi（keys=${Object.keys(j).join(',')}）`);
    continue;
  }
  const ui = vi.ul && vi.ul.ui || [];
  const v503 = ui.find((u) => u.vt === 503) || ui[0] || {};
  const url = String(v503.url || '');
  console.log(
    `defn=${defn.padEnd(4)} 分辨率=${(vi.vw || '?') + 'x' + (vi.vh || '?')} 时长=${vi.td}s  ` +
      `url=${url.split('?')[0]}${vi.fn || ''}`
  );
}
