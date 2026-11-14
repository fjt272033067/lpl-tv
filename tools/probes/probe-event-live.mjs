/**
 * probe-event-live.mjs — 从腾讯赛事页 JS 里定位「实时比分」的数据来源
 *
 * event.js 引用了 lpl.qq.com/web202301/live.html?bgid={GameId}&bmid={bMatchId}
 * —— 那是腾讯官方的单场直播页，里面的比分接口才是权威实时源。
 * 同时在 event.js / event-data.js / lib.js 里搜所有 web201612/data 的引用，
 * 看有没有我们还没试过的数据文件。
 */
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/web202301/event.html' },
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const JS = [
  'https://lpl.qq.com/web202301/js/event.js',
  'https://lpl.qq.com/web202301/js/event-data.js',
  'https://lpl.qq.com/web201612/js/lib.js',
  'https://lpl.qq.com/web201612/js/lplMatchConfig.js',
];

console.log('=== 在赛事页 JS 里搜数据文件与接口引用 ===');
for (const u of JS) {
  const r = await get(u);
  if (!r.ok) continue;
  fs.writeFileSync('data/tx-' + u.split('/').pop(), r.text, 'utf8');
  const lines = r.text.split(/[\n;]/);
  const hits = new Set();
  for (const ln of lines) {
    if (/web201612\/data|LIVE_BMATCH|LivingGames|commact|cgi-bin|\/api\/|getMatchScheduleList|getLive|live\.html/i.test(ln)) {
      const trimmed = ln.trim();
      if (trimmed.length > 4 && trimmed.length < 400) hits.add(trimmed);
    }
  }
  console.log('\n▸', u.split('/').pop());
  for (const h of [...hits].slice(0, 20)) console.log('   ', h);
}

console.log('\n=== 腾讯单场直播页 live.html?bgid=246&bmid=13660 ===');
const live = await get('https://lpl.qq.com/web202301/live.html?bgid=246&bmid=13660');
if (!live.ok) {
  console.log('FAIL', live.status, live.error);
} else {
  console.log('status', live.status, 'len', live.text.length);
  const srcs = [...live.text.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
  console.log('script src:');
  for (const s of srcs) console.log('   ', s);
  const hits = new Set();
  for (const m of live.text.matchAll(/web201612\/data\/[A-Za-z0-9_]+\.js/gi)) hits.add(m[0]);
  console.log('页面内数据文件引用:', [...hits].join(', ') || '(无)');
  fs.writeFileSync('data/tx-live-page.html', live.text, 'utf8');

  // 抓这个页面的 JS
  for (const s of srcs) {
    if (!/\.js$/i.test(s)) continue;
    const abs = s.startsWith('http') ? s : 'https://lpl.qq.com' + (s.startsWith('/') ? s : '/' + s);
    const r = await get(abs);
    if (!r.ok || r.text.length < 2000) continue;
    const found = new Set();
    for (const m of r.text.matchAll(/web201612\/data\/[A-Za-z0-9_]+\.js/gi)) found.add(m[0]);
    for (const m of r.text.matchAll(/['"]([^'"\s]*(?:commact|cgi-bin|\/api\/|getLive|getSchedule|liveDetail|gameDetail)[^'"\s]{0,80})['"]/gi)) found.add(m[1]);
    if (found.size) {
      console.log('\n  ▸', abs.split('/').pop(), 'len=' + r.text.length);
      for (const f of found) console.log('      ', f);
      fs.writeFileSync('data/tx-live-' + abs.split('/').pop(), r.text, 'utf8');
    }
  }
}
