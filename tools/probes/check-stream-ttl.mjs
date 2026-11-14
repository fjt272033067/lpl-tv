/**
 * 实测 CI 烘焙的 B 站流地址「剩余有效期」。
 *
 * 起因：verify-public.mjs 的「上游直播信号」判据是
 *   r.live && r.stream.url && (!r.stream.expires || r.stream.expires > now)
 * 实测这条判据判定为「上游无信号」，但页面显示「正在直播」——
 * 因为站点判「在播」用的是房间的 live 标志，而判据用的是**流地址是否过期**。
 *
 * 关键问题：**烘焙出来的流地址，拿到手时还剩多久？**
 * 若只剩几分钟 → 一轮 CI 到下一轮 CI 之间，站点的 B 站源大面积失效（可能黑屏）。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const nowSec = Math.floor(Date.now() / 1000);
const iso = (sec) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';

function expOf(url) {
  const m = /[?&]expires=(\d+)/.exec(url || '');
  return m ? Number(m[1]) : null;
}

async function pull(label, url) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' } });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const rooms = j.rooms || [];
    const live = rooms.filter((x) => x.live && x.stream && x.stream.url);
    console.log(`\n=== ${label} ===`);
    console.log(`  updatedAt=${j.updatedAt}  (${iso(Date.parse(j.updatedAt) / 1000)})`);
    console.log(`  现在=${iso(nowSec)}   房间 ${rooms.length} 个，其中 live+有流地址 ${live.length} 个`);
    for (const x of live.slice(0, 8)) {
      const e = expOf(x.stream.url);
      const ttl = e ? e - nowSec : null;
      console.log(
        `   ${String(x.roomid).padEnd(11)} ${String(x.title).slice(0, 26).padEnd(28)} expires=${
          e ? iso(e) : '(无)'
        } 剩余=${ttl === null ? '?' : Math.round(ttl / 60) + ' 分钟'}`
      );
    }
    // 统计：还剩 < 25 分钟的（下一轮 CI 前会失效）
    const soon = live.filter((x) => {
      const e = expOf(x.stream.url);
      return e !== null && e - nowSec < 25 * 60;
    });
    console.log(`  → 剩余有效期 < 25 分钟（下一轮 CI 前就会失效）: ${soon.length}/${live.length} 个`);
    return { updatedAt: j.updatedAt, live: live.length, soon: soon.length, rooms };
  } catch (e) {
    console.log(`\n=== ${label} ===\n  FAIL ${e.message}`);
    return null;
  }
}

console.log(`本机时间 ${iso(nowSec)}`);

// ① 仓库里最新的那份（CI 每 20 分钟提交）
await pull(
  '仓库 origin/main 最新',
  'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/liverooms.json'
);

// ② raw 直连
await pull(
  'raw.gh 直连',
  'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/liverooms.json'
);

// ③ 线上站点实际用的那份（运行时从镜像读）
await pull(
  '线上站点镜像同源',
  'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/liverooms.json'
);

// ④ 站点运行时到底拿到什么？直接读页面的 DataStatus
try {
  const html = await fetch('https://4kf9kfxujfhg2.space.mcode.cn/final.html', {
    headers: { 'Cache-Control': 'no-cache' },
  }).then((r) => r.text());
  console.log('\n=== 线上 final.html ===');
  console.log('  len=', html.length);
} catch (e) {
  console.log('\nfinal.html FAIL', e.message);
}
