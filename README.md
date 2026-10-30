# LPL-TV · 英雄联盟赛事高清直播与录像站

**线上地址：https://4kf9kfxujfhg2.space.mcode.cn**

> 旧地址 `sbf5ebf7vt81f.space.mcode.cn` 已失效：发布平台把该节点标记为安全撤回（`SAFETY_WITHDRAWN`），
> 站点被下线且禁止再部署，已迁移到上面的新地址。

一个面向英雄联盟赛事（LPL / 全球总决赛）自建的观看站。出发点很直接：**腾讯官方 LPL 站的内置播放器清晰度不可调**，
而看比赛真正需要的是——**多档清晰度、倍速、B 站弹幕、直播与录播都能看**。

本项目把这些能力重新做了一遍，并且不依赖任何后端服务，纯静态即可部署。

---

## 能做什么

| 能力 | 实现 | 说明 |
|---|---|---|
| **看直播** | 腾讯 LPL 官方直播 HLS 直连 | 低延迟参数（`liveSyncDurationCount=2`），附带观看人数、赛事阶段 |
| **多档清晰度** | 直播：超清 / 高清 / 标清 三档 HLS 码流；录像：720P / 480P 两档点播 | 直播可在播放中无感切换；录像切档后自动恢复到原进度 |
| **倍速** | 0.5× / 0.75× / 1× / 1.25× / 1.5× / 1.75× / 2× / 3× | 直播与录像均可用 |
| **B 站弹幕** | 录像：构建期烘焙 B 站公开弹幕，逐条对齐播放时间；直播：一键在新标签打开 B 站直播间 | 弹幕可调不透明度 / 字号 / 速度 / 显示区域，可按类型屏蔽 |
| **看录播** | 852 场赛程目录 + **官方最新内容并入主列表**（运行时直连腾讯） | 主列表本身就是最新的，不再另开板块 |
| **赛事进度** | 对齐官方 `event.html?tabId=progress`：轮次分列 + 队徽 + 比分 + 胜负高亮 + 后续轮次 TBD | 队徽运行时从腾讯 `TeamList` 读取（1222 支队伍） |
| **多线路** | 直播播放器内「线路」菜单：腾讯各路 + B 站直播间 | 无信号时可直接切备用源 |
| **移动端** | 响应式布局 + 触控优化 | 两列网格、42px 触控按钮、弹幕字号随屏自适应、对阵图纵向堆叠、无横向溢出 |
| **自动更新** | 运行时「官方最新内容」+ 30 分钟定时增量烘焙 | 新录像立刻可看，弹幕随后补齐 |

### 录播自动更新（两级）

1. **运行时即时** —— 「官方最新内容」**并入录像库主列表顶部**（不再单独开一个板块）。
   数据来自腾讯官方内容接口（`apps.game.qq.com/cmc/zmMcnAuthorContentList`，返回 `var authorid = {...}`，
   可用 `<script>` 跨域加载，天然规避 CORS），带 `sVID` / 封面 / 时长。
   实测主列表首条已到 **2026-10-23**，而烘焙目录里腾讯已发布录像的最新一条是 **10-19** —— 差额就由这一层补上。
2. **定时增量烘焙** —— 每 **30 分钟**跑一次 `bake.mjs`（增量模式：已匹配的比赛直接沿用，只处理新比赛），
   给新录像补上 **B 站弹幕**；脚本末尾输出 `CHANGED=1/0`，只有变化时才重新部署。
   已建定时任务：`LPL-TV 数据刷新（录播/弹幕增量更新）`（cron `*/30 * * * *`，Asia/Shanghai）。

> 为什么要分两级：腾讯的赛程大表（1.3MB）是**裸 JSON** 且不带 CORS，浏览器无法运行时读取，
> 只能靠构建期烘焙；而 B 站弹幕更是必须离线抓（接口对机房 IP 有风控）。

### 赛事进度页（照搬官方）

对齐 `https://lpl.qq.com/web202301/event.html?gameId=246&tabId=progress` 的**赛事进度**视图：

