/**
 * 相册缩略图生成（纯 JS，不依赖 ffmpeg / sharp）
 *
 * 【为什么需要】
 * 相册网格此前**没有缩略图** —— `_getThumbnailPath()` 对图片直接返回原路径，
 * 于是网格里每张都加载全尺寸原图（12MP 约 3~4MB）。一屏 20 张就是几十 MB，
 * 手机流量和打开速度都不划算。这里在上传时顺带生成一张 640px 的长边缩略图。
 *
 * 【能力边界】
 * 纯 JS 只能解 JPEG / PNG：
 *   - JPEG：jpeg-js（**含 EXIF 方向处理**，否则手机竖拍照片的缩略图会躺倒）
 *   - PNG ：pngjs
 *   - 其它：HEIC 已在上传时转成 JPEG ✓；WebP / GIF / BMP / AVIF 解不了 → 返回 null，
 *          调用方保持 thumbnail_path = 原文件（与以前行为一致，不会更差）
 *
 * 【内存】12MP JPEG 解码约 48MB RGBA，转完立刻释放引用；超过 30MB 的输入直接跳过。
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const MAX_SIDE = 640;
const QUALITY = 72;                        // jpeg-js 用 0-100
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const THUMB_SUFFIX = '_thumb';

let _jpeg = null;
let _png = null;
let _loadError = null;

function _load() {
  if (_jpeg || _loadError) return _jpeg;
  try {
    _jpeg = require('jpeg-js');
    _png = require('pngjs').PNG;
  } catch (e) {
    _loadError = e.message;
    logger.warn('缩略图', `解码库加载失败，将跳过缩略图生成: ${e.message}`);
  }
  return _jpeg;
}

/** 该文件能否生成缩略图（仅 JPEG / PNG） */
function canGenerate(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
}

/** `xxx.jpg` → `xxx_thumb.jpg` */
function thumbPathFor(filePath) {
  return String(filePath).replace(/\.[^.\\/]+$/, '') + THUMB_SUFFIX + '.jpg';
}

/**
 * 从 JPEG 的 EXIF 里读方向（1-8），读不到返回 1。
 * ⚠️ 两个坑：
 *   1) jpeg-js 给的 exifBuffer 是 **Uint8Array**（不是 Buffer），没有 readUInt16LE，必须用 DataView；
 *   2) 它前面多一个 0x00（从 'Exif\0' 的第 5 字节起切），所以 TIFF 头通常在偏移 1 —— 两种偏移都兼容。
 */
