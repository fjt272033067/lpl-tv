/**
 * probe-bili-live-dm.mjs + 腾讯记分牌快照
 *
 * ① 腾讯当前记分牌：LiveBMatchList 与 _246.js 里决赛行的 ScoreA/ScoreB/MatchStatus
 * ② B 站直播弹幕：按官方姿势补 buvid3 cookie 再握手
 *    （B 站 WS 匿名握手会被立刻 1006 关掉，通常是缺 buvid3）
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(url, headers = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, ...headers },
    });
    return { ok: res.ok, status: res.status, text: await res.text(), headers: res.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log('########## ① 腾讯记分牌当前状态 ##########');
for (const [name, url] of [
  ['LIVE_BMATCH_LIST', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js'],
  ['MATCH_LIST_246', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_246.js'],
]) {
  const r = await get(url, { Referer: 'https://lpl.qq.com/' });
  if (!r.ok) {
    console.log(`[miss] ${name}`);
    continue;
  }
  const m = r.text.match(/(\{[\s\S]*\});?\s*$/);
  let obj = null;
  try {
    obj = JSON.parse(m[1]);
  } catch (e) {
    console.log('解析失败', e.message);
  }
  console.log(`\n▸ ${name}  lastUpTime=${obj && obj.lastUpTime}`);
  const msg = obj && obj.msg;
  let rows = [];
  if (Array.isArray(msg)) rows = msg;
  else if (msg && typeof msg === 'object') {
    for (const v of Object.values(msg)) {
      if (Array.isArray(v)) rows.push(...v);
      else if (typeof v === 'string' && v) {
        try {
          const p = JSON.parse(v);
          if (Array.isArray(p)) rows.push(...p);
        } catch (e) {}
      }
    }
  }
  const fin = rows.filter((r) => r && (r.bMatchId === '13660' || (r.GameId === '246' && r.GameProcName === '决赛')));
  console.log('  总行数:', rows.length, ' 决赛行数:', fin.length);
  for (const f of fin) {
    console.log(
      `  ★ ${f.bMatchName} | ${f.GameProcName} | ${f.MatchDate} | ScoreA=${f.ScoreA} ScoreB=${f.ScoreB} MatchStatus=${f.MatchStatus} MatchWin=${f.MatchWin} GameMode=${f.GameModeName}`
    );
  }
  // 顺便看同一赛事里最近的场次状态，判断腾讯是否还在更新这个文件
  const recent = rows
    .filter((r) => r && r.GameId === '246')
    .sort((a, b) => String(a.MatchDate).localeCompare(String(b.MatchDate)))
    .slice(-6);
  console.log('  246 赛事最近 6 场:');
  for (const r of recent) {
    console.log(`     ${r.MatchDate} ${r.GameProcName} ${r.bMatchName} ${r.ScoreA}:${r.ScoreB} status=${r.MatchStatus}`);
  }
}

console.log('\n########## ② B 站弹幕通道 ##########');
const spi = await get('https://api.bilibili.com/x/frontend/finger/spi');
let buvid = '';
if (spi.ok) {
  try {
    const j = JSON.parse(spi.text);
    buvid = (j.data && j.data.b_3) || '';
    console.log('spi code=', j.code, ' b_3=', (buvid || '').slice(0, 24), ' set-cookie=', (spi.headers.get('set-cookie') || '').slice(0, 120));
  } catch (e) {
    console.log('spi 解析失败:', e.message, spi.text.slice(0, 120));
  }
}

const cookie = buvid ? `buvid3=${buvid}; buvid4=${buvid}` : '';
const dm = await get('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=7734200&type=0', {
  Referer: 'https://live.bilibili.com/room/7734200',
  Cookie: cookie,
  Origin: 'https://live.bilibili.com',
});
if (dm.ok) {
  try {
    const j = JSON.parse(dm.text);
    console.log('getDanmuInfo code=', j.code, 'msg=', j.message || '', ' 有token=', !!(j.data && j.data.token));
    if (j.data && j.data.token) {
      const token = j.data.token;
      await new Promise((resolve) => {
        let count = 0;
        const samples = [];
        const ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
        const timer = setTimeout(() => {
          console.log(`  WS 超时：收到 ${count} 条`);
          try { ws.close(); } catch (e) {}
          resolve();
        }, 20000);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          const payload = new TextEncoder().encode(
            JSON.stringify({ uid: 0, roomid: 7734200, protover: 3, platform: 'web', type: 2, key: 'token=' + token })
          );
          const buf = new ArrayBuffer(16 + payload.length);
          const dv = new DataView(buf);
          dv.setUint32(0, 16 + payload.length, true);
          dv.setUint32(4, 16, true);
          dv.setUint32(8, 1, true);
          dv.setUint32(12, 7, true);
          new Uint8Array(buf, 16).set(payload);
          ws.send(buf);
        };
        ws.onmessage = (ev) => {
          try {
            const buf = new Uint8Array(ev.data);
            const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
            let pos = 0;
            while (pos + 16 <= buf.length) {
              const len = dv.getUint32(pos);
              const op = dv.getUint32(pos + 12);
              if (op === 5) {
                const json = new TextDecoder().decode(buf.subarray(pos + 16, pos + len));
                try {
                  const j2 = JSON.parse(json);
                  if (j2.cmd && String(j2.cmd).startsWith('DANU')) {
                    count++;
                    const info = (j2.info || [])[0] || {};
                    if (samples.length < 8) samples.push(String(info.text || '').slice(0, 40));
                  }
                } catch (e) {}
              }
              if (len <= 0) break;
              pos += len;
            }
          } catch (e) {}
        };
        ws.onerror = () => console.log('  WS onerror');
        ws.onclose = (e) => {
          clearTimeout(timer);
          console.log(`  WS onclose code=${e.code} 收到 ${count} 条`);
          if (samples.length) console.log('  样例:', samples.join(' | '));
          resolve();
        };
      });
    }
  } catch (e) {
    console.log('getDanmuInfo 解析失败:', e.message);
  }
} else {
  console.log('getDanmuInfo 失败:', dm.error);
}