* 顶部赛事下拉选择；
* **轮次分列**（第1~4轮 → 晋级 → 半决赛 → 决赛），每列有轮次名、结果方块与 BO1/BO3 标签；
* 每场一行：`[队徽] 队名缩写 比分 队名缩写 [队徽]`，胜方高亮、负方压暗，未开赛显示 `TBD 0 : 0 TBD`；
* 底部「赛事详情」条：起止日期、系列赛/局数、赛制分布。

数据来自构建期烘焙的 `data/schedule.json`（**1106 条完整赛程，含未开赛与尚未发布录像的比赛**），
所以后续轮次能像官方一样显示为 TBD；录像库用的仍是「已发布录像」的子集。

### 微信内置浏览器

站点对微信 UA 返回 **HTTP 200**，说明**不是服务端拦截**。已做的兼容与提示：
X5 相关 meta（`x5-orientation` / `x5-fullscreen` / `browsermode`）、`aspect-ratio` 不可用时的
`padding-top` 回退（老 X5 内核）、HLS 不支持时给出降级提示、以及检测到 `MicroMessenger` 时
顶部提示「点右上角 ··· 在浏览器中打开」。
**若微信仍直接拦截域名**，那属于微信的外链安全策略（域名未备案/未在微信白名单），
客户端侧无法绕过 —— 这时用系统浏览器打开或点「在浏览器打开」即可。

---

## 关键工程决策：为什么是 JSONP 而不是 fetch

这是整个项目最核心的一点。

站点部署为**纯静态**（`website_deploy` 只发布静态资源），没有服务端可以代理请求。而：

* `api.bilibili.com` / `api.live.bilibili.com` / `vv.video.qq.com` / `lol.sw.game.qq.com` **都不返回
  `Access-Control-Allow-Origin`**，浏览器直接 `fetch` 会被 CORS 拦死；
* 公开的 CORS 代理（allorigins、codetabs、corsproxy.io 等）在实测中大面积不可用或需要 key，**不能作为生产依赖**。

于是改用 **JSONP**——`<script>` 标签加载跨域 JS 不受 CORS 限制。实测确认以下接口都支持 `callback=` 参数：

```
https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList&callback=cb
https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&vid=<vid>&defn=shd&callback=cb
```

而**媒体文件本身**（m3u8 / .ts / .mp4）又不走 CORS 检查：

* 直播 CDN（`*.liveplay.myqcloud.com` → `*.v.smtcdns.net`）会**回显 Origin**，hls.js 可以直接拉流；
* 点播 CDN（`omex.tc.qq.com`）返回 `Access-Control-Allow-Origin: *`。

所以整套方案是：**接口用 JSONP 拿元数据 → 媒体用 hls.js / `<video>` 直连 → 弹幕用构建期烘焙的静态 JSON**，
全程零后端、零外部依赖、零跨域阻塞。

### 清晰度是怎么切出来的

腾讯点播接口 `vv.video.qq.com/getinfo` 会返回可用格式列表：

```json
"fl": { "fi": [ {"name":"hd","resolution":"480P"}, {"name":"shd","resolution":"720P"} ] }
```

默认返回的是 480P；加上 **`&defn=shd`** 才会切到 720P（响应里的 `vw`/`vh` 随之变为 1280×720，
对应文件体积也从 158MB 变成 292MB，确认是真码率切换而非同一份文件）。`defn` 的取值域来自腾讯播放器源码：
`sd / hd / shd / fhd / uhd / hdr10 / dolby`。

播放地址由接口返回的字段拼装：

```
{ ul.ui[0].url } + { vi.fn } + "?vkey=" + { vi.fvkey }
```

`fvkey` 有时效，所以**必须在运行时重新调用 getinfo**——这正是 JSONP 方案存在的意义。

### 直播倍速为什么默认是失效的

hls.js 的 `LiveSyncController`（低延迟直播同步）会**自己写 `media.playbackRate`**。压缩后的源码长这样：

```js
var n = config.lowLatencyMode, a = config.maxLiveSyncPlaybackRate;
if (n && 1 !== a && isLive) {           // ← 门槛就在这个 `1 !== a`
  ... t.playbackRate = Math.min(l, Math.max(1, u));   // 钳在 [1, max]
  else if (t.playbackRate !== 1) t.playbackRate = 1;  // 否则直接复位成 1
}
```

