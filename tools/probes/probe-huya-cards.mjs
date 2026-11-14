/**
 * probe-huya-cards.mjs — 虎牙赛事导航卡片的比分是否随比赛更新 + 找 JSON 接口
 *
 * 虎牙官网导航里有结构化对阵卡：<span class="living-msg" title="GEN 0:0 BLG">
 * 如果别的正在进行的比赛卡片带非零比分 → 说明这条链路会实时更新，
 * 决赛的 0:0 只是「还没同步到」，那就是可用的实时比分源。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(label, url, headers = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    console.log(`[OK  ] ${label} ${res.status} len=${text.length} ACAO=${res.headers.get('access-control-allow-origin')}`);
    return { ok: true, status: res.status, text, cors: res.headers.get('access-control-allow-origin') };
  } catch (e) {
    console.log(`[FAIL] ${label} ${e.name}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log('=== 虎牙导航里所有对阵卡片 ===');
const page = await get('huya 660000', 'https://www.huya.com/660000', { Referer: 'https://www.huya.com/' });
if (page.ok) {
  const cards = [...page.text.matchAll(/<span class="living-msg" title="([^"]*)"[^>]*>([\s\S]{0,200}?)<\/span>/g)];
  console.log('卡片数:', cards.length);
  for (const m of cards) {
    const title = m[1];
    const nums = [...m[2].matchAll(/class="team-score">(\d+)</g)].map((x) => x[1]);
    console.log('  ', title.replace(/\s+/g, ' '), '→ 解析到比分', nums.join(':'));
  }
  // 页面里的接口
  const apis = new Set();
  for (const m of page.text.matchAll(/["'](https?:\/\/[^"']*(?:api|json)[^"']{0,90})["']/gi)) apis.add(m[1]);
  console.log('\n页面内 api/json 引用:');
  for (const a of [...apis].slice(0, 25)) console.log('   ', a);
}

console.log('\n=== 虎牙 JSON 接口候选 ===');
for (const [label, url] of [
  ['pc-api root', 'https://pc-api.huya.com/?roomId=660000&do=0'],
  ['pc-api huyaList', 'https://pc-api.huya.com/?roomId=660000&do=huyaList'],
  ['m.huya room', 'https://m.huya.com/api/room/get-info?roomId=660000&tag=1'],
  ['huya api index', 'https://www.huya.com/api/index.php?do=roomInfo&roomId=660000'],
  ['huya match api', 'https://www.huya.com/api/index.php?do=matchList'],
  ['m.huya index', 'https://m.huya.com/api/index.php?do=home&roomId=660000'],
]) {
  const r = await get(label, url, { Referer: 'https://www.huya.com/' });
  if (!r.ok) continue;
  const t = r.text;
  const i = t.search(/GEN|BLG/);
  if (i >= 0) console.log('    ★ 命中:', t.slice(Math.max(0, i - 100), i + 220).replace(/\s+/g, ' '));
  else console.log('    片段:', t.slice(0, 140).replace(/\s+/g, ' '));
}
