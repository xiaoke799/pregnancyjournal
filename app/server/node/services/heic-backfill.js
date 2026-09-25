/**
 * 历史 HEIC 照片批量转码（启动后后台执行，不阻塞启动）
 *
 * 应用早期版本把 HEIC 原样入库，导致这些照片在浏览器里一直显示不出来。
 * 本模块在每次启动时扫一遍「路径还是 .heic/.heif」的记录，转成 .jpg 并回写数据库，
 * 让历史照片也能正常显示。幂等：转好的记录不再命中查询；转码失败只记日志、保留原状。
 *
 * 放在启动流程的存储迁移之后调用（db.js initDb 内），全部 try/catch，绝不影响启动。
 */

const fs = require('fs');
const logger = require('../logger');
const heic = require('./heic');

const MAX_PER_RUN = 500;   // 单次启动最多处理多少张，避免一次开太久
const DELAY_MS = 200;      // 每张之间让出一点时间，别把 NAS 的 CPU 打满

// 需要回填的表：pathCols 是要改写的路径列；report 为 true 时额外更新文件类型字段
const TARGETS = [
  { table: 'pregnancy_photo', select: 'id, file_path, thumbnail_path', pathCols: ['file_path', 'thumbnail_path'] },
  { table: 'checkup_photo', select: 'id, file_path, thumbnail_path', pathCols: ['file_path', 'thumbnail_path'] },
  { table: 'checkup_report', select: 'id, file_path', pathCols: ['file_path'], isReport: true },
];

let _running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function _collect(db) {
  const jobs = [];
  for (const t of TARGETS) {
    let rows = [];
    try {
      rows = db.queryAll(
        `SELECT ${t.select} FROM ${t.table} WHERE file_path LIKE '%.heic' OR file_path LIKE '%.heif'`
      ) || [];
    } catch (e) {
      logger.warn('HEIC 回填', `查询 ${t.table} 失败: ${e.message}`);
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
    logger.warn('HEIC 回填', `跳过 ${row.file_path}: ${result.error}`);
    return false;
  }

  try {
    const sets = ['file_path = ?'];
    const params = [result.jpegPath];
    // 图片缩略图就是原图（见 photo.js 的 _getThumbnailPath），一并指过去
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
    logger.warn('HEIC 回填', `写库失败 ${row.id}: ${e.message}`);
    return false;
  }
}

async function runHeicBackfill(db) {
  if (_running) return;
  _running = true;
  try {
    const jobs = await _collect(db);
    if (!jobs.length) return;
    logger.startup(`HEIC 回填: 发现 ${jobs.length} 张 HEIC 照片需要转码`);

    let done = 0;
    let failed = 0;
    for (const job of jobs.slice(0, MAX_PER_RUN)) {
      const ok = await _convertOne(db, job);
      if (ok) done += 1; else failed += 1;
      if (DELAY_MS) await sleep(DELAY_MS);
    }
    if (done > 0) {
      try { db.saveDb(); } catch (e) { logger.warn('HEIC 回填', `落盘失败: ${e.message}`); }
    }
    logger.startup(`HEIC 回填: 完成 ${done} 张，失败 ${failed} 张，剩余 ${Math.max(0, jobs.length - MAX_PER_RUN)} 张`);
  } catch (e) {
    logger.warn('HEIC 回填', `整体跳过（${e.message}）`);
  } finally {
    _running = false;
  }
}

/** 后台启动（不阻塞调用方，不抛异常） */
function startHeicBackfill(db) {
  setImmediate(() => {
    runHeicBackfill(db).catch((e) => logger.warn('HEIC 回填', e.message));
  });
}

module.exports = { startHeicBackfill, runHeicBackfill };
