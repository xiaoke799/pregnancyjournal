/**
 * 历史媒体补齐（启动后后台执行，不阻塞启动）
 *
 * 两件事，都是幂等的：
 *   1. **HEIC → JPEG 转码**：应用早期版本把 HEIC 原样入库，浏览器解不开 ⇒ 照片一直显示不出来。
 *   2. **补缩略图**：早期版本没有缩略图，相册网格直接加载全尺寸原图（12MP 约 3~4MB），
 *      手机上又慢又费流量。这里给还没有缩略图的老照片补上。
 *
 * 每张之间留出间隔（缩略图要同步解码，会短暂占用主线程），单次启动有数量上限，
 * 剩下的下次启动继续 —— 宁可多跑几次，也不要让应用启动后卡几分钟。
 * 全程 try/catch，失败只记日志，绝不影响启动。
 */

const fs = require('fs');
const logger = require('../logger');
const heic = require('./heic');
const imageThumb = require('./image-thumb');

const MAX_HEIC_PER_RUN = 500;
const MAX_THUMBS_PER_RUN = 80;
const HEIC_DELAY_MS = 200;
const THUMB_DELAY_MS = 1000;   // 解码 JPEG 是同步的，间隔大一点，别让应用发木

// 需要回填的表：pathCols 是要改写的路径列；isReport 为 true 时额外更新文件类型字段
const TARGETS = [
  { table: 'pregnancy_photo', select: 'id, file_path, thumbnail_path', pathCols: ['file_path', 'thumbnail_path'] },
  { table: 'checkup_photo', select: 'id, file_path, thumbnail_path', pathCols: ['file_path', 'thumbnail_path'] },
  { table: 'checkup_report', select: 'id, file_path', pathCols: ['file_path'], isReport: true },
];

let _running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function _collectHeicJobs(db) {
  const jobs = [];
  for (const t of TARGETS) {
    let rows = [];
    try {
      rows = db.queryAll(
        `SELECT ${t.select} FROM ${t.table} WHERE file_path LIKE '%.heic' OR file_path LIKE '%.heif'`
      ) || [];
    } catch (e) {
      logger.warn('媒体补齐', `查询 ${t.table} 失败: ${e.message}`);
      continue;
    }
    for (const row of rows) {
      if (row.file_path && fs.existsSync(row.file_path)) jobs.push({ target: t, row });
    }
  }
  return jobs;
}

async function _convertOne(db, job) {
  const { target, row } = job;
  const result = await heic.convertToJpeg(row.file_path);
  if (!result.ok) {
    logger.warn('媒体补齐', `跳过 ${row.file_path}: ${result.error}`);
    return false;
  }
  try {
    const sets = ['file_path = ?'];
    const params = [result.jpegPath];
    // 图片缩略图就是原图（见 photo.js 的 _getThumbnailPath），一并指过去；缩略图稍后单独补
    if (target.pathCols.includes('thumbnail_path') && row.thumbnail_path !== undefined) {
      sets.push('thumbnail_path = ?');
      params.push(result.jpegPath);
    }
    if (target.isReport) {
      sets.push("file_type = 'jpg'", "mime_type = 'image/jpeg'", 'file_size = ?');
      try { params.push(fs.statSync(result.jpegPath).size); } catch (e) { params.push(0); }
    }
    params.push(row.id);
    db.run(`UPDATE ${target.table} SET ${sets.join(', ')} WHERE id = ?`, params);
    return true;
  } catch (e) {
    logger.warn('媒体补齐', `写库失败 ${row.id}: ${e.message}`);
    return false;
  }
}

/** 给还没有缩略图的相册照片补一张（产检照片/报告在前端是全尺寸展示，不需要） */
async function _backfillThumbnails(db) {
  let rows = [];
  try {
    rows = db.queryAll(
      "SELECT id, file_path, thumbnail_path FROM pregnancy_photo WHERE media_type = 'photo'"
    ) || [];
  } catch (e) {
    logger.warn('媒体补齐', `查询相册照片失败: ${e.message}`);
    return { done: 0, failed: 0, left: 0 };
  }
  const jobs = rows.filter((r) => r.file_path
    && fs.existsSync(r.file_path)
    // 没有缩略图、缩略图就是原图、或缩略图文件丢了（例如从「不含缩略图」的备份恢复后）→ 都补一张
    && (!r.thumbnail_path || r.thumbnail_path === r.file_path || !fs.existsSync(r.thumbnail_path))
    && imageThumb.canGenerate(r.file_path));
  if (!jobs.length) return { done: 0, failed: 0, left: 0 };

  let done = 0;
  let failed = 0;
  for (const row of jobs.slice(0, MAX_THUMBS_PER_RUN)) {
    const t = imageThumb.makeThumbnail(row.file_path);
    if (t) {
      try { db.run('UPDATE pregnancy_photo SET thumbnail_path = ? WHERE id = ?', [t, row.id]); done += 1; }
      catch (e) { failed += 1; logger.warn('媒体补齐', `缩略图写库失败 ${row.id}: ${e.message}`); }
    } else {
      failed += 1;
    }
    await sleep(THUMB_DELAY_MS);
  }
  return { done, failed, left: Math.max(0, jobs.length - MAX_THUMBS_PER_RUN) };
}

async function runMediaBackfill(db) {
  if (_running) return;
  _running = true;
  try {
    // 1) HEIC → JPEG
    const heicJobs = await _collectHeicJobs(db);
    if (heicJobs.length) {
      logger.startup(`HEIC 回填: 发现 ${heicJobs.length} 张 HEIC 照片需要转码`);
      let done = 0;
      let failed = 0;
      for (const job of heicJobs.slice(0, MAX_HEIC_PER_RUN)) {
        const ok = await _convertOne(db, job);
        if (ok) done += 1; else failed += 1;
        if (HEIC_DELAY_MS) await sleep(HEIC_DELAY_MS);
      }
      if (done > 0) { try { db.saveDb(); } catch (e) { /* 交给定时落盘 */ } }
      logger.startup(`HEIC 回填: 完成 ${done} 张，失败 ${failed} 张，剩余 ${Math.max(0, heicJobs.length - MAX_HEIC_PER_RUN)} 张`);
    }

    // 2) 补缩略图
    const r = await _backfillThumbnails(db);
    if (r.done || r.failed) {
      try { db.saveDb(); } catch (e) { /* 交给定时落盘 */ }
      logger.startup(`缩略图回填: 完成 ${r.done} 张，失败 ${r.failed} 张，剩余 ${r.left} 张`);
    }
  } catch (e) {
    logger.warn('媒体补齐', `整体跳过（${e.message}）`);
  } finally {
    _running = false;
  }
}

/** 后台启动（不阻塞调用方，不抛异常） */
function startMediaBackfill(db) {
  setImmediate(() => {
    runMediaBackfill(db).catch((e) => logger.warn('媒体补齐', e.message));
  });
}

module.exports = { startMediaBackfill, runMediaBackfill };