也就是说，只要 `maxLiveSyncPlaybackRate !== 1`，hls.js 每次 `timeupdate` 都会把用户选的倍速改掉
（钳到 [1, 1.6]，或直接复位成 1）。**解法就是把它设成 1**——门槛不成立，hls.js 彻底不碰 `playbackRate`：

```js
new Hls({ liveSyncDurationCount: 2, lowLatencyMode: true, maxLiveSyncPlaybackRate: 1 });
```

另外再加一道 `ratechange` 兜底：任何外部改动都会被还原成用户选的值。
验收脚本对此有专门的回归断言——连续 6 秒采样 `video.playbackRate`，必须始终等于 1.5。

---

## 目录结构

```
lpl-tv/
├─ site/                     ← 可直接部署的静态站（部署根 = site/）
│  ├─ index.html
│  └─ assets/
│     ├─ style.css
│     ├─ app.js              ← 播放器 / 路由 / 视图 / B 站直播弹幕客户端
│     ├─ danmaku.js          ← 弹幕渲染引擎（零依赖）
│     └─ vendor/hls.min.js   ← 本地内置，不引用 CDN
│  └─ data/                  ← 构建期烘焙产物
│     ├─ catalog.json        ← 852 场赛程 + 清晰度/弹幕元信息
│     ├─ liverooms.json      ← B 站直播间映射（直播弹幕用）
│     └─ dm/<cid>.json       ← 每个 cid 一份弹幕，按需加载
└─ tools/
   ├─ bake.mjs               ← 构建期数据烘焙
   ├─ verify.mjs             ← Playwright 端到端验收
   ├─ serve.mjs              ← 本地静态服务器
   └─ probe*.mjs             ← 接口探测脚本（保留作为接口行为记录）
```

---

## 本地运行

```bash
cd lpl-tv
npm run serve
# 打开 http://127.0.0.1:8080
```

跑验收脚本需要 Playwright：

```bash
npm install                 # 安装 devDependency playwright（只用于验收，不影响站点本身）
npm run verify              # 本地验收（18 项）
npm run verify:public       # 线上验收（12 项，针对已部署地址）
npm run rooms               # 刷新 B 站直播间映射（按当前对阵匹配 + 标记开播状态）
```

如果 playwright 装在别处，可以用环境变量指定：`PLAYWRIGHT_PATH=D:\path\to\node_modules`。
`tools/resolve-playwright.mjs` 会依次尝试：本项目 `node_modules` → 上级目录里的其它项目 → 全局 npm root。

## 重新烘焙数据（赛程 / 弹幕 / 直播间）

```bash
node tools/bake.mjs --vods=160        # 160 场比赛的弹幕
node tools/bake.mjs --vods=160 --no-danmaku   # 只刷赛程，跳过弹幕
```

烘焙脚本做的事：

1. 拉腾讯 LPL 公开赛程接口 → 852 条录像目录（含 vid、封面、时长、比分、队伍）；
2. 用 B 站 `search/all/v2` 检索同一场比赛的 BV 号，按 **赛事标签 + 双方战队** 建索引做匹配；
3. 用 `x/player/pagelist` 取分 P 列表——B 站赛事录像常按「第一局 / 第二局」分 P，
   结合腾讯标题尾部的 `_03` 局号精确定位到同一局，取其 `cid`；
4. 拉 `comment.bilibili.com/{cid}.xml` 弹幕（注意响应带 `Content-Encoding: deflate`，需解压），
   解析成 `[时间(秒), 模式, 颜色, 字号, 文本]` 落盘为 `data/dm/{cid}.json`；
   ⚠️ 这个 XML 接口的时间戳单位是**秒**（不是 protobuf `seg.so` 的毫秒），搞错会让弹幕晚 1000 倍出现；
5. 收集 B 站直播间 → `data/liverooms.json`。

补漏用：`npm run repair` —— 扫描目录里「有 cid 但缺弹幕文件」的条目重新抓取；
确实没有弹幕的（多为高光短片）会被标记为 `dmCount:0`，UI 不再误标「有弹幕」。

> 踩坑记录：B 站对数据中心 IP 有 TLS 指纹风控，`curl.exe` 的指纹可以通过而 Node 内置 `fetch` 会被拦
> （返回 412 风控页）；因此脚本统一用 `execFileSync` 调 `curl.exe`（**不能用 `execSync`**——Windows 下
> 会走 cmd.exe，Cookie 里的 `;` 和 URL 里的 `&` 会把命令拆碎）。

