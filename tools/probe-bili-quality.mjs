/* 测试 B 站直播 playUrl 的清晰度上限：不同 platform / qn / accept_quality 组合 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const RID = process.argv[2] || '7734200';

function bilibiliHeaders() {
  return {
    'User-Agent': UA,
    Referer: 'https://live.bilibili.com/',
    Origin: 'https://live.bilibili.com',
  };
}

async function probe(label, qs) {
  const url = `https://api.live.bilibili.com/xlive/web-room/v1/playUrl/playUrl?cid=${RID}&${qs}`;
  try {
    const res = await fetch(url, { headers: bilibiliHeaders() });
    const j = await res.json();
    const d = j.data || {};
    const durl = d.durl || [];
    const suffix = durl.length ? String(durl[0].url || '').match(/_(\d+)\.(flv|m3u8)/) : null;
    console.log(
      `  ${label.padEnd(46)} code=${j.code} qn=${d.current_qn} accept=[${(d.accept_qn || []).join(',')}] durl=${durl.length} suffix=${suffix ? suffix[1] : '-'} accept_qn_desc=${JSON.stringify(d.accept_qn_desc || '').slice(0, 80)}`
    );
    return j;
  } catch (e) {
    console.log(`  ${label.padEnd(46)} ERR ${e.message.slice(0, 60)}`);
    return null;
  }
}

console.log(`=== 房间 ${RID} 的清晰度矩阵 ===`);
await probe('qn=10000 web ptype=8 (当前用法)', 'qn=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8');
await probe('qn=40000', 'qn=40000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8');
await probe('qn=10000 + accept_quality=10000', 'qn=10000&accept_quality=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8');
await probe('qn=10000 + accept_quality=40000', 'qn=10000&accept_quality=40000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8');
await probe('qn=10000 + quality=40000', 'qn=10000&quality=40000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8');
await probe('platform=h5', 'qn=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=h5&ptype=8');
await probe('platform=h5 + accept_quality', 'qn=10000&accept_quality=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=h5&ptype=8');
await probe('platform=web + ptype=8 + protocol=0,1&format=0,1&codec=0', 'qn=10000&protocol=0,1&format=0,1&codec=0&platform=web&ptype=8');
await probe('带 SESSDATA(无效)', 'qn=10000&protocol=0,1&format=0,1,2&codec=0,1&platform=web&ptype=8');
