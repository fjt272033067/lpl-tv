/**
 * probe-huya-douyu-score.mjs — 虎牙/斗鱼房间标题是否带实时比分
 *
 * 腾讯 JSONP 的 anchorList 里给了官方虎牙房间 platAnchors.huya = 1346609715。
 * 虎牙/斗鱼的直播间标题常带「GEN vs BLG 2:1」这类实时比分，
 * 如果成立就是一个现成的实时比分源（浏览器侧能否跨域读是另一回事，先验证内容）。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(label, url, headers = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, ...headers },
    });
    const cors = res.headers.get('access-control-allow-origin');
    const text = await res.text();
    console.log(`[OK  ] ${label} ${res.status} len=${text.length} ACAO=${cors}`);
    return { ok: true, status: res.status, text, cors };
  } catch (e) {
    console.log(`[FAIL] ${label} ${e.name}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const HUYA_ROOMS = [1346609715, 660000];
const DOUYU_ROOMS = [288016, 664810, 522424];

for (const r of HUYA_ROOMS) {
  for (const [label, url] of [
    ['m.huya get-info', `https://m.huya.com/api/room/get-info?roomId=${r}`],
    ['www.huya api', `https://www.huya.com/api/room/get-info?roomId=${r}`],
    ['huya room page', `https://www.huya.com/${r}`],
  ]) {
    const res = await get(label + ' ' + r, url, { Referer: `https://www.huya.com/${r}` });
    if (!res.ok) continue;
    const t = res.text;
    const i = t.search(/GEN|BLG/i);
    if (i >= 0) console.log('    ★ 命中:', t.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, ' '));
    else console.log('    无 GEN/BLG  片段:', t.slice(0, 160).replace(/\s+/g, ' '));
  }
}

for (const r of DOUYU_ROOMS) {
  for (const [label, url] of [
    ['douyu betard', `https://www.douyu.com/betard/${r}`],
    ['douyu room api', `https://www.douyu.com/roomapi/room/room_info/${r}`],
  ]) {
    const res = await get(label + ' ' + r, url, { Referer: `https://www.douyu.com/${r}` });
    if (!res.ok) continue;
    const t = res.text;
    const i = t.search(/GEN|BLG/i);
    if (i >= 0) console.log('    ★ 命中:', t.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, ' '));
    else console.log('    无 GEN/BLG  片段:', t.slice(0, 160).replace(/\s+/g, ' '));
  }
}