## 让数据自动更新（远端数据源 + CI）

赛程、录像目录、B 站直播流地址这三份数据**只能构建期抓**（上游没有跨域头，详见「已知边界」），
所以「数据自动更新」= 必须有一个会自己跑的构建环境。站点侧为此留了一个口子：

**远端数据源**（`site/index.html` 的 `<meta name="lpl-tv-data-base">`）
站点把**本地烘焙快照**和**远端数据源**两份都读回来，取**内容更新**的那份；
远端不可用时自动回退本地快照，站点不会因为外部依赖而打不开。
默认留空 = 只用本地快照（零额外请求，行为与从前完全一致）。

```bash
node tools/set-data-base.mjs https://raw.githubusercontent.com/<owner>/<repo>/main/site/data
# 不带参数 = 关闭远端数据源
```

配好之后：

| 事情 | 谁来做 | 要多久生效 |
|---|---|---|
| 赛程 / 录像 / 直播源数据更新 | CI（`.github/workflows/refresh-data.yml`，每 20 分钟） | 站点轮询，约 5 分钟内 |
| 站点前端改动 | 人工重新部署 `site/` | 立即 |

也就是说**数据日更不需要重新部署站点** —— 这是「赛程像录像一样自动更新」的关键。

### 三份数据文件各管一件事

| 文件 | 内容 | 多久变一次 |
|---|---|---|
| `data/version.json` | 「上次核对上游的时间」+ 每份数据的「内容最后变化时间」 | 每轮都变（几百字节） |
| `data/schedule.json` | 完整赛程（含未开打的对阵） | **只在内容真的变了才变** |
| `data/catalog.json` | 录像目录（B 站源 / 弹幕映射） | 同上 |
| `data/liverooms.json` | 直播间与流地址（B 站地址约 60 分钟过期） | 每轮都变（8KB） |

站点用 `version.json` 判断新鲜度（这就是「赛程快照 8 分钟前」的来源），
并按「内容时间戳」决定取本地还是远端那份、把内容时间戳拼进 URL 当缓存键
（内容没变 → URL 不变 → 命中 CDN 缓存；内容变了 → URL 变 → 必然取到新文件）。

> 为什么 `schedule.json` / `catalog.json` 的 `updatedAt` 要「内容没变就不动」：
> CI 每 20 分钟提交一次，如果时间戳每次都变，这两个文件（390KB + 368KB）
> 每次都会产生全新的大 blob，仓库会以每天十几 MB 的速度膨胀。

### 选哪个 CDN（实测 2026-10-29）

| 托管 | 缓存策略 | 结论 |
|---|---|---|
| `raw.githubusercontent.com` | `Cache-Control: max-age=300` + `ACAO: *` | ✅ 20 分钟一次的数据更新用这个 |
| `cdn.jsdelivr.net` / `fastly.jsdelivr.net` | `s-maxage=43200`（**12 小时** CDN 缓存） | ❌ 分支 URL 下会缓存半天，看起来就像「数据没更新」 |
| `statically.io` | `max-age=0, must-revalidate` + `ACAO: *` | 可用（路径格式待验证） |

> 国内访问 `raw.githubusercontent.com` 可能慢。站点对远端请求有 8 秒超时、
> 拿不到就立刻回退本地快照，不会卡住首屏；也可以改用 `statically.io` 之类
> 境内可达的静态托管，只要响应带 `ACAO: *` 就行。

### 发布流程（改前端时）

站点托管在阿里云 OSS + CDN 上，**资源对象会被缓存约 10 分钟**（响应里 `Age: xxx`）。
不处理的话，刚发完版线上 `/assets/app.js` 仍会返回上一版文件 —— 「改了但用户看不到」，
连线上验收都会拿到旧代码。所以发布前先盖构建戳：

```bash
node tools/stamp-assets.mjs     # 给 app.js / style.css / danmaku.js 的 URL 挂上内容哈希戳
# 然后再部署 site/ 目录
```

