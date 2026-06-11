const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const log = require('../logger');
const PDFDocument = require('pdfkit');

// 简单认证中间件（fnOS CGI已通过header传递用户信息）
function verifyAuth(req, res, next) {
  // 在fnOS环境中，CGI代理已处理认证，这里直接放行
  next();
}

const ALL_TABLES = [
  'pregnancy', 'prenatal_checkup', 'custom_checkup', 'checkup_photo',
  'checkup_report', 'lab_result', 'daily_record', 'contraction_session',
  'contraction', 'pregnancy_photo', 'diary_entry', 'checklist',
  'checklist_item', 'reminder', 'fetal_movement_session', 'fetal_movement',
  'habit_checkin', 'supplement_checkin', 'app_config',
];

function readTable(table) {
  try { return db.queryAll(`SELECT * FROM ${table}`); } catch { return []; }
}

function writeTable(table, rows) {
  if (!rows || rows.length === 0) return 0;
  let count = 0;
  for (const row of rows) {
    const keys = Object.keys(row);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
    try { db.run(sql, keys.map(k => row[k])); count++; } catch (e) { log.warn('导入', `${table} 行导入失败`, { error: e.message }); }
  }
  return count;
}

function copyFile(src, destDir) {
  try {
    if (!src || !fs.existsSync(src)) return null;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const fileName = path.basename(src);
    const dest = path.join(destDir, fileName);
    if (src !== dest) fs.copyFileSync(src, dest);
    return dest;
  } catch { return null; }
}

function copyDirFiles(srcDir, destDir) {
  let count = 0;
  try {
    if (!fs.existsSync(srcDir)) return 0;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    for (const f of files) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (fs.statSync(src).isFile()) { fs.copyFileSync(src, dest); count++; }
    }
  } catch {}
  return count;
}

function copyDirContentsRecursive(srcBase, destBase) {
  let count = 0;
  try {
    if (!fs.existsSync(srcBase)) return 0;
    const items = fs.readdirSync(srcBase, { withFileTypes: true });
    for (const item of items) {
      const srcPath = path.join(srcBase, item.name);
      const destPath = path.join(destBase, item.name);
      if (item.isFile()) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        count++;
      } else if (item.isDirectory()) {
        count += copyDirContentsRecursive(srcPath, destPath);
      }
    }
  } catch {}
  return count;
}

function prepareInsertStatement(table, sampleRow) {
  if (!sampleRow) return { sql: '', params: () => [] };
  const keys = Object.keys(sampleRow);
  const placeholders = keys.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
  return {
    sql,
    params: (row) => keys.map(k => row[k]),
  };
}

