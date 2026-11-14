/* =====================================================================
 * live-danmaku.js — B 站直播弹幕 WebSocket 客户端（独立页用）
 *
 * 为什么单独成文件：app.js 里的同名类是**从未被实例化的死代码**，
 * 而跟赛页（final.html）是独立页面、不引 app.js。把协议实现抽成
 * 一个自包含模块，跟赛页直接引它 —— 既不动主播放器逻辑（零回归风险），
 * 又能复用同一套已验证的协议解析。
 *
 * 实测现状（2026-11-15，本机）：getDanmuInfo 握手返回 -352（IP 风控），
 * 匿名握手 WebSocket 会被立刻 1006 关闭 → 实时弹幕通道**当前不可用**。
 * 本模块保留完整实现并**如实上报状态**，让页面能诚实降级而不是假装有数据。
 * ===================================================================== */
(function (global) {
  'use strict';

  let jsonpSeq = 0;
  /** JSONP：跨域取 JSON，无需 CORS 头 */
  function jsonp(url, params, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const cb = '__lpltvdm_' + ++jsonpSeq + '_' + Date.now().toString(36);
      const script = document.createElement('script');
      const merged = Object.assign({}, params, { callback: cb });
      const qs = Object.keys(merged)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(merged[k]))
        .join('&');
      let done = false;
      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try {
          window[cb] = function () {};
          setTimeout(() => { try { delete window[cb]; } catch (e) {} }, 300000);
        } catch (e) {}
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('弹幕握手超时'));
      }, opts.timeout || 8000);
      window[cb] = (data) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('弹幕握手失败（跨域或风控拦截）'));
      };
      script.async = true;
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + qs;
      document.head.appendChild(script);
    });
  }

  class BiliLiveDanmaku {
    constructor(roomId, onMessage, onStatus) {
      this.roomId = roomId;
      this.onMessage = onMessage;
      this.onStatus = onStatus;
      this.ws = null;
      this.closed = false;
      this.retry = 0;
      this.strategy = 0;
      this.received = 0;
      this.token = '';
      this.tokenState = 'unknown';
      this._guard = null;
    }

    async start() {
      if (!this.roomId) return;
      this.onStatus('connecting');
      try {
        const d = await jsonp(
          'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo',
          { id: this.roomId, type: 0, jsonp: 'jsonp' },
          { timeout: 8000 }
        );
        if (d && d.code === 0 && d.data && d.data.token) {
          this.token = d.data.token;
          this.tokenState = 'ok';
        } else {
          this.token = '';
          this.tokenState = 'blocked:' + (d && d.code !== undefined ? d.code : 'unknown');
        }
      } catch (e) {
        this.token = '';
        this.tokenState = 'error';
      }
      if (this.closed) return;
      this.connect();
    }

    static authPacket(obj) {
      const json = JSON.stringify(obj);
      const payload = new TextEncoder().encode(json);
      const buf = new ArrayBuffer(16 + payload.length);
      const dv = new DataView(buf);
      dv.setUint32(0, 16 + payload.length, true);
      dv.setUint32(4, 16, true);
      dv.setUint32(8, 1, true);
      dv.setUint32(12, 7, true);
      new Uint8Array(buf, 16).set(payload);
      return buf;
    }

    connect() {
      if (this.closed) return;
      try {
        this.ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
      } catch (e) {
        this.onStatus('error');
        return;
      }
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.onStatus('open');
        const keys = this.token ? ['token=' + this.token, 'token=' + this.token] : ['token=true', ''];
        const key = keys[this.strategy % keys.length];
        this.ws.send(
          BiliLiveDanmaku.authPacket({
            uid: 0,
            roomid: this.roomId,
            protover: 3,
            platform: 'web',
            type: 2,
            key: key,
          })
        );
      };
      this.ws.onmessage = (ev) => {
        const before = this.received;
        this.handle(ev.data);
        if (this.received > before) {
          clearTimeout(this._guard);
          this._guard = null;
          if (before === 0) {
            this.retry = 0;
            this.onStatus('live');
          }
        }
      };
      this.ws.onerror = () => this.onStatus('error');
      this.ws.onclose = () => {
        this.onStatus('closed');
        if (this.closed) return;
        this.retry++;
        this.strategy++;
        if (this.retry <= 3) setTimeout(() => this.connect(), 1500 * this.retry);
        else this.onStatus('failed');
      };
      this._guard = setTimeout(() => {
        if (this.received === 0 && this.ws && this.ws.readyState === 1) {
          try { this.ws.close(); } catch (e) {}
        }
      }, 12000);
    }

    handle(data) {
      if (typeof data === 'string') {
        try {
          this.handle(new Uint8Array(data.split('').map((c) => c.charCodeAt(0))));
        } catch (e) {}
        return;
      }
      const buf = new Uint8Array(data);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      let pos = 0;
      while (pos + 16 <= buf.length) {
        const len = dv.getUint32(pos);
        const headerLen = dv.getUint32(pos + 4);
        const protoVer = dv.getUint32(pos + 8);
        const op = dv.getUint32(pos + 12);
        if (len < headerLen || pos + len > buf.length) break;
        if (op === 5) {
          let body = buf.subarray(pos + headerLen, pos + len);
          if (protoVer === 1 && body.length > 2 && body[0] === 0x00 && body[1] === 0x00) {
            body = body.subarray(2);
          }
          this.parse(body);
        }
        pos += len;
      }
    }

    static readVarint(b, p) {
      let res = 0;
      let shift = 0;
      while (p < b.length) {
        const c = b[p++];
        res += (c & 0x7f) * Math.pow(2, shift);
        if (!(c & 0x80)) return [res, p];
        shift += 7;
        if (shift > 56) break;
      }
      return [0, p];
    }

    static extractDanmu(b) {
      let best = null;
      const TEXTY = /^[ -~　-〿一-鿿＀-￯\s]+$/;
      const walk = (buf, depth) => {
        if (depth > 5 || !best) return;
        let p = 0;
        const strs = [];
        const nums = {};
        const nested = [];
        while (p < buf.length) {
          const r = BiliLiveDanmaku.readVarint(buf, p);
          p = r[1];
          const fid = Math.floor(r[0] / 8);
          const wire = r[0] % 8;
          if (wire === 2) {
            const l = BiliLiveDanmaku.readVarint(buf, p);
            p = l[1];
            const data = buf.subarray(p, p + l[0]);
            p += l[0];
            let s = '';
            try { s = new TextDecoder('utf-8', { fatal: false }).decode(data); } catch (e) {}
            if (s && s.length <= 300 && TEXTY.test(s) && s.trim().length) strs.push({ fid, s });
            nested.push(data);
          } else if (wire === 0) {
            const v = BiliLiveDanmaku.readVarint(buf, p);
            p = v[1];
            nums[fid] = v[0];
          } else if (wire === 5) {
            p += 4;
          } else if (wire === 1) {
            p += 8;
          } else break;
        }
        const cand = strs.find((x) => x.fid === 7) || strs.find((x) => x.fid === 1);
        if (cand && (nums[3] !== undefined || nums[4] !== undefined || nums[5] !== undefined)) {
          best = { text: cand.s, mode: nums[3] || 1, size: nums[4] || 25, color: nums[5] || 16777215 };
        }
        if (!best) nested.forEach((n) => walk(n, depth + 1));
      };
      walk(b, 0);
      return best;
    }

    parse(body) {
      if (body.length && body[0] === 0x7b) {
        try {
          const j = JSON.parse(new TextDecoder().decode(body));
          if (j.cmd && /DANMU_MSG/.test(j.cmd) && j.info) {
            this.received++;
            this.onMessage({
              text: j.info[1],
              mode: j.info[3] || 1,
              size: j.info[4] || 25,
              color: j.info[5] || 16777215,
              time: j.info[0] ? j.info[0][4] : Date.now(),
            });
          }
        } catch (e) {}
        return;
      }
      const d = BiliLiveDanmaku.extractDanmu(body);
      if (d && d.text) {
        this.received++;
        this.onMessage({ text: d.text, mode: d.mode, size: d.size, color: d.color, time: Date.now() });
      }
    }

    stop() {
      this.closed = true;
      clearTimeout(this._guard);
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
    }
  }

  global.LPLTVLiveDanmaku = BiliLiveDanmaku;
})(window);
