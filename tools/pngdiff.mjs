/* =====================================================================
 * pngdiff.mjs — 最小 PNG 解码 + 像素级画面分析（零依赖）
 * 用法：
 *   const { decodePng, frameStats } = await import('./pngdiff.mjs');
 *   const a = decodePng(await el.screenshot());
 *   const b = decodePng(await el.screenshot());
 *   frameStats(a, b);
 * ===================================================================== */
import zlib from 'node:zlib';

/** 解码 8bit 非隔行 PNG（支持 灰度/RGB/带alpha）→ {width,height,data:RGBA} */
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];
  let palette = null;

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8bit PNG，实际 ' + bitDepth);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('不支持的颜色类型 ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  // 反过滤（PNG filter 0~4）
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = row[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: val = v;
      }
      cur[x] = val & 0xff;
    }
  }

  // 统一成 RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (colorType === 3) { const idx = out[i] * 3; r = palette[idx]; g = palette[idx + 1]; b = palette[idx + 2]; }
    else if (colorType === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { width, height, data: rgba };
}

/**
 * 画面统计：
 *  - nonBlackRatio：非黑像素占比（画面是不是一片黑）
 *  - diffRatio：两帧之间像素不同的比例（画面是不是在动）
 *  - meanLuma：平均亮度
 */
export function frameStats(a, b) {
  const n = a.width * a.height;
  let nonBlack = 0;
  let luma = 0;
  for (let i = 0; i < n; i++) {
    const r = a.data[i * 4], g = a.data[i * 4 + 1], bl = a.data[i * 4 + 2];
    const l = (r * 299 + g * 587 + bl * 114) / 1000;
    luma += l;
    if (l > 18) nonBlack++;
  }
  let diff = 0;
  let cmp = n;
  if (b && b.width === a.width && b.height === a.height) {
    for (let i = 0; i < n; i++) {
      if (
        Math.abs(a.data[i * 4] - b.data[i * 4]) > 6 ||
        Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) > 6 ||
        Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]) > 6
      ) diff++;
    }
  } else {
    cmp = 0;
  }
  return {
    width: a.width,
    height: a.height,
    nonBlackRatio: nonBlack / n,
    diffRatio: cmp ? diff / cmp : 0,
    meanLuma: luma / n,
  };
}