router.post('/export/full', async (req, res) => {
  try {
    log.api('导出', '全量JSON导出开始');
    const exportData = { version: '1.0.0', exported_at: new Date().toISOString(), tables: {} };
    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }
    exportData.stats = {};
    for (const [k, v] of Object.entries(exportData.tables)) {
      exportData.stats[k] = v.length;
    }
    const photos = readTable('pregnancy_photo');
    exportData.photos = photos.filter(p => p.file_path && fs.existsSync(p.file_path)).map(p => p.file_path);
    log.api('导出', `全量导出完成`, { tables: Object.keys(exportData.stats).length, totalRows: Object.values(exportData.stats).reduce((a, b) => a + b, 0) });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pregnancyjournal-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ code: 0, data: exportData, message: 'success' });
  } catch (error) {
    log.error('导出', '全量导出失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/with-photos', async (req, res) => {
  try {
    log.api('导出', '全量+原图导出开始');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const exportDir = path.join(config.DATA_DIR || '.', 'backups', `export_${timestamp}`);
    const photosDir = path.join(exportDir, 'photos');
    const mediaDir = path.join(exportDir, 'media');
    fs.mkdirSync(exportDir, { recursive: true });

    const exportData = { version: '1.0.0', exported_at: new Date().toISOString(), tables: {}, includes_photos: true };
    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }

    let photoCount = 0;
    const allPhotos = readTable('pregnancy_photo');
    for (const p of allPhotos) {
      if (p.file_path && fs.existsSync(p.file_path)) {
        const sub = p.media_type === 'video' ? mediaDir : photosDir;
        if (copyFile(p.file_path, sub)) photoCount++;
      }
      if (p.thumbnail_path && fs.existsSync(p.thumbnail_path)) {
        copyFile(p.thumbnail_path, photosDir);
      }
    }

    const checkupPhotos = readTable('checkup_photo');
    const reportsDir = path.join(exportDir, 'checkup_reports');
    for (const cp of checkupPhotos) {
      if (cp.file_path && fs.existsSync(cp.file_path)) copyFile(cp.file_path, reportsDir);
      if (cp.thumbnail_path && fs.existsSync(cp.thumbnail_path)) copyFile(cp.thumbnail_path, reportsDir);
    }

    const checkupReports = readTable('checkup_report');
    for (const cr of checkupReports) {
      if (cr.file_path && fs.existsSync(cr.file_path)) copyFile(cr.file_path, reportsDir);
    }

    fs.writeFileSync(path.join(exportDir, 'data.json'), JSON.stringify(exportData, null, 2));

    log.api('导出', `全量+原图导出完成`, { photos: photoCount, dir: exportDir });
    res.json({
      code: 0,
      data: {
        export_dir: exportDir,
        data_file: path.join(exportDir, 'data.json'),
        photos_dir: photosDir,
        total_photos: photoCount,
        created_at: new Date().toISOString(),
      },
      message: `导出完成: ${photoCount} 张照片`
    });
  } catch (error) {
    log.error('导出', '全量+原图导出失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/export/download-dir', (req, res) => {
  try {
    const exportDir = req.query.dir;
    if (!exportDir || !fs.existsSync(exportDir)) {
      return res.json({ code: 1001, data: null, message: '导出目录不存在' });
    }
    const resolved = path.resolve(exportDir);
    const backupsRoot = path.resolve(config.DATA_DIR || '.', 'backups');
    if (!resolved.startsWith(backupsRoot)) {
      return res.json({ code: 1001, data: null, message: '不允许访问该目录' });
    }
    const files = [];
    const walk = (dir, prefix = '') => {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) { walk(fp, path.join(prefix, f)); }
        else { files.push({ name: path.join(prefix, f), size: stat.size }); }
      }
    };
    walk(resolved);
    res.json({ code: 0, data: { dir: resolved, files, total: files.length }, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/import-json', async (req, res) => {
  try {
    const importData = req.body;
    if (!importData || !importData.tables) {
      return res.json({ code: 1001, data: null, message: '无效的导入数据' });
    }
    log.api('导入', 'JSON导入开始', { version: importData.version });

    let totalRows = 0;
    const results = {};
    for (const [table, rows] of Object.entries(importData.tables)) {
      if (ALL_TABLES.includes(table) && Array.isArray(rows)) {
        const count = writeTable(table, rows);
        results[table] = count;
        totalRows += count;
      }
    }
    db.saveDb();
    log.api('导入', `JSON导入完成`, { totalRows, tables: Object.keys(results).length });
    res.json({ code: 0, data: { imported: true, total_rows: totalRows, results }, message: `导入完成: ${totalRows} 条记录` });
  } catch (error) {
    log.error('导入', 'JSON导入失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/import-dir', async (req, res) => {
  try {
    const importDir = req.query.dir || req.body.dir;
    if (!importDir || !fs.existsSync(importDir)) {
      return res.json({ code: 1001, data: null, message: '导入目录不存在' });
    }
    log.api('导入', '目录导入开始', { dir: importDir });

    const dataFile = path.join(importDir, 'data.json');
    if (!fs.existsSync(dataFile)) {
      return res.json({ code: 1001, data: null, message: '目录中没有 data.json 文件' });
    }
    const importData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    let totalRows = 0;
    const results = {};
    for (const [table, rows] of Object.entries(importData.tables || {})) {
      if (ALL_TABLES.includes(table) && Array.isArray(rows)) {
        const count = writeTable(table, rows);
        results[table] = count;
        totalRows += count;
      }
    }

    let photoCount = 0;
    const photosDir = path.join(importDir, 'photos');
    if (fs.existsSync(photosDir)) {
      const destPhotos = config.PHOTOS_DIR;
      photoCount += copyDirFiles(photosDir, destPhotos);
    }
    const mediaDir = path.join(importDir, 'media');
    if (fs.existsSync(mediaDir)) {
      const destMedia = config.MEDIA_DIR;
      photoCount += copyDirFiles(mediaDir, destMedia);
    }
    const reportsDir = path.join(importDir, 'checkup_reports');
    if (fs.existsSync(reportsDir)) {
      const destReports = path.join(config.PHOTOS_DIR, 'checkup_reports');
      photoCount += copyDirFiles(reportsDir, destReports);
    }

    db.saveDb();
    log.api('导入', `目录导入完成`, { totalRows, photos: photoCount });
    res.json({ code: 0, data: { imported: true, total_rows: totalRows, photos: photoCount, results }, message: `导入完成: ${totalRows} 条记录, ${photoCount} 张照片` });
  } catch (error) {
    log.error('导入', '目录导入失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/category', async (req, res) => {
  try {
    const { category, pregnancy_id } = req.body || {};
    if (!category) {
      return res.json({ code: 1001, data: null, message: '缺少 category 参数' });
    }

    const exportData = { version: '1.0.0', category, exported_at: new Date().toISOString(), tables: {} };

    switch (category) {
      case 'daily_records':
        exportData.tables.daily_record = db.queryAll('SELECT * FROM daily_record' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'diary':
        exportData.tables.diary_entry = db.queryAll('SELECT * FROM diary_entry' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'checkups':
        exportData.tables.prenatal_checkup = db.queryAll('SELECT * FROM prenatal_checkup' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.custom_checkup = db.queryAll('SELECT * FROM custom_checkup' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.checkup_photo = readTable('checkup_photo');
        exportData.tables.checkup_report = readTable('checkup_report');
        exportData.tables.lab_result = readTable('lab_result');
        break;
      case 'checklists':
        const clIds = db.queryAll('SELECT id FROM checklist' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []).map(r => r.id);
        exportData.tables.checklist = clIds.map(id => db.queryOne('SELECT * FROM checklist WHERE id = ?', [id])).filter(Boolean);
        exportData.tables.checklist_item = [];
        for (const cid of clIds) {
          const items = db.queryAll('SELECT * FROM checklist_item WHERE checklist_id = ?', [cid]);
          exportData.tables.checklist_item.push(...items);
        }
        break;
      case 'contractions':
        exportData.tables.contraction_session = db.queryAll('SELECT * FROM contraction_session' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.contraction = readTable('contraction');
        break;
      case 'fetal_movements':
        exportData.tables.fetal_movement_session = db.queryAll('SELECT * FROM fetal_movement_session' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.fetal_movement = readTable('fetal_movement');
        break;
      case 'photos':
        exportData.tables.pregnancy_photo = db.queryAll('SELECT * FROM pregnancy_photo' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'reminders':
        exportData.tables.reminder = db.queryAll('SELECT * FROM reminder' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'habits':
        exportData.tables.habit_checkin = db.queryAll('SELECT * FROM habit_checkin' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.supplement_checkin = db.queryAll('SELECT * FROM supplement_checkin' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      default:
        return res.json({ code: 1001, data: null, message: `未知分类: ${category}` });
    }

    for (const [k, v] of Object.entries(exportData.tables)) {
      exportData.tables[k] = v;
    }

    log.api('导出', `分类导出: ${category}`);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pregnancy-${category}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ code: 0, data: exportData, message: 'success' });
  } catch (error) {
    log.error('导出', '分类导出失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/backup-db', async (req, res) => {
  try {
    const dbPath = config.DATABASE_PATH;
    if (!fs.existsSync(dbPath)) {
      return res.json({ code: 1001, data: null, message: '数据库文件不存在' });
    }
    const backupsDir = path.join(config.DATA_DIR || '.', 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupsDir, `backup_${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    const size = fs.statSync(backupPath).size;
    log.api('备份', `数据库备份完成`, { path: backupPath, size });
    res.json({ code: 0, data: { backup_path: backupPath, size, created_at: new Date().toISOString() }, message: '备份成功' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/restore-db', async (req, res) => {
  try {
    const backupPath = req.body.backup_path || req.query.backup_path;
    if (!backupPath || !fs.existsSync(backupPath)) {
      return res.json({ code: 1001, data: null, message: '备份文件不存在' });
    }
    const dbPath = config.DATABASE_PATH;
    const backupsDir = path.join(config.DATA_DIR || '.', 'backups');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const preRestore = path.join(backupsDir, `pre_restore_${timestamp}.db`);
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, preRestore);

    fs.copyFileSync(backupPath, dbPath);
    log.api('恢复', `数据库恢复完成`, { from: backupPath });
    res.json({ code: 0, data: { restored: true, pre_restore_backup: preRestore }, message: '恢复成功，重启后生效' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/export/backups', async (req, res) => {
  try {
    const backupsDir = path.join(config.DATA_DIR || '.', 'backups');
    if (!fs.existsSync(backupsDir)) return res.json({ code: 0, data: [], message: 'success' });
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const fp = path.join(backupsDir, f);
        const stat = fs.statSync(fp);
        return { name: f, path: fp, size: stat.size, created_at: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json({ code: 0, data: files, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/backup', async (req, res) => {
  try {
    const { dir } = req.body || {};
    const backupDir = dir ? path.resolve(dir) : path.join(config.DATA_DIR || '.', 'backups', `backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    fs.mkdirSync(backupDir, { recursive: true });

    log.api('备份', '全量备份开始', { dir: backupDir });

    const exportData = {
      version: '2.1.0',
      exported_at: new Date().toISOString(),
      app_name: 'pregnancyjournal',
      tables: {},
      file_manifest: { total: 0, by_type: {} },
      // 文件路径映射表：旧绝对路径 -> 备份中的相对路径（用于跨机器恢复时重写数据库路径）
      _file_map: { album: {}, checkup_photos: {}, checkup_reports: {}, config: {} },
    };

    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }

    // ====== 工具函数：复制文件到备份目录，只用文件名 ======
    function copyToBackup(srcPath, subDir) {
      if (!srcPath || !fs.existsSync(srcPath)) return null;
      const fileName = path.basename(srcPath);
      const dest = path.join(backupDir, 'files', subDir, fileName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        if (srcPath !== dest) fs.copyFileSync(srcPath, dest);
        return fileName;
      } catch { return null; }
    }
    function trackCount(type, n) {
      exportData.file_manifest.total += n;
      if (!exportData.file_manifest.by_type[type]) exportData.file_manifest.by_type[type] = 0;
      exportData.file_manifest.by_type[type] += n;
    }

    let count = 0;

    // ====== 1. 相册照片 → files/album/<filename> ======
    const allPhotos = readTable('pregnancy_photo');
    for (const p of allPhotos) {
      if (p.file_path && fs.existsSync(p.file_path)) {
        const fn = copyToBackup(p.file_path, 'album');
        if (fn) { exportData._file_map.album[p.file_path] = fn; count++; }
      }
      if (p.thumbnail_path && p.thumbnail_path !== p.file_path && fs.existsSync(p.thumbnail_path)) {
        const fn = copyToBackup(p.thumbnail_path, 'album');
        if (fn) { exportData._file_map.album[p.thumbnail_path] = `thumb_${fn}`; count++; }
      }
    }
    trackCount('album', count); count = 0;

    // ====== 2. 产检照片 → files/checkup_photos/<filename> ======
    const checkupPhotos = readTable('checkup_photo');
    for (const cp of checkupPhotos) {
      if (cp.file_path && fs.existsSync(cp.file_path)) {
        const fn = copyToBackup(cp.file_path, 'checkup_photos');
        if (fn) { exportData._file_map.checkup_photos[cp.file_path] = fn; count++; }
      }
      if (cp.thumbnail_path && cp.thumbnail_path !== cp.file_path && fs.existsSync(cp.thumbnail_path)) {
        const fn = copyToBackup(cp.thumbnail_path, 'checkup_photos');
        if (fn) { exportData._file_map.checkup_photos[cp.thumbnail_path] = `thumb_${fn}`; count++; }
      }
    }
    trackCount('checkup_photos', count); count = 0;

    // ====== 3. 检查报告文件 → files/checkup_reports/<filename> ======
    const checkupReports = readTable('checkup_report');
    for (const cr of checkupReports) {
      if (cr.file_path && fs.existsSync(cr.file_path)) {
        const fn = copyToBackup(cr.file_path, 'checkup_reports');
        if (fn) { exportData._file_map.checkup_reports[cr.file_path] = fn; count++; }
      }
    }
    trackCount('checkup_reports', count);

    // ====== 4. 配置文件 → files/config/ （确保跨机器迁移完整） ======
    const configSources = [
      { name: 'wecom.json', srcPath: path.join(__dirname, '..', 'data', 'wecom.json') },
      { name: 'checkup_schedule.json', srcPath: path.join(__dirname, '..', 'data', 'checkup_schedule.json') },
      { name: 'recipes.json', srcPath: path.join(__dirname, '..', 'data', 'recipes.json') },
      { name: 'food_safety_v3.json', srcPath: path.join(__dirname, '..', 'data', 'food_safety_v3.json') },
    ];
    let configCount = 0;
    for (const cf of configSources) {
      if (fs.existsSync(cf.srcPath)) {
        const fn = copyToBackup(cf.srcPath, 'config');
        if (fn) { exportData._file_map.config[cf.name] = fn; configCount++; }
      }
    }
    trackCount('config', configCount);

    fs.writeFileSync(path.join(backupDir, 'data.json'), JSON.stringify(exportData, null, 2));

    let totalRows = 0;
    const stats = {};
    for (const [k, v] of Object.entries(exportData.tables)) {
      stats[k] = v.length;
      totalRows += v.length;
    }

    log.api('备份', '全量备份完成', { dir: backupDir, rows: totalRows, files: exportData.file_manifest.total });
    res.json({
      code: 0,
      data: {
        dir: backupDir,
        total_rows: totalRows,
        files: exportData.file_manifest,
        stats,
        created_at: new Date().toISOString()
      },
      message: `备份完成: ${totalRows} 条记录, ${exportData.file_manifest.total} 个文件`
    });
  } catch (error) {
    log.error('备份', '全量备份失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/restore', async (req, res) => {
  try {
    const { dir } = req.body || {};
    if (!dir) return res.json({ code: 1001, data: null, message: '请指定恢复目录路径' });
    const restoreDir = path.resolve(dir);
    if (!fs.existsSync(restoreDir)) return res.json({ code: 1001, data: null, message: '目录不存在: ' + restoreDir });

    const dataFile = path.join(restoreDir, 'data.json');
    if (!fs.existsSync(dataFile)) return res.json({ code: 1001, data: null, message: '目录中没有 data.json 文件' });

    log.api('恢复', '全量恢复开始', { dir: restoreDir });
    let importData;
    try {
      importData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } catch (parseErr) {
      return res.json({ code: 1001, data: null, message: '备份文件格式错误或已损坏: ' + parseErr.message });
    }
    if (!importData || !importData.tables || typeof importData.tables !== 'object') {
      return res.json({ code: 1001, data: null, message: '备份文件数据结构无效，缺少 tables 字段' });
    }

    // ====== 1. 导入数据库表数据 ======
    let totalRows = 0;
    const results = {};
    for (const [table, rows] of Object.entries(importData.tables || {})) {
      if (ALL_TABLES.includes(table) && Array.isArray(rows)) {
        const count = writeTable(table, rows);
        results[table] = count;
        totalRows += count;
      }
    }

    // ====== 2. 获取路径映射表（跨机器迁移核心） ======
    const fileMap = importData._file_map || { album: {}, checkup_photos: {}, checkup_reports: {}, config: {} };

    // ====== 3. 重写数据库中的绝对路径 → 本机路径 ======
    function rewriteTablePaths(table, pathColumn, mapObj, newBaseDir) {
      const rows = db.queryAll(`SELECT id, ${pathColumn} FROM ${table}`);
      for (const row of rows) {
        const oldPath = row[pathColumn];
        if (oldPath && mapObj[oldPath]) {
          const newPath = path.join(newBaseDir, mapObj[oldPath]);
          db.run(`UPDATE ${table} SET ${pathColumn} = ? WHERE id = ?`, [newPath, row.id]);
        }
      }
    }
    // 相册照片：file_path + thumbnail_path
    rewriteTablePaths('pregnancy_photo', 'file_path', fileMap.album, config.PHOTOS_DIR);
    rewriteTablePaths('pregnancy_photo', 'thumbnail_path', fileMap.album, config.PHOTOS_DIR);
    // 视频（media_type=video 的文件应放到 MEDIA_DIR）
    const photoRows = db.queryAll('SELECT id, file_path, media_type FROM pregnancy_photo WHERE media_type = \'video\'');
    for (const r of photoRows) {
      if (r.file_path && fileMap.album[r.file_path]) {
        const newPath = path.join(config.MEDIA_DIR, fileMap.album[r.file_path]);
        db.run('UPDATE pregnancy_photo SET file_path = ? WHERE id = ?', [newPath, r.id]);
      }
    }
    // 产检照片
    rewriteTablePaths('checkup_photo', 'file_path', fileMap.checkup_photos, config.PHOTOS_DIR);
    rewriteTablePaths('checkup_photo', 'thumbnail_path', fileMap.checkup_photos, config.PHOTOS_DIR);
    // 检查报告
    rewriteTablePaths('checkup_report', 'file_path', fileMap.checkup_reports, config.PHOTOS_DIR);

    // ====== 4. 复制文件到本机对应目录 ======
    let fileCount = 0;

    // 4a. 相册照片 files/album/ → PHOTOS_DIR
    const srcAlbumDir = path.join(restoreDir, 'files', 'album');
    if (fs.existsSync(srcAlbumDir)) {
      fileCount += copyDirFiles(srcAlbumDir, config.PHOTOS_DIR);
    }

    // 4b. 产检照片 files/checkup_photos/ → PHOTOS_DIR
    const srcCkPhotoDir = path.join(restoreDir, 'files', 'checkup_photos');
    if (fs.existsSync(srcCkPhotoDir)) {
      fileCount += copyDirFiles(srcCkPhotoDir, config.PHOTOS_DIR);
    }

    // 4c. 检查报告 files/checkup_reports/ → PHOTOS_DIR/checkup_reports/
    const srcReportDir = path.join(restoreDir, 'files', 'checkup_reports');
    if (fs.existsSync(srcReportDir)) {
      const destReportDir = path.join(config.PHOTOS_DIR, 'checkup_reports');
      fileCount += copyDirFiles(srcReportDir, destReportDir);
    }

    // 4d. 配置文件 files/config/ → 应用 data/ 目录（覆盖目标机器的默认配置）
    const srcConfigDir = path.join(restoreDir, 'files', 'config');
    if (fs.existsSync(srcConfigDir)) {
      const destDataDir = path.join(__dirname, '..', 'data');
      fileCount += copyDirFiles(srcConfigDir, destDataDir);
    }

    // 4e. 兼容旧版备份结构（files/ 直接递归复制）
    const legacyFilesDir = path.join(restoreDir, 'files');
    if (fs.existsSync(legacyFilesDir) && !importData._file_map) {
      // 只有在没有 _file_map 时才走旧逻辑（说明是旧版备份）
      fileCount += copyDirContentsRecursive(legacyFilesDir, config.PHOTOS_DIR);
    }

    // 4f. 兼容更旧的 photos/media/checkup_reports 目录
    const legacyPhotosDir = path.join(restoreDir, 'photos');
    if (fs.existsSync(legacyPhotosDir)) fileCount += copyDirFiles(legacyPhotosDir, config.PHOTOS_DIR);
    const legacyMediaDir = path.join(restoreDir, 'media');
    if (fs.existsSync(legacyMediaDir)) fileCount += copyDirFiles(legacyMediaDir, config.MEDIA_DIR);
    const legacyReportsDir = path.join(restoreDir, 'checkup_reports');
    if (fs.existsSync(legacyReportsDir)) fileCount += copyDirFiles(legacyReportsDir, path.join(config.PHOTOS_DIR, 'checkups'));

    db.saveDb();
    log.api('恢复', '全量恢复完成', { rows: totalRows, files: fileCount });
    res.json({
      code: 0,
      data: { total_rows: totalRows, files: fileCount, results },
      message: `恢复完成: ${totalRows} 条记录, ${fileCount} 个文件`
    });
  } catch (error) {
    log.error('恢复', '全量恢复失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

const CSV_FIELDS = [
  { key: 'record_date', label: '日期' },
  { key: 'weight', label: '体重(kg)' },
  { key: 'blood_pressure_systolic', label: '收缩压' },
  { key: 'blood_pressure_diastolic', label: '舒张压' },
  { key: 'blood_glucose_fasting', label: '空腹血糖' },
  { key: 'blood_glucose_1h', label: '餐后1h血糖' },
  { key: 'blood_glucose_2h', label: '餐后2h血糖' },
  { key: 'body_temperature', label: '体温(℃)' },
  { key: 'fetal_heart_rate', label: '胎心率(bpm)' },
  { key: 'hcg_value', label: 'HCG' },
  { key: 'uric_acid', label: '尿酸(μmol/L)' },
  { key: 'sleep_hours', label: '睡眠时长(h)' },
  { key: 'sleep_quality', label: '睡眠质量' },
  { key: 'water_intake', label: '饮水量(ml)' },
  { key: 'exercise_type', label: '运动类型' },
  { key: 'exercise_duration', label: '运动时长(min)' },
  { key: 'fetal_movement_count', label: '胎动次数' },
  { key: 'fetal_movement_duration', label: '胎动时长(min)' },
  { key: 'contraction_count', label: '宫缩次数' },
  { key: 'mood', label: '心情(1-5)' },
  { key: 'mood_note', label: '心情备注' },
  { key: 'symptoms', label: '症状' },
  { key: 'diet_note', label: '饮食备注' },
  { key: 'medication', label: '用药记录' },
  { key: 'supplement_record', label: '营养补充' },
  { key: 'intimacy_note', label: '爱爱记录' },
  { key: 'stool_record', label: '排便情况' },
  { key: 'note', label: '日记/备注' },
  { key: 'stool', label: '排便' },
  { key: 'edema_level', label: '水肿等级' },
  { key: 'vaginal_discharge', label: '分泌物' },
  { key: 'skin_condition', label: '皮肤状况' },
  { key: 'urination_frequency', label: '尿频' },
  { key: 'hcg_weeks', label: 'HCG孕周' },
  { key: 'uric_acid_period', label: '尿酸周期' },
  { key: 'plan_text', label: '今日计划' },
  { key: 'plan_date', label: '计划日期' },
  { key: 'habit_text', label: '习惯打卡' },
  { key: 'contraction_interval', label: '宫缩间隔(分)' },
  { key: 'contraction_duration', label: '宫缩持续(分)' },
  { key: 'contraction_pain', label: '宫缩疼痛感' },
  { key: 'contraction_record', label: '宫缩详细记录' },
  { key: 'fetal_movement_record', label: '胎动详细记录' },
  { key: 'sleep_record', label: '睡眠记录' },
  { key: 'diet_record', label: '饮食记录' },
  { key: 'exercise_record', label: '运动记录' },
  { key: 'intimacy_record', label: '爱爱详情' },
];

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

router.get('/export/csv', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    let sql = 'SELECT * FROM daily_record WHERE 1=1';
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    if (dateFrom) { sql += ' AND record_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND record_date <= ?'; params.push(dateTo); }
    sql += ' ORDER BY record_date ASC';

    const stmt = db.getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    if (rows.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的记录数据' });
    }

    const header = CSV_FIELDS.map(f => f.label).join(',');
    const csvLines = [header];
    for (const row of rows) {
      csvLines.push(CSV_FIELDS.map(f => escapeCsv(row[f.key])).join(','));
    }

    const csvContent = '\uFEFF' + csvLines.join('\n');
    const filename = `孕程记_健康记录_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csvContent);

    log.api('CSV导出', '成功', { count: rows.length });
  } catch (error) {
    log.error('CSV导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

function extractTextFromTiptap(jsonContent) {
  try {
    if (!jsonContent) return '';
    const doc = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
    let texts = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(doc);
    return texts.join('\n');
  } catch { return String(jsonContent || ''); }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ========== PDF 字体查找 ==========
function findChineseFont() {
  const candidates = [
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
  ];
  for (const fp of candidates) {
    try { if (fs.existsSync(fp)) return fp; } catch {}
  }
  return null;
}

// ========== 日记 PDF 导出（真正 PDF） ==========
router.get('/export/diary-pdf', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    let sql = "SELECT * FROM diary_entry WHERE 1=1";
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    if (dateFrom) { sql += ' AND entry_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND entry_date <= ?'; params.push(dateTo); }
    sql += ' ORDER BY entry_date ASC';

    const stmt = db.getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    if (rows.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的日记内容' });
    }

    const fontPath = findChineseFont();
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 55, right: 55 }, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    // 注册中文字体
    if (fontPath) {
      doc.registerFont('Chinese', fontPath);
    }

    const PW = 595.28; // A4 width
    const PH = 841.89; // A4 height
    const ML = 55, MR = 55, MT = 50, MB = 50;
    const CW = PW - ML - MR; // content width
    const fontName = fontPath ? 'Chinese' : 'Helvetica';
    const titleFont = fontName;
    const bodyFont = fontName;

    // ---- 封面页 ----
    doc.fontSize(32).font(titleFont).fillColor('#e91e63')
      .text('🌸 孕程日记', 0, 200, { align: 'center', width: PW });
    doc.moveDown(0.8);
    doc.fontSize(13).fillColor('#666').font(bodyFont)
      .text(`共 ${rows.length} 篇日记`, { align: 'center', width: PW });
    doc.text(`导出时间：${new Date().toLocaleString('zh-CN')}`, { align: 'center', width: PW });
    doc.moveDown(3);
    doc.fontSize(11).fillColor('#999')
      .text('— 由 孕程记 自动生成 —', { align: 'center', width: PW });

    // ---- 分隔线 + 换页 ----
    doc.addPage();

    const moodMap = { '1': '😢 很差', '2': '😔 不好', '3': '😐 一般', '4': '😊 不错', '5': '😄 很好' };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const plainText = extractTextFromTiptap(row.content);

      // 检查剩余空间，不够则换页
      if (doc.y > PH - MB - 120) doc.addPage();

      // 日期标签（圆角矩形背景）
      const dateStr = String(row.entry_date || '');
      const weekStr = row.gestational_week ? String(row.gestational_week) : '';
      const moodStr = row.mood ? (moodMap[row.mood] || row.mood) : '';

      // 绘制日期背景条
      const startY = doc.y;
      doc.save();
      doc.roundedRect(ML, startY, CW, 24, 4).fill('#fce4ec');
      doc.restore();

      doc.font(titleFont).fontSize(12).fillColor('#c2185b')
        .text(dateStr, ML + 10, startY + 5, { continued: true, width: CW - 20 });

      if (weekStr) {
        doc.font(bodyFont).fontSize(10).fillColor('#999')
          .text(`  (${weekStr})`, { continued: moodStr ? true : false });
      }
      if (moodStr) {
        doc.font(bodyFont).fontSize(10).fillColor('#666')
          .text(`  ${moodStr}`);
      }

      doc.y = startY + 30;
      doc.moveDown(0.3);

      // 正文内容 - 左侧色条 + 文字区域
      const bodyStartY = doc.y;
      doc.save();
      doc.font(bodyFont).fontSize(12).fillColor('#333')
        .text(plainText || '(无内容)', ML + 14, bodyStartY, {
          width: CW - 18,
          lineGap: 5,
        });
      const bodyEndY = doc.y;
      // 色条高度 = 正文实际高度，最少 30pt
      const barHeight = Math.max(30, bodyEndY - bodyStartY);
      doc.save();
      doc.rect(ML, bodyStartY, 3, barHeight).fill('#e91e63');
      doc.restore();

      doc.moveDown(0.8);

      // 条目间分隔线
      if (i < rows.length - 1) {
        doc.save();
        doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y)
          .strokeColor('#f0f0f0').lineWidth(1).stroke();
        doc.restore();
        doc.moveDown(0.5);
      }
    }

    // ---- 页脚（每页添加） ==========
    const pages = doc.bufferedPageRange();
    for (let p = 0; p < pages.count; p++) {
      doc.switchToPage(p);
      doc.font(bodyFont).fontSize(9).fillColor('#bbb')
        .text(`— 孕程记 v${config.VERSION || '0.0.18'} —   第 ${p + 1} / ${pages.count} 页`,
          ML, PH - 35, { align: 'center', width: CW });
    }

    doc.end();

    // 等待流结束再发送响应
    doc.on('end', () => {
      const pdfBuf = Buffer.concat(chunks);
      const filename = `孕程记_日记_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', pdfBuf.length);
      res.send(pdfBuf);
      log.api('日记PDF导出', '成功', { count: rows.length, size: pdfBuf.length });
    });
  } catch (error) {
    log.error('日记PDF导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

// ========== 纪念相册 PDF 导出 ==========
router.get('/export/album-pdf', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;

    let sql = 'SELECT * FROM pregnancy_photo WHERE media_type = \'photo\'';
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    sql += ' ORDER BY gestational_week ASC, gestational_day ASC, created_at ASC';

    const stmt = db.getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const photos = [];
    while (stmt.step()) photos.push(stmt.getAsObject());
    stmt.free();

    if (photos.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的照片' });
    }

    const fontPath = findChineseFont();
    const doc = new PDFDocument({ size: 'A4', margins: { top: 45, bottom: 45, left: 45, right: 45 }, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    if (fontPath) doc.registerFont('Chinese', fontPath);

    const PW = 595.28, PH = 841.89;
    const ML = 45, MR = 45, MT = 45, MB = 45;
    const CW = PW - ML - MR;
    const fontName = fontPath ? 'Chinese' : 'Helvetica';

    // ---- 封面 ----
    doc.fontSize(32).font(fontName).fillColor('#7b1fa2')
      .text('📷 孕程纪念相册', 0, 200, { align: 'center', width: PW });
    doc.moveDown(0.8);
    doc.fontSize(13).fillColor('#666').font(fontName)
      .text(`共 ${photos.length} 张珍贵瞬间`, { align: 'center', width: PW });
    doc.text(`生成时间：${new Date().toLocaleString('zh-CN')}`, { align: 'center', width: PW });
    doc.moveDown(3);
    doc.fontSize(11).fillColor('#999')
      .text('— 由 孕程记 自动生成 —', { align: 'center', width: PW });

    doc.addPage();

    // ---- 每张照片一页 ----
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];

      // 分页保护：如果剩余空间不足则换页
      if (doc.y > PH - MB - 450) doc.addPage();

      // 标题区：孕周信息
      const weekLabel = photo.gestational_week != null
        ? `第 ${photo.gestational_week} 周` + (photo.gestational_day ? `+${photo.gestational_day} 天` : '')
        : '';
      const typeLabel = photo.milestone_type || photo.photo_type || '';

      doc.font(fontName).fontSize(16).fillColor('#7b1fa2')
        .text(`${weekLabel}${typeLabel ? ' · ' + typeLabel : ''}`, ML, MT, { width: CW });

      // 日期
      const photoDate = photo.created_at ? photo.created_at.slice(0, 10) : '';
      if (photoDate) {
        doc.font(fontName).fontSize(10).fillColor('#999')
          .text(photoDate, ML, doc.y + 2, { width: CW });
      }
      doc.moveDown(0.5);

      // 图片区域
      const imgX = ML;
      const imgY = doc.y;
      const imgW = CW;
      const imgH = 380; // 固定图片高度

      const imgPath = photo.file_path || photo.thumbnail_path;
      if (imgPath && fs.existsSync(imgPath)) {
        try {
          doc.image(imgPath, imgX, imgY, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'center', valign: 'center' });
        } catch (e) {
          // 图片加载失败时显示占位框
          doc.save();
          doc.rect(imgX, imgY, imgW, imgH).fillAndStroke('#f5f5f5', '#ddd');
          doc.font(fontName).fontSize(12).fillColor('#999')
            .text('[图片无法加载]', imgX, imgY + imgH / 2 - 8, { width: imgW, align: 'center' });
          doc.restore();
        }
      } else {
        doc.save();
        doc.rect(imgX, imgY, imgW, imgH).fillAndStroke('#f5f5f5', '#ddd');
        doc.font(fontName).fontSize(12).fillColor('#999')
          .text('[图片文件不存在]', imgX, imgY + imgH / 2 - 8, { width: imgW, align: 'center' });
        doc.restore();
      }

      // 描述文字
      const descY = imgY + imgH + 12;
      if (photo.note) {
        doc.font(fontName).fontSize(11).fillColor('#555')
          .text(String(photo.note), ML, descY, { width: CW, lineGap: 3 });
      }

      // 页码角标
      doc.font(fontName).fontSize(9).fillColor('#ccc')
        .text(`${i + 1} / ${photos.length}`, PW - MR - 40, PH - MB - 5, { width: 60, align: 'right' });

      if (i < photos.length - 1) doc.addPage();
    }

    // ---- 尾页 ----
    doc.addPage();
    doc.fontSize(22).font(fontName).fillColor('#7b1fa2')
      .text('— 全文完 —', 0, 300, { align: 'center', width: PW });
    doc.moveDown(2);
    doc.fontSize(11).fillColor('#999')
      .text(`共 ${photos.length} 张照片`, { align: 'center', width: PW });
    doc.text(`由 孕程记 自动生成`, { align: 'center', width: PW });

    // ---- 页脚 ----
    const pages = doc.bufferedPageRange();
    for (let p = 0; p < pages.count; p++) {
      doc.switchToPage(p);
      doc.font(fontName).fontSize(9).fillColor('#bbb')
        .text(`— 孕程记 v${config.VERSION || '0.0.18'} —   第 ${p + 1} / ${pages.count} 页`,
          ML, PH - 35, { align: 'center', width: CW });
    }

    doc.end();

    doc.on('end', () => {
      const pdfBuf = Buffer.concat(chunks);
      const filename = `孕程记_纪念相册_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', pdfBuf.length);
      res.send(pdfBuf);
      log.api('相册PDF导出', '成功', { count: photos.length, size: pdfBuf.length });
    });
  } catch (error) {
    log.error('相册PDF导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/browse-dir', (req, res) => {
  try {
    let dirPath = req.query.path || '/';
    if (dirPath === '/') dirPath = '/';

    const roots = [];

    // 飞牛系统：检测用户授权目录 (TRIM_DATA_ACCESSIBLE_PATHS, V1.1.8+)
    const accessiblePaths = process.env.TRIM_DATA_ACCESSIBLE_PATHS || '';
    if (accessiblePaths) {
      const accPaths = accessiblePaths.split(':').filter(p => p.trim());
      for (const p of accPaths) {
        try {
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            let canRW = false;
            try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch {}
            const dirName = p.split('/').filter(Boolean).pop() || p;
            roots.push({
              name: `授权-${dirName}`,
              path: p,
              isRoot: true,
              canRW,
              type: 'accessible',
              desc: '用户授权目录',
            });
          }
        } catch { /* skip */ }
      }
    }

    // 飞牛系统：检测应用共享目录 (TRIM_DATA_SHARE_PATHS / data-share)
    const sharePaths = process.env.TRIM_DATA_SHARE_PATHS || '';
    if (sharePaths) {
      const shPaths = sharePaths.split(':').filter(p => p.trim());
      for (const p of shPaths) {
        try {
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            let canRW = false;
            try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch {}
            const dirName = p.split('/').filter(Boolean).pop() || p;
            roots.push({
              name: `共享-${dirName}`,
              path: p,
              isRoot: true,
              canRW,
              type: 'share',
              desc: '应用共享目录',
            });
          }
        } catch { /* skip */ }
      }
    }

    // 兼容旧逻辑：扫描存储卷 /vol1 ~ /vol10
    for (let i = 1; i <= 10; i++) {
      const vol = `/vol${i}`;
      try {
        if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) {
          try {
            fs.accessSync(vol, fs.constants.R_OK | fs.constants.W_OK);
            roots.push({ name: `存储${i} (${vol})`, path: vol, isRoot: true, canRW: true, type: 'volume' });
          } catch {
            roots.push({ name: `存储${i}-只读 (${vol})`, path: vol, isRoot: true, canRW: false, type: 'volume' });
          }
        }
      } catch { /* skip */ }
    }

    // 开发模式：如果没有找到任何根目录，使用当前工作目录
    if (roots.length === 0) {
      const cwd = process.cwd();
      roots.push({
        name: `工作目录 (${cwd})`,
        path: cwd,
        isRoot: true,
        canRW: true,
        type: 'dev',
        desc: '开发模式默认目录',
      });
    }

    if (!fs.existsSync(dirPath)) {
      return res.json({ code: 0, data: { current: dirPath, items: [], roots, canRW: false } });
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return res.json({ code: 0, data: { current: dirPath, items: [], roots, canRW: false } });
    }

    let canRW = false;
    try { fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch {}

    const items = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => {
        const fullPath = path.join(dirPath, d.name);
        let itemCanRW = false;
        try { fs.accessSync(fullPath, fs.constants.R_OK | fs.constants.W_OK); itemCanRW = true; } catch {}
        return {
          name: d.name,
          path: fullPath,
          isDir: true,
          canRW: itemCanRW,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    res.json({ code: 0, data: { current: dirPath, items, roots, canRW } });
  } catch (error) {
    log.error('目录浏览', error.message);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;

// ========== 一键恢复（自动查找最新备份） ==========
router.post('/restore-latest', async (req, res) => {
  try {
    const backupBaseDir = path.join(config.DATA_DIR || '.', 'backups');
    if (!fs.existsSync(backupBaseDir)) {
      return res.json({ code: 1001, data: null, message: '未找到任何备份，请先创建备份' });
    }

    // 查找最新的备份目录
    const dirs = fs.readdirSync(backupBaseDir)
      .filter(name => name.startsWith('backup_'))
      .map(name => ({ name, mtime: fs.statSync(path.join(backupBaseDir, name)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (dirs.length === 0) {
      return res.json({ code: 1001, data: null, message: '未找到备份文件' });
    }

    const latestBackup = path.join(backupBaseDir, dirs[0].name);
    log.api('恢复', '一键恢复开始', { dir: latestBackup, backupDate: dirs[0].name });

    // 读取 data.json
    const dataFile = path.join(latestBackup, 'data.json');
    if (!fs.existsSync(dataFile)) {
      return res.json({ code: 1001, data: null, message: '备份数据损坏：缺少 data.json' });
    }

    let importData;
    try {
      importData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } catch (parseErr) {
      return res.json({ code: 1001, data: null, message: '备份文件格式错误或已损坏: ' + parseErr.message });
    }
    if (!importData || !importData.tables || typeof importData.tables !== 'object') {
      return res.json({ code: 1001, data: null, message: '备份数据结构无效，缺少 tables 字段' });
    }

    // ====== 1. 清空表并重新插入（全量替换） ======
    let totalRows = 0;
    const results = {};

    for (const [table, rows] of Object.entries(importData.tables)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      try {
        db.run(`DELETE FROM ${table}`);
        if (rows.length > 0) {
          const insertStmt = prepareInsertStatement(table, rows[0]);
          for (const row of rows) {
            db.run(insertStmt.sql, insertStmt.params(row));
          }
        }
        results[table] = rows.length;
        totalRows += rows.length;
      } catch (e) {
        results[table] = `ERROR: ${e.message}`;
      }
    }

    // ====== 2. 路径重写（与 restore 保持一致） ======
    const fileMap = importData._file_map || { album: {}, checkup_photos: {}, checkup_reports: {}, config: {} };

    function rewritePaths(table, col, mapObj, baseDir) {
      try {
        const rows = db.queryAll(`SELECT id, ${col} FROM ${table}`);
        for (const row of rows) {
          const oldPath = row[col];
          if (oldPath && mapObj[oldPath]) {
            db.run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [path.join(baseDir, mapObj[oldPath]), row.id]);
          }
        }
      } catch {}
    }
    rewritePaths('pregnancy_photo', 'file_path', fileMap.album, config.PHOTOS_DIR);
    rewritePaths('pregnancy_photo', 'thumbnail_path', fileMap.album, config.PHOTOS_DIR);
    // 视频文件放到 MEDIA_DIR
    try {
      const vids = db.queryAll("SELECT id, file_path FROM pregnancy_photo WHERE media_type = 'video'");
      for (const v of vids) {
        if (v.file_path && fileMap.album[v.file_path]) {
          db.run("UPDATE pregnancy_photo SET file_path = ? WHERE id = ?", [path.join(config.MEDIA_DIR, fileMap.album[v.file_path]), v.id]);
        }
      }
    } catch {}
    rewritePaths('checkup_photo', 'file_path', fileMap.checkup_photos, config.PHOTOS_DIR);
    rewritePaths('checkup_photo', 'thumbnail_path', fileMap.checkup_photos, config.PHOTOS_DIR);
    rewritePaths('checkup_report', 'file_path', fileMap.checkup_reports, config.PHOTOS_DIR);

    // ====== 3. 文件恢复（按类型分发到正确目录，与 restore 一致） ======
    let fileCount = 0;

    // 相册照片 → PHOTOS_DIR
    const srcAlbum = path.join(latestBackup, 'files', 'album');
    if (fs.existsSync(srcAlbum)) fileCount += copyDirFiles(srcAlbum, config.PHOTOS_DIR);
    // 产检照片 → PHOTOS_DIR
    const srcCkPhoto = path.join(latestBackup, 'files', 'checkup_photos');
    if (fs.existsSync(srcCkPhoto)) fileCount += copyDirFiles(srcCkPhoto, config.PHOTOS_DIR);
    // 检查报告 → PHOTOS_DIR/checkup_reports/
    const srcReport = path.join(latestBackup, 'files', 'checkup_reports');
    if (fs.existsSync(srcReport)) fileCount += copyDirFiles(srcReport, path.join(config.PHOTOS_DIR, 'checkup_reports'));
    // 配置文件 → 应用 data/ 目录
    const srcConfig = path.join(latestBackup, 'files', 'config');
    if (fs.existsSync(srcConfig)) fileCount += copyDirFiles(srcConfig, path.join(__dirname, '..', 'data'));

    // 兼容旧版备份（无 _file_map 时递归复制）
    const filesDir = path.join(latestBackup, 'files');
    if (fs.existsSync(filesDir) && !importData._file_map) {
      fileCount += copyDirContentsRecursive(filesDir, config.PHOTOS_DIR);
    }

    db.saveDb();
    log.api('恢复', '一键恢复完成', { dir: latestBackup, rows: totalRows, files: fileCount });
    res.json({
      code: 0,
      data: { restored_rows: totalRows, files: fileCount, backup_dir: latestBackup, results },
      message: `恢复完成：${totalRows} 条记录，${fileCount} 个文件（来自 ${dirs[0].name}）`
    });
  } catch (error) {
    log.error('恢复', '一键恢复失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});
