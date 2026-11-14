/**
 * debug-parse-lbm.mjs — 查清两件事
 *
 * ① 腾讯 LiveBMatchList 的解析为什么拿不到决赛行？
 *    （浏览器与 Node 都拿到 0 行，但文件里明明有 ScoreA/ScoreB 字段）
 * ② B 站直播弹幕 WebSocket 到底是网络不通，还是握手被拒？
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

console.log('node 版本:', process.version, ' 内置 WebSocket:', typeof globalThis.WebSocket);

console.log('\n########## ① LiveBMatchList 原文与解析 ##########');
const res = await fetch('https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js', {
  headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' },
});
const text = await res.text();
console.log('len =', text.length, ' Last-Modified =', res.headers.get('last-modified'));
console.log('原文尾部 200 字符:', JSON.stringify(text.slice(-200)));
console.log('原文头部 120 字符:', JSON.stringify(text.slice(0, 120)));

// 逐个 msg 值
const m = text.match(/var\s+LiveBMatchList\s*=\s*(\{[\s\S]*?\});?\s*$/);
console.log('\n正则匹配到:', !!m, m ? '长度=' + m[1].length : '');
if (m) {
  try {
    const obj = JSON.parse(m[1]);
    console.log('顶层键:', Object.keys(obj).join(','), ' lastUpTime:', obj.lastUpTime);
    const msg = obj.msg || {};
    const keys = Object.keys(msg);
    console.log('msg 键数:', keys.length, '→', keys.join(','));
    for (const k of keys) {
      const v = msg[k];
      console.log(`  [${k}] 类型=${typeof v} 长度=${(v || '').length} ${v ? JSON.stringify(v).slice(0, 120) : '(空)'}`);
    }
  } catch (e) {
    console.log('JSON.parse 失败:', e.message);
    console.log('片段:', m[1].slice(0, 300));
  }
}

// 另一种切法：截到最后一个 '};'
const idx = text.lastIndexOf('};');
const alt = text.slice(text.indexOf('{'), idx);
try {
  const obj2 = JSON.parse(alt);
  console.log('\n[切法2 lastIndexOf("};")] 顶层键:', Object.keys(obj2).join(','), 'msg 键数:', Object.keys(obj2.msg || {}).length);
} catch (e) {
  console.log('\n[切法2] 解析失败:', e.message);
}

console.log('\n########## ② B 站直播弹幕 WebSocket（Node 直连） ##########');
if (typeof globalThis.WebSocket === 'function') {
  for (const key of ['token=true', '']) {
    await new Promise((resolve) => {
      let count = 0;
      const samples = [];
      const ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
      const timer = setTimeout(() => {
        console.log(`  key="${key}" 超时结束：收到 ${count} 条`);
        try { ws.close(); } catch (e) {}
        resolve();
      }, 15000);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const payload = new TextEncoder().encode(
          JSON.stringify({ uid: 0, roomid: 7734200, protover: 3, platform: 'web', type: 2, key })
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
                const j = JSON.parse(json);
                if (j.cmd && String(j.cmd).startsWith('DANU')) {
                  count++;
                  const info = (j.info || [])[0] || {};
                  if (samples.length < 5) samples.push(String(info.text || '').slice(0, 40));
                }
              } catch (e) {}
            }
            if (len <= 0) break;
            pos += len;
          }
        } catch (e) {}
      };
      ws.onerror = (e) => {
        console.log(`  key="${key}" onerror`, e && e.message ? e.message : '');
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        console.log(`  key="${key}" onclose code=${e.code} reason="${e.reason}" 收到 ${count} 条`);
        resolve();
      };
    });
  }
} else {
  console.log('  Node 无内置 WebSocket');
}
