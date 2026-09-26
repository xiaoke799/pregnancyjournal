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
const path = require('path');
const logger = require('../logger');
const config = require('../config');
const heic = require('./heic');
const imageThumb = require('./image-thumb');

const MAX_HEIC_PER_RUN = 500;
const MAX_THUMBS_PER_RUN = 80;
const HEIC_DELAY_MS = 200;
const THUMB_DELAY_MS = 1000;   // 解码 JPEG 是同步的，间隔大一点，别让应用发木
const MAX_SCAN_FILES = 20000;  // 路径自愈时最多扫多少个文件

// 需要回填的表：pathCols 是要改写的路径列；isReport 为 true 时额外更新文件类型字段
const TARGETS = [
  { table: 'pregnancy_photo', select: 'id, file_path, thumbnail_path', pathCols: ['file_path', 'thumbnail_path'] },
  { table: 'checkup_photo', select: 'id, file_path, thumbnail_path', pathCols: ['file_path', 'thumbnail_path'] },
  { table: 'checkup_report', select: 'id, file_path', pathCols: ['file_path'], isReport: true },
];

let _running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 递归收集「文件名 → 真实路径」；文件名是 uuid，几乎不会重名 */
function _indexDir(dir, index, budget) {
  if (budget.left <= 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (budget.left <= 0) return;
    const p = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) _indexDir(p, index, budget);
      else if (ent.isFile()) {
        budget.left -= 1;
        if (!index.has(ent.name)) index.set(ent.name, p);
      }
    } catch (e) { /* 单个条目失败不影响整体 */ }
  }
}

/**
 * 路径自愈：记录指向的文件**不存在**时，按文件名在当前照片/媒体目录里找回来并改写记录。
 *
 * 专治 v0.0.27 → v0.0.29 迁移里最可能出现的一类 404：
 * 文件已经被 `cmd/upgrade_init` 搬进持久目录，但数据库里的路径还是**旧安装目录**——
 * 例如迁移标记 `.storage_migrated_v1` 已存在（`storage-migrate.js` 直接 return，不再重写路径），
 * 或用户换过存储卷导致旧路径前缀对不上。
 * 只在「basename 命中 + 目标文件真实存在」时才改；文件名叫 uuid，不会误配。
 */
function healPaths(db) {
  const index = new Map();
  const budget = { left: MAX_SCAN_FILES };
  for (const root of [config.PHOTOS_DIR, config.MEDIA_DIR]) _indexDir(root, index, budget);
  if (!index.size) return { fixed: 0, scanned: 0 };

  let fixed = 0;
  for (const t of TARGETS) {
    let rows = [];
    try { rows = db.queryAll(`SELECT ${t.select} FROM ${t.table}`) || []; } catch (e) { continue; }
    for (const row of rows) {
      const cur = row.file_path;
      if (!cur || fs.existsSync(cur)) continue;          // 路径本来就有效，别动
      const hit = index.get(path.basename(cur));
      if (!hit) continue;
      try {
        db.run(`UPDATE ${t.table} SET file_path = ? WHERE id = ?`, [hit, row.id]);
        if (t.pathCols.includes('thumbnail_path')) {
          // 缩略图先指回原图（等于"没有缩略图"），稍后由缩略图回填生成
          db.run(`UPDATE ${t.table} SET thumbnail_path = ? WHERE id = ?`, [hit, row.id]);
        }
        fixed += 1;
        logger.info('媒体补齐', `路径自愈: ${path.basename(cur)} → ${hit}`);
      } catch (e) { /* 单条失败不影响其它 */ }
    }
  }
  return { fixed, scanned: index.size };
}

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
    // 用「非视频」而不是「= 'photo'」：上传接口在客户端没传 media_type 时会存成 'image'
    // （见 photo.js 的 _detectMediaType），还有老记录可能是 NULL —— 按 'photo' 过滤会漏掉它们。
    rows = db.queryAll(
      "SELECT id, file_path, thumbnail_path FROM pregnancy_photo WHERE media_type IS NULL OR media_type != 'video'"
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
    // 0) 路径自愈（最先做：后面两步都依赖 file_path 能找到文件）
    const h = healPaths(db);
    if (h.fixed > 0) {
      try { db.saveDb(); } catch (e) { /* 交给定时落盘 */ }
      logger.startup(`路径自愈: 修好 ${h.fixed} 条（扫描 ${h.scanned} 个文件）`);
    }

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

module.exports = { startMediaBackfill, runMediaBackfill, healPaths };
