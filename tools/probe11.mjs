// Probe v11: bilibili live danmaku WS variants (headers, hosts, paths)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ROOM = 7734200;

console.log('=== A. host reachability ===');
const { execSync } = await import('node:child_process');
for (const h of ['broadcastlv.chat.bilibili.com', 'bcast.chat.bilibili.com', 'danmu1.recv.bilibili.com']) {
  try {
    const out = execSync(`curl.exe -s -o NUL -w "%{http_code}|%{time_total}" --max-time 12 -A "${UA}" "https://${h}/sub"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`   ${h} -> ${out}`);
  } catch (e) {
    console.log(`   ${h} -> ERR ${(e.stderr || '').toString().slice(0, 80)}`);
  }
}

console.log('\n=== B. Node WS variants ===');
async function tryWs(label, url, opts, payload) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url, opts);
    } catch (e) {
      console.log(`   ${label}: construct error ${e.message}`);
      return resolve();
    }
    const packets = [];
    let done = false;
    const fin = (why) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      console.log(`   ${label}: ${why} packets=${packets.length}`);
      for (const p of packets.slice(0, 4)) console.log(`      ${p}`);
      resolve();
    };
    const timer = setTimeout(() => fin('timeout'), 10000);
    ws.onopen = () => {
      ws.send(
        payload ||
          JSON.stringify({ uid: 0, roomid: ROOM, protover: 3, platform: 'web', type: 2, key: 'token=true' })
      );
    };
    ws.onmessage = (ev) => {
      const b = Buffer.from(ev.data);
      const op = b.readUInt32BE(0);
      let d = `op=${op} len=${b.length}`;
      if (op === 8 && b.length >= 16) d += ` auth=${b.readInt32BE(8)}`;
      else if (op === 5 && b.length > 18) d += ` ${b.subarray(16).toString('utf8').slice(0, 110)}`;
      else if (op === 3) d += ` heartbeat`;
      packets.push(d);
      if (packets.length >= 4) {
        clearTimeout(timer);
        fin('ok');
      }
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      fin('error ' + (e.message || e.type || ''));
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      fin(`closed code=${e.code} reason=${e.reason || ''}`);
    };
  });
}

await tryWs('A plain', 'wss://broadcastlv.chat.bilibili.com:443/sub');
await tryWs(
  'B +headers',
  'wss://broadcastlv.chat.bilibili.com:443/sub',
  { headers: { 'User-Agent': UA, Origin: 'https://live.bilibili.com' } }
);
await tryWs('C ?room_id', `wss://broadcastlv.chat.bilibili.com:443/sub?room_id=${ROOM}`);
await tryWs('D bcast host', 'wss://bcast.chat.bilibili.com:443/sub');
await tryWs('E recv host', 'wss://danmu1.recv.bilibili.com:443/sub');
await tryWs(
  'F protover0',
  'wss://broadcastlv.chat.bilibili.com:443/sub',
  { headers: { 'User-Agent': UA } },
  JSON.stringify({ uid: 0, roomid: ROOM, protover: 0, platform: 'web', type: 2, key: 'token=true' })
);
await tryWs(
  'G uid1',
  'wss://broadcastlv.chat.bilibili.com:443/sub',
  { headers: { 'User-Agent': UA } },
  JSON.stringify({ uid: 1, roomid: ROOM, protover: 3, platform: 'web', type: 2, key: 'token=true' })
);
