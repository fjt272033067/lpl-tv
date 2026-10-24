/* =====================================================================
 * live-rooms.mjs — 各平台赛事直播间的静态配置
 *
 * 为什么是静态的：斗鱼 / 虎牙 / B 站的「流地址」接口都不给
 * Access-Control-Allow-Origin 头，JSONP 又返回 application/json
 * （被 Chrome 的 ORB 拦死），官方播放器也拒绝被第三方页面 iframe 内嵌
 * （实测 iframe 内流请求 = 0）。所以这三个平台在纯静态站里只能
 * 「站内展示 + 跳转官方直播间」，清晰度/音量由平台自己的播放器提供。
 * 房间号本身是稳定的，写成配置即可。
 * ===================================================================== */

/** 已知在播的 B 站赛事直播间（真实 room_id，build 期会补流地址） */
export const BILI_ROOM_IDS = [7734200, 8016907, 613087];

/** 其它平台的赛事直播间（跳转官方直播间） */
export const EXTERNAL_ROOMS = [
  {
    platform: '斗鱼',
    roomid: '288016',
    name: 'LPL 官方主直播间',
    url: 'https://www.douyu.com/288016',
    note: '官方转播 · 支持原画1080P/蓝光多档',
  },
  {
    platform: '斗鱼',
    roomid: '664810',
    name: 'LPL 英文解说流',
    url: 'https://www.douyu.com/664810',
    note: '英文解说',
  },
  {
    platform: '斗鱼',
    roomid: '522424',
    name: 'LPL 4K 超清直播间',
    url: 'https://www.douyu.com/522424',
    note: '4K 超高清',
  },
  {
    platform: '虎牙',
    roomid: '660000',
    name: '英雄联盟赛事主直播间',
    url: 'https://www.huya.com/660000',
    note: '官方转播 · 多机位可选',
  },
  {
    platform: '哔哩哔哩',
    roomid: '6',
    name: '英雄联盟赛事官方直播间',
    url: 'https://live.bilibili.com/6',
    note: '短号 6 · 弹幕最活跃',
  },
];