戳是内容哈希：资源没变则戳不变（仍然命中 CDN 缓存，不多下载）；变了则 URL 变，
CDN 必然回源取新文件，且 `index.html` 与脚本的戳同源，不会出现「新页面配旧脚本」。

### 启用步骤

**第 1 步：建一个公开仓库**（GitHub 上 New repository，**不要**勾 README/.gitignore/LICENSE，
否则会和本地历史冲突），然后在本地推上去：

```bash
cd <项目目录>/lpl-tv
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

> **为什么推荐 SSH 而不是 HTTPS**：部分网络环境会用本地加速器接管 `github.com`
> （hosts 指向 127.0.0.1），而这类加速器通常**不实现 git 的 smart-HTTP 协议**
> （`/info/refs?service=git-receive-pack` 无响应）→ git 只会报一句极具误导性的
> `Repository not found`（实际是「仓库不存在」和「加速器不认这个协议」完全不同的故障）。
> `ssh.github.com` 不在接管名单里，直连即可。配好 `~/.ssh/config` 就能用：
>
> ```
> Host github.com
>     HostName ssh.github.com
>     User git
>     Port 443
> ```

**第 2 步：启用 Actions**
仓库 → Actions → 左侧 `refresh-data` → 提示「I understand, enable these actions」→ 启用；
再点 `Run workflow` 手动跑一次，确认它能提交 `site/data`（绿色对勾）。

**本仓库实例的实际地址**（照抄即可）：

| 项目 | 值 |
|---|---|
| 仓库 | `https://github.com/fjt272033067/lpl-tv`（Public） |
| 远端数据基址 | `https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data` |
| 站点远端探针 | `https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/version.json` |

> 站点 `site/index.html` 里的 `<meta name="lpl-tv-data-base">` 已经指向上面这个地址；
> **仓库一旦推送上去，站点就会自动开始读远端数据**，不需要重新部署站点。
> 改地址用 `node tools/set-data-base.mjs <新地址>`，改完记得 `node tools/stamp-assets.mjs` 再部署。

### 这个公开仓库里有什么

| 目录 | 内容 | 说明 |
|---|---|---|
| `site/` | 站点代码与资源 | 自写前端；`vendor/` 是 hls.js / flv.js（MIT / BSD） |
| `site/data/` | 赛程、录像目录、直播源 | 腾讯 LPL 公开接口的**事实性数据** + B 站视频的 BV/CID 映射 |
| `site/data/dm/` | 弹幕文本 | B 站用户评论的批量转载 —— 落盘前已做**脱敏**（见下） |
| `site/data/cover/` | 直播画面缩略帧 | 直播画面的截帧 |
| `tools/` | 构建与验收脚本 | 数据烘焙、端到端验收、探针 |

**发布前的风险处理**（`tools/audit-publish.mjs` 可复跑，全量扫描工作树 + **完整 git 历史**）：

- **凭据**：全库与全部提交历史扫描 PAT / 私钥 / Cookie / token —— 0 命中。
- **个人信息**：弹幕里偶尔混进真实联系方式，已在落盘前打码
  （手机号整串替换、邮箱遮用户名、身份证需过校验位、银行卡需过 Luhn 才会处理，
  避免把「666666666666」这类字符画误改）。脱敏规则见 `tools/sanitize-danmaku.mjs`，
  烘焙流水线会自动执行。
- **本地路径**：README 等文档里不出现任何本机绝对路径。
- **仍在的第三方内容**：弹幕评论与直播帧属于第三方作品，公开仓库会让它们可被批量下载
  （站点本来也在公开播放同样的内容）。介意的话把 `site/data/dm/`、`site/data/cover/`
  排除出版本库即可 —— 它们只影响站点部署产物，不影响 CI 刷新赛程/直播源。

**第 3 步：把站点指向这个仓库，并重新部署一次**

```bash
node tools/set-data-base.mjs https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/site/data
node tools/stamp-assets.mjs
# 然后部署 site/ 目录
```

**第 4 步**：之后数据由 CI 自己维护（每 20 分钟），**站点不再需要人工部署**。

> CI 跑在 Ubuntu 上：烘焙脚本里调 curl 的地方已改成按平台取 `curl` / `curl.exe`，
> 否则 B 站侧会全线静默失败（拿不到任何流地址）。
> 另有一条兜底：一个直播间都没抓到时**不覆盖**旧的 `liverooms.json`，
> 站点至少还能给出「官方直播间 ↗」出口。

