/*!
 * danmaku.js — 弹幕渲染引擎（零依赖）
 * 支持：滚动/顶部/底部/高级弹幕、颜色、字号、透明度、速度、显示区域、关键词屏蔽、轨道分配
 * 数据格式：items = [[timeMs, mode, color, size, text], ...]
 */
(function (global) {
  'use strict';

  const MODE = { SCROLL: 1, TOP: 4, BOTTOM: 5, REVERSE: 6, SPECIAL: 7, CODE: 8 };

  function hexColor(v) {
    if (typeof v !== 'number') return '#ffffff';
    return '#' + (v & 0xffffff).toString(16).padStart(6, '0');
  }

  class DanmakuEngine {
    /**
     * @param {HTMLElement} host 弹幕宿主容器（播放器覆盖层）
     * @param {Object} opts
     */
    constructor(host, opts = {}) {
      this.host = host;
      this.root = document.createElement('div');
      this.root.className = 'dm-canvas';
      this.root.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
      if (host && host.appendChild) host.appendChild(this.root);
      this.opts = Object.assign(
        {
          opacity: 0.92,
          fontSize: 24,
          speed: 1.0, // 1 = 标准速度
          area: 0.5, // 显示区域 0~1
          showScroll: true,
          showTop: true,
          showBottom: true,
          showCode: false,
          blockWords: [],
          maxOnScreen: 400,
        },
        opts
      );

      this.items = [];
      this.cursor = 0;
      this.active = [];
      this.tracks = []; // 每条轨道记录最后一个弹幕的右边界
      this.time = 0;
      this.playing = false;
      this.lastFrame = 0;
      this.pool = [];
      this._raf = null;
      this._onChange = null;
      this.stats = { calls: 0, denied: 0, noText: 0, full: 0, spawned: 0, skipped: 0 };

      this._ro = new ResizeObserver(() => this.layout());
      this._ro.observe(this.root);
      this.layout();
    }

    onChange(cb) {
      this._onChange = cb;
    }

    destroy() {
      this.stop();
      this._ro.disconnect();
    }

    /** 载入弹幕数据 */
    load(items) {
      this.items = (items || []).slice().sort((a, b) => a[0] - b[0]);
      this.reset();
    }

    get count() {
      return this.items.length;
    }

    reset() {
      // ⚠️ 顺序：**先**把 DOM 上的弹幕摘掉，再清 active 数组。
      //
      // 原来的写法是「先 this.active.length = 0，再调 _releaseAll()」，
      // 而 _releaseAll() 是**遍历 this.active** 来 removeChild 的 ——
      // 数组已经被清空了，于是**旧的弹幕元素永远留在画面上**。
      // 它们不在 active 里 → _recycle() 也不会再回收 → 就那样**冻结**在原地，
      // 越积越多、互相重叠，还关不掉。
      // 实测（2026-11-01，线上）：拖一次进度条后，画面上 90 个弹幕元素，
      // 引擎只认 1 个，残留 89 个、重叠 973 对。
      this._releaseAll();
      this.cursor = 0;
      // 注意：不能清空 tracks（轨道数由 layout() 决定），只重置占用状态
      for (let i = 0; i < this.tracks.length; i++) {
        this.tracks[i].right = -1e9;
        this.tracks[i].used = 0;
      }
    }

    /** 跳转到某个时间（秒），只重置游标不重播已过弹幕 */
    seek(sec) {
      let lo = 0;
      let hi = this.items.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.items[mid][0] < sec) lo = mid + 1;
        else hi = mid;
      }
      this.reset();
      this.cursor = lo;
      // 同步时间戳：否则调用方紧接着的 setTime() 会把这次 seek 误判成「跳变」，
      // 又白跑一遍 reset（画面被清两次）。
      this.time = sec;
    }

    /**
     * 设置当前时间（秒）。
     *
     * ⚠️ 必须识别「跳变」：拖进度条 / 快进快退 / 换清晰度（视频重载后
     * currentTime 归零再跳回原位）都会让时间突变。
     * 若不处理，被跳过的那一大段弹幕会在**同一帧**全部生成 ——
     * 它们都从屏幕右侧起步、互相重叠（实测一次拖进度条就堆出 90 条、重叠 973 对）。
     *
     * 跳变时走 seek()：只移动游标、**不补发**被跳过的那一段（真实播放器也是这么做的）。
     *
     * 判定不能只看「时间差 > 固定值」：3 倍速播放 + timeupdate 低频时，
     * 正常播放也会出现 3 秒的时间差 → 会被误判成跳变 → 弹幕被跳过、画面被清空。
     * 所以阈值要跟**墙钟流逝时间**挂钩：时间前进量超过「按流逝时间最多能前进的量」
     * 才算跳变。
     */
    setTime(sec) {
      const t = Number(sec) || 0;
      const now = performance.now();
      const wall = this._lastWall != null ? (now - this._lastWall) / 1000 : 0;
      this._lastWall = now;
      const delta = t - this.time;
      // 4 倍的墙钟余量（覆盖 3 倍速 + timeupdate 低频）+ 1.2 秒固定余量
      if (this.items.length && this.time > 0 && delta > 1.2 + wall * 4) {
        this.seek(t);
      }
      this.time = t;
    }

    play() {
      if (this.playing) return;
      this.playing = true;
      this.lastFrame = performance.now();
      const tick = (now) => {
        if (!this.playing) return;
        const dt = Math.min(120, now - this.lastFrame);
        this.lastFrame = now;
        this.step(dt);
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    stop() {
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    setOption(key, value) {
      this.opts[key] = value;
      if (key === 'fontSize' || key === 'opacity' || key === 'area') this.layout();
    }

    layout() {
      const w = this.root.clientWidth;
      const h = this.root.clientHeight;
      this._w = w;
      this._h = h;
      this._laneH = Math.max(18, this.opts.fontSize * 1.35);
      const n = Math.max(1, Math.floor((h * this.opts.area) / this._laneH) || 1);
      this._trackCount = n;
      // 整体重建，避免 length 扩展产生空洞
      this.tracks = [];
      for (let i = 0; i < n; i++) this.tracks.push({ right: -1e9, used: 0 });
      for (const d of this.active) {
        if (d.el) d.el.style.opacity = this.opts.opacity;
      }
    }

    /** 移动端字号自适应：窄屏整体缩小，但保留用户设置的比例 */
    _fontScale() {
      const w = this._w || 1000;
      if (w < 520) return 0.72;
      if (w < 760) return 0.85;
      return 1;
    }

    _releaseAll() {
      for (const d of this.active) {
        if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
        if (this.pool.length < 300) this.pool.push(d.el);
      }
      this.active.length = 0;
    }

    _acquire() {
      const el = this.pool.pop();
      if (el) return el;
      const n = document.createElement('div');
      n.className = 'dm-item';
      return n;
    }

    _allowed(mode, text) {
      const o = this.opts;
      if (mode === MODE.TOP && !o.showTop) return false;
      if (mode === MODE.BOTTOM && !o.showBottom) return false;
      if (mode === MODE.CODE && !o.showCode) return false;
      if (mode === MODE.SPECIAL && !o.showScroll) return false;
      if (mode !== MODE.TOP && mode !== MODE.BOTTOM && !o.showScroll) return false;
      if (o.blockWords && o.blockWords.length) {
        for (const w of o.blockWords) {
          if (w && text && text.indexOf(w) !== -1) return false;
        }
      }
      return true;
    }

    step(dt) {
      // 推进时间游标（外部通过 setTime 同步视频时间）
      // 单帧生成上限：万一还有漏网的跳变（视频卡顿后恢复、异常 seek），
      // 也不让几百条弹幕在同一帧全挤出来 —— 超出的直接跳过。
      const MAX_PER_FRAME = 20;
      let made = 0;
      while (this.cursor < this.items.length && this.items[this.cursor][0] <= this.time) {
        const it = this.items[this.cursor];
        this.cursor++;
        if (made < MAX_PER_FRAME) {
          this._spawn(it);
          made++;
        } else {
          this.stats.skipped++;
        }
      }
      this._move(dt);
      this._recycle();
    }

    _spawn(item) {
      const [t, mode, color, size, text] = item;
      this.stats.calls++;
      if (!text) {
        this.stats.noText++;
        return;
      }
      if (!this._allowed(mode, text)) {
        this.stats.denied++;
        return;
      }
      if (this.active.length >= this.opts.maxOnScreen) {
        this.stats.full++;
        return;
      }

      const el = this._acquire();
      el.textContent = text;
      el.className = 'dm-item' + (mode === MODE.CODE ? ' dm-code' : '');
      el.style.color = hexColor(color);
      const fs = Math.round(this.opts.fontSize * this._fontScale() * (size >= 25 ? 1.15 : size >= 18 ? 1 : 0.85));
      el.style.fontSize = fs + 'px';
      el.style.opacity = this.opts.opacity;
      el.style.transform = 'translateX(0)';
      el.style.display = 'none';

      const w = this._w || this.root.clientWidth;
      const laneH = this._laneH;
      const trackCount = this._trackCount || 1;

      if (mode === MODE.TOP || mode === MODE.BOTTOM) {
        // 固定弹幕：找一条空闲轨道
        let lane = -1;
        for (let i = 0; i < trackCount; i++) {
          if (this.tracks[i] && this.tracks[i].used === 0) {
            lane = i;
            break;
          }
        }
        if (lane < 0) return; // 无空轨道则丢弃
        if (!this.tracks[lane]) return;
        this.tracks[lane].used = 1;
        const y = mode === MODE.TOP ? lane * laneH + 2 : this._h - (lane + 1) * laneH - 2;
        el.style.left = '50%';
        el.style.top = y + 'px';
        el.style.transform = 'translateX(-50%)';
        el.style.display = 'block';
        this.root.appendChild(el);
        this.active.push({
          el,
          mode,
          lane,
          fixed: true,
          born: performance.now(),
          ttl: 4000,
          text,
        });
        return;
      }

      // 滚动弹幕：轨道分配
      const elW = Math.min(Math.max(w, 200) * 1.2, el.textContent.length * fs * 0.95 + 40);
      const travel = Math.max(200, w) + elW;
      const duration = Math.max(4, travel / (Math.max(200, w) / 2.2) / this.opts.speed) * 1000;
      let lane = -1;
      for (let i = 0; i < trackCount; i++) {
        const tr = this.tracks[i];
        if (!tr) continue;
        if (tr.right <= 0 || tr.right < elW * 0.6 + 20) {
          lane = i;
          break;
        }
      }
      if (lane < 0) {
        // 找占用最小的一条，强制挤入
        let best = -1;
        for (let i = 0; i < trackCount; i++) {
          const tr = this.tracks[i];
          if (!tr) continue;
          if (best < 0 || tr.right < this.tracks[best].right) best = i;
        }
        if (best < 0) return;
        lane = best;
      }
      const tr = this.tracks[lane];
      if (!tr) return;
      const startLeft = w;
      const endLeft = -elW;
      tr.right = startLeft + elW;
      tr.used = 1;

      el.style.top = lane * laneH + 2 + 'px';
      el.style.left = '0px';
      el.style.display = 'block';
      el.style.willChange = 'transform';
      this.root.appendChild(el);
      this.stats.spawned++;
      this.active.push({
        el,
        mode,
        lane,
        fixed: false,
        text,
        w: elW,
        duration,
        born: performance.now(),
        startLeft,
        endLeft,
        x: startLeft,
      });
    }

    _move(dt) {
      const now = performance.now();
      for (const d of this.active) {
        if (d.fixed) {
          if (now - d.born > d.ttl) d.dead = true;
          continue;
        }
        const p = Math.min(1, (now - d.born) / d.duration);
        d.x = d.startLeft + (d.endLeft - d.startLeft) * p;
        d.el.style.transform = 'translateX(' + d.x.toFixed(1) + 'px)';
        if (p >= 1) d.dead = true;
      }
    }

    _recycle() {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const d = this.active[i];
        if (!d.dead) continue;
        if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
        if (this.pool.length < 300) this.pool.push(d.el);
        if (!d.fixed && this.tracks[d.lane]) this.tracks[d.lane].right = -1e9;
        if (d.fixed && this.tracks[d.lane]) this.tracks[d.lane].used = 0;
        this.active.splice(i, 1);
      }
      if (this._onChange) this._onChange(this.active.length);
    }

    /** 实时推送一条弹幕（直播用） */
    push(item) {
      const ms = this.time;
      const it = item.slice();
      it[0] = ms;
      // 直接生成，不受游标影响
      this._spawn(it);
    }
  }

  DanmakuEngine.MODE = MODE;
  DanmakuEngine.hexColor = hexColor;
  global.DanmakuEngine = DanmakuEngine;
})(window);
