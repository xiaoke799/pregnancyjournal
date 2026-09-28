/**
 * 文件扩展名 → MIME 类型：**唯一真源**。
 *
 * 【为什么要有这个文件】
 * 这份映射原本在 3 个地方各写了一份，而且已经不一致：
 *   - photo.js 原图接口 33 条（最全）
 *   - photo.js 缩略图接口 17 条（少了 tiff/avi/mkv/flv 等十多项）
 *   - checkup.js   NAS 导入报告 6 条（只认图片和 pdf）
 * 同一个文件走不同接口，返回的 Content-Type 可能不一样。
 * 现在统一到这一处，加新格式只改这里。
 */

const path = require('path');

const MIME_BY_EXT = {
  // ---- 图片 ----
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',

  // ---- 文档 ----
  '.pdf': 'application/pdf',

  // ---- 视频 ----
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.ts': 'video/mp2t',
  '.vob': 'video/dvd',
  '.rm': 'application/vnd.rn-realmedia',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
  '.asf': 'video/x-ms-asf',
};

/**
 * 按扩展名取 MIME 类型。认不出来时返回 null，
 * 由调用方决定兜底值（各接口的兜底不同：图片走 image/jpeg，报告走 octet-stream）。
 */
function mimeOf(filePath) {
  if (!filePath) return null;
  return MIME_BY_EXT[path.extname(String(filePath)).toLowerCase()] || null;
}

module.exports = { MIME_BY_EXT, mimeOf };