## 端到端验收

```bash
node tools/verify.mjs          # 本地验收（16 项）
node tools/verify-public.mjs   # 线上验收（10 项，针对已部署地址）
```

用本机 Chrome（Playwright 驱动）真实打开页面，校验直播清晰度菜单、录像卡片、弹幕渲染、
倍速生效（`playbackRate`）、切清晰度后分辨率真实改变（`videoWidth`）、移动端无横向溢出，
截图输出到 `data/ui-smoke/`。

最近一次实测结果（线上 28/28、本地 32/32）：直播 **1920px 超清**在播、清晰度 3 档、
**直播倍速连续 6 秒稳定保持 1.5×**、播放器有**线路切换**菜单（腾讯官方源 + B站直播间）、
无信号时给出可点的「打开B站直播间看弹幕」出口；
录像 **1280×720** 播放、倍速 8 档、单场 6534 条弹幕渲染到画面、清晰度切换 1280px→864px；
**录像库主列表首条已到 2026-10-23**（烘焙目录里腾讯已发布录像的最新一条是 10-19，差额由运行时官方接口补齐）；
赛事进度 **11 个轮次列 / 44 条对阵 / 88 个队徽**；
移动端两列网格、42px 触控按钮、对阵图纵向堆叠、三个页面均无横向溢出；**本站控制台零错误**。

---

## 已知边界

### 直播源的三层架构，以及「60 分钟过期」这件事

站内直播的可用性分三层，**越靠前越不依赖任何外部刷新动作**：

| 层 | 线路 | 数据来源 | 有效期 |
|---|---|---|---|
| 1（主线路） | **腾讯 LPL 官方源** | 运行时 JSONP：`getMatchScheduleList` + 跨域 `var` 文件 `LOL_MATCH2_LIVE_BMATCH_LIST.js` | **永久**（每次打开页面实时取） |
| 2 | B 站赛事直播间 / 二路 / 4K 房间 | 构建期签发流地址（`liverooms.json`） | **约 60 分钟**（B 站签名机制） |
| 3 | 斗鱼 / 虎牙 / B 站官方直播间 | 跳转官方页面 | 永久（平台自己负责） |

**第 1 层是主力**：赛事进行中时腾讯官方源给到 **1920×1080 超清**并带超清/高清/标清三档，
它完全在浏览器里实时获取，不需要任何定时任务或重新部署。
`LOL_MATCH2_LIVE_BMATCH_LIST.js` 是 `var LiveBMatchList = {...}` 形式，可跨域 `<script>` 加载，
休赛时 `msg` 为空字符串，开赛时会给出**当前对应对阵**（`bMatchName`）和**直播锚点**（`Video3`）。

**第 2 层会过期**：B 站流地址的 `sign` 由服务端签发、有效期约 60 分钟，改 URL 参数会 403。
过期后页面的行为是：

* 主线路候选自动排除已过期的源，不会选到黑屏源；
* 命中过期源时**自动切到还活着的线路**（优先腾讯官方源），并提示「已切换到…」；
* 所有站内源都不可用时（休赛期），线路菜单**仍会列出斗鱼 / 虎牙 / B 站官方直播间**，
  提示条变成可点的「打开斗鱼 LPL 官方直播间」出口，而不是一句无解的提示。

所以「不跑定时任务」不会导致站内直播中断，只是第 2 层会少一路机位。

**需要刷新第 2 层时**（想要 B 站机位 + 弹幕入口时）：

```bash
node tools/refresh-liverooms.mjs   # 重新签发流地址 + 抓封面帧（约 40 秒）
# 然后重新部署 site/ 目录
```

`mcode-tools` 只提供 `auth` / `get-asset-url` / `upload-temp-url`，**没有网站部署命令**，
所以部署这一步必须走 Agent 的 `website_deploy` 工具。

### 直播 B 站弹幕：为什么只能走 iframe

B 站的直播弹幕 WebSocket（`wss://broadcastlv.chat.bilibili.com:443/sub`）**握手必须带真实 token**，
而 token 只能从 `xlive/web-room/v1/index/getDanmuInfo` 拿。把这条路走了一遍，结论是**纯静态站在 Chrome 里走不通**：

