/**
 * hunt-live-score-api.mjs — 找腾讯赛事页背后的实时比分接口
 *
 * 背景：lpl.qq.com/web201612/data/ 下只有 3 个 .js，其中 LiveBMatchList
 * 停在 02:05（开赛前）发布。腾讯赛事进度页 web202301/event.html 才是
 * 真正的权威比分出口 —— 找出它背后调的是哪个接口，浏览器侧就能直接用。
 *
 * 做法：抓页面 HTML → 抽出所有 URL / script src → 抓 JS bundle → 抽接口路径。
 */
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(url, referer) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: referer || 'https://lpl.qq.com/' },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    // 腾讯部分页面是 GBK
    let text;
    try {
      text = new TextDecoder('utf-8').decode(buf);
    } catch {
      text = buf.toString('latin1');
    }
    return { ok: res.ok, status: res.status, text, headers: res.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const PAGE = 'https://lpl.qq.com/web202301/event.html?tabId=schedule&gameId=246';
console.log('=== 抓赛事进度页 ===');
const page = await get(PAGE);
if (!page.ok) {
  console.log('FAIL', page.status, page.error);
} else {
  console.log('status', page.status, 'len', page.text.length);
  const urls = new Set();
  for (const m of page.text.matchAll(/https?:\/\/[A-Za-z0-9._\-/:?=&%#]{8,180}/g)) urls.add(m[0]);
  console.log('\n--- 页面内 URL ---');
  for (const u of [...urls].slice(0, 40)) console.log('  ', u);
  const srcs = [...page.text.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
  console.log('\n--- script src ---');
  for (const s of srcs.slice(0, 30)) console.log('  ', s);

  // 抓 JS bundle，找接口路径
  console.log('\n=== 抓 JS 找接口路径 ===');
  const interesting = /\/api\/|\.js\?|commact|cgi-bin|getSchedule|getLive|match|Match|score|Score|live/i;
  for (const s of srcs.slice(0, 12)) {
    const abs = s.startsWith('http') ? s : 'https://lpl.qq.com' + (s.startsWith('/') ? s : '/' + s);
    const js = await get(abs);
    if (!js.ok || js.text.length < 500) continue;
    const hits = new Set();
    for (const m of js.text.matchAll(/["'](https?:\\?\/\\?\/[^"'\\ ]{10,160}|[\w\-./]*(?:commact|cgi-bin|\/api\/)[^"'\\ ]{0,120})["']/g)) {
      hits.add(m[1]);
    }
    if (hits.size) {
      console.log('\n  ▸', abs.slice(0, 110), 'len=' + js.text.length);
      for (const h of [...hits].slice(0, 30)) console.log('      ', h);
    }
  }
  fs.writeFileSync('data/tx-event-page.html', page.text, 'utf8');
  console.log('\n页面已存 data/tx-event-page.html');
}