function _readOrientation(exifBuffer) {
  try {
    if (!exifBuffer || exifBuffer.length < 14) return 1;
    const off = exifBuffer[0] === 0x00 ? 1 : 0;
    const le = exifBuffer[off] === 0x49 && exifBuffer[off + 1] === 0x49;
    const be = exifBuffer[off] === 0x4d && exifBuffer[off + 1] === 0x4d;
    if (!le && !be) return 1;
    const dv = new DataView(exifBuffer.buffer, exifBuffer.byteOffset, exifBuffer.byteLength);
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    if (u16(off + 2) !== 0x002a) return 1;
    const ifd0 = off + u32(off + 4);
    if (ifd0 + 2 > exifBuffer.length) return 1;
    const count = u16(ifd0);
    for (let i = 0; i < count && i < 64; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (entry + 12 > exifBuffer.length) break;
      if (u16(entry) === 0x0112) {
        const v = u16(entry + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
  } catch (e) { /* 读不到就按 1 处理 */ }
  return 1;
}

/** 面积平均缩放（每个目标像素取源块均值），复杂度 O(源像素数) */
function _downscale(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.allocUnsafe(dstW * dstH * 4);
  const xr = srcW / dstW;
  const yr = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * yr);
    let sy1 = Math.floor((dy + 1) * yr);
    if (sy1 <= sy0) sy1 = sy0 + 1;
    if (sy1 > srcH) sy1 = srcH;
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * xr);
      let sx1 = Math.floor((dx + 1) * xr);
      if (sx1 <= sx0) sx1 = sx0 + 1;
      if (sx1 > srcW) sx1 = srcW;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = sy0; y < sy1; y++) {
        let idx = (y * srcW + sx0) * 4;
        for (let x = sx0; x < sx1; x++, idx += 4) {
          r += src[idx]; g += src[idx + 1]; b += src[idx + 2]; n++;
        }
      }
      const o = (dy * dstW + dx) * 4;
      out[o] = (r / n) | 0;
      out[o + 1] = (g / n) | 0;
      out[o + 2] = (b / n) | 0;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 按 EXIF 方向把（已缩小的）位图摆正；方向 5-8 会交换宽高 */
function _applyOrientation(src, w, h, o) {
  if (o <= 1 || o > 8) return { data: src, width: w, height: h };
  const swap = o >= 5;
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  const out = Buffer.allocUnsafe(dw * dh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx, dy;
      switch (o) {
        case 2: dx = w - 1 - x; dy = y; break;                 // 水平镜像
        case 3: dx = w - 1 - x; dy = h - 1 - y; break;         // 180°
        case 4: dx = x;         dy = h - 1 - y; break;         // 垂直镜像
        case 5: dx = y;         dy = x; break;                 // 转置
        case 6: dx = h - 1 - y; dy = x; break;                 // 顺时针 90°
        case 7: dx = h - 1 - y; dy = w - 1 - x; break;         // 逆转置
        case 8: dx = y;         dy = w - 1 - x; break;         // 逆时针 90°
        default: dx = x; dy = y;
      }
      const si = (y * w + x) * 4;
      const di = (dy * dw + dx) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return { data: out, width: dw, height: dh };
}

/**
 * 生成缩略图，返回缩略图路径；不支持 / 失败返回 null（调用方按"没有缩略图"处理）。
 */
function makeThumbnail(srcPath, { maxSide = MAX_SIDE, quality = QUALITY } = {}) {
  const jpegLib = _load();
  if (!jpegLib || !canGenerate(srcPath)) return null;
  try {
    const stat = fs.statSync(srcPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_BYTES) return null;

    const buf = fs.readFileSync(srcPath);
    const ext = path.extname(srcPath).toLowerCase();
    let rgba, w, h, orientation = 1;
    if (ext === '.png') {
      const png = _png.sync.read(buf);
      rgba = png.data; w = png.width; h = png.height;
    } else {
      const decoded = jpegLib.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
      rgba = decoded.data; w = decoded.width; h = decoded.height;
      orientation = _readOrientation(decoded.exifBuffer);
    }
    if (!rgba || !w || !h) return null;

    const scale = Math.min(1, maxSide / Math.max(w, h));
    let small = rgba;
    let sw = w;
    let sh = h;
    if (scale < 1) {
      sw = Math.max(1, Math.round(w * scale));
      sh = Math.max(1, Math.round(h * scale));
      small = _downscale(rgba, w, h, sw, sh);
      rgba = null;                                   // 让大图尽早可回收
    }
    if (orientation > 1) {
      const r = _applyOrientation(small, sw, sh, orientation);
      small = r.data; sw = r.width; sh = r.height;
    }

    const out = jpegLib.encode({ data: small, width: sw, height: sh }, quality).data;
    const dest = thumbPathFor(srcPath);
    fs.writeFileSync(dest, out);
    logger.debug('缩略图', `生成 ${path.basename(dest)} (${sw}x${sh}, ${(out.length / 1024) | 0}KB)`);
    return dest;
  } catch (e) {
    logger.warn('缩略图', `生成失败(${path.basename(String(srcPath))}): ${e.message}`);
    return null;
  }
}

module.exports = { makeThumbnail, canGenerate, thumbPathFor, MAX_SIDE };