| 尝试 | 结果 |
|---|---|
| 该接口返回 CORS 头？ | **没有** → 浏览器 `fetch` 直接 "Failed to fetch"（实测） |
| 该接口支持 JSONP？ | 同族接口（`getRoomBaseInfo` / `dM/gethistory`）**支持**（需同时带 `callback=` 和 `jsonp=jsonp`），但风控（-352）发生在 JSONP 包装之前 |
| 用 `<script>` 加载 JSONP？ | **ERR_BLOCKED_BY_ORB** —— B 站的 JSONP 响应是 `Content-Type: application/json`，Chrome 的 ORB（Opaque Response Blocking）不允许它当脚本执行（实测，有头/无头都一样） |
| 换个 Referer / 加 buvid cookie / 带 brotli？ | 都不解决：风控是按 IP 信誉判定的 |

对比一下腾讯的接口就很清楚：它的 JSONP 响应是 `Content-Type: text/html`，Chrome **会**执行，
所以直播源和点播源都能用 JSONP 拿到。**同一个浏览器，腾讯的 JSONP 能用、B 站的不能用** —— 差别就在 MIME 类型。

于是直播弹幕最终落地为 **顶层页面跳转**：

* 直播页的「在新标签打开B站直播间看实时弹幕」按钮 → `live.bilibili.com/<roomid>`，
  **弹幕由 B 站自己实时推送**，不依赖 token、不受 ORB 限制；
* 房间号由 `npm run rooms` 抓取（当前对阵精确匹配 → 同赛事**二路 / 4K 房间**兜底）。
  二路与 4K 房间的标题是赛事级的（不随对局变化），因此精确匹配失效时它们才是稳的选择。

**为什么不能内嵌在本站里**（都是实测结论）：

| 方案 | 实测结果 |
|---|---|
| B 站播放器放进本站 iframe | 任何宽度、任何 `referrerpolicy` 下都 **不发起流请求、不连弹幕 WebSocket**（流请求=0 / 弹幕WS=0）；顶层打开同一个 URL 则正常播放并有真实弹幕 → B 站不允许第三方页面内嵌其直播播放器 |
| 顶层打开 B 站直播间 | ✅ 正常：画面持续变化、页面文本里能直接读到真实弹幕（如「dk怎么跟lpl五号种子一样啊」） |
| 把 B 站弹幕读进本站 DOM | ❌ 前面那条 ORB 链路：token 拿不到，JSONP 被 ORB 拦死 |

所以本站的做法是：**主播放器（腾讯超清源 + 清晰度 + 倍速）留在本站，直播弹幕一键跳到 B 站直播间**；
而**录像弹幕完整叠加在本站播放器上**（那是烘焙的静态数据，100% 可靠）。

同时播放器覆盖层仍保留 WebSocket 通道（**状态如实显示**：只有真正收到弹幕才会显示「B站弹幕已连接」，
否则是「连接中 / 重连中 / 不可用」）。它在不启用 ORB 的浏览器（如 Firefox）或能拿到 token 时可用，
在 Chrome 里会被服务端直接关掉 —— 这属于浏览器平台限制，不是实现问题。

### 其他

* 录像弹幕是构建期烘焙的静态数据，**必定可用**（当前 155 场带弹幕，单场最多 6534 条）。
* 直播清晰度取决于腾讯推流方实际提供的码流档位（当前为 超清 2000k / 高清 1500k / 标清 900k）。
  直播线路数量由腾讯接口决定（当前官方源 + 1 路备用），页面会按实际返回渲染。
* 录像目录与弹幕是构建期快照，新赛事的录像需要重跑 `npm run bake && npm run rooms` 后重新部署。
* 本站不存储、不转存任何视频文件，只做播放器与界面层；视频与弹幕版权归原权利人所有。

---

## 键盘快捷键

| 键 | 作用 |
|---|---|
| `空格` / `K` | 播放 / 暂停 |
| `←` `→` | 快退 / 快进 10 秒 |
| `↑` `↓` | 音量增减 |
| `M` | 静音 |
| `F` | 全屏 |
| `D` | 弹幕开关 |
