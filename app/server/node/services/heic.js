/**
 * HEIC / HEIF → JPEG 转码（纯 JS + WASM，x86 / ARM 通用，无需本地编译）
 *
 * 【为什么需要】
 * 浏览器（Chrome / Edge / Firefox）都**不能**解码 HEIC，而 iPhone（以及部分安卓开启
 * 「高效图片格式」后）拍出来的就是 HEIC。此前应用只按扩展名放行上传，文件能存也能取
 * （接口 200），但前端 <img> 渲染不出来 —— 用户看到的是相册里一张占位图、点开空白，
 * 而且**服务端日志里没有任何报错**，极难发现。
 *
 * 【策略】
 * 上传时把 HEIC 转成**同目录同名的 .jpg** 作为「显示用文件」，**原图保留不删**。
 * 数据库 file_path / thumbnail_path 指向 .jpg；删除记录时连带清理同名原图。
 * 转码失败绝不阻断上传：保留 HEIC 原样入库，由前端提示「该格式无法预览」。
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const HEIC_EXTS = ['.heic', '.heif'];
// 同名原图可能出现的大小写变体（Linux 区分大小写）
const ORIGINAL_VARIANTS = ['.heic', '.HEIC', '.Heic', '.heif', '.HEIF', '.Heif'];

let _convert = null;
let _loadError = null;

function _load() {
  if (_convert || _loadError) return _convert;
  try {
    _convert = require('heic-convert');
  } catch (e) {
    _loadError = e.message;
    logger.warn('HEIC', `转码组件加载失败，将跳过 HEIC 转码: ${e.message}`);
  }
  return _convert;
}

/** 是否支持直接交给浏览器显示的格式（HEIC/HEIF 需要先转码） */
function isHeicFile(filePath) {
  if (!filePath) return false;
  return HEIC_EXTS.includes(path.extname(String(filePath)).toLowerCase());
}

/** `xxx.heic` → `xxx.jpg`（保留同目录同名） */
function displayPathFor(filePath) {
  return String(filePath).replace(/\.[^.\\/]+$/, '') + '.jpg';
}

/** 找出 `<base>.heic/.heif` 等同名原图（删除记录时一并清理） */
function siblingOriginals(filePath) {
  if (!filePath) return [];
  const base = String(filePath).replace(/\.[^.\\/]+$/, '');
  const found = [];
  for (const ext of ORIGINAL_VARIANTS) {
    const p = base + ext;
    if (p === filePath) continue;
    if (fs.existsSync(p)) found.push(p);
  }
  return found;
}

/**
 * 把 HEIC 转成同名 .jpg（原图保留）。
 * 已存在同名 jpg 时直接复用（幂等，重复调用不会重复转码）。
 * @returns {Promise<{ok: boolean, jpegPath?: string, cached?: boolean, error?: string}>}
 */
async function convertToJpeg(srcPath, { quality = 0.9 } = {}) {
  if (!isHeicFile(srcPath)) return { ok: false, error: '不是 HEIC 文件' };
  if (!fs.existsSync(srcPath)) return { ok: false, error: '源文件不存在' };

  const destPath = displayPathFor(srcPath);
  if (fs.existsSync(destPath)) return { ok: true, jpegPath: destPath, cached: true };

  const convert = _load();
  if (!convert) return { ok: false, error: _loadError || '转码组件不可用' };

  try {
    const buffer = await convert({ buffer: fs.readFileSync(srcPath), format: 'JPEG', quality });
    if (!buffer || !buffer.length) throw new Error('转码结果为空');
    fs.writeFileSync(destPath, buffer);
    return { ok: true, jpegPath: destPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { isHeicFile, convertToJpeg, displayPathFor, siblingOriginals };
