const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const log = require('../logger');

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
    res.setHeader('Content-Disposition', `attachment; filename="pregnancy-journal-backup-${new Date().toISOString().slice(0, 10)}.json"`);
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
    if (!dir) return res.json({ code: 1001, data: null, message: '请指定备份目录路径' });

    const backupDir = path.resolve(dir);
    fs.mkdirSync(backupDir, { recursive: true });

    log.api('备份', '全量备份开始', { dir: backupDir });

    const exportData = {
      version: '2.0.0',
      exported_at: new Date().toISOString(),
      app_name: 'pregnancy-journal',
      tables: {},
      file_manifest: { total: 0, by_type: {} }
    };

    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }

    function copyAndTrack(srcPath, destSubdir) {
      if (!srcPath || !fs.existsSync(srcPath)) return false;
      const dest = path.join(backupDir, 'files', destSubdir);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      return copyFile(srcPath, dest);
    }
    function trackCount(type, n) {
      exportData.file_manifest.total += n;
      if (!exportData.file_manifest.by_type[type]) exportData.file_manifest.by_type[type] = 0;
      exportData.file_manifest.by_type[type] += n;
    }

    let count = 0;

    const allPhotos = readTable('pregnancy_photo');
    for (const p of allPhotos) {
      if (copyAndTrack(p.file_path, p.media_type === 'video' ? 'media' : `album/${p.file_path}`)) count++;
      if (p.thumbnail_path && p.thumbnail_path !== p.file_path) {
        if (copyAndTrack(p.thumbnail_path, `album/${p.thumbnail_path}`)) count++;
      }
    }
    trackCount('album', count); count = 0;

    const checkupPhotos = readTable('checkup_photo');
    for (const cp of checkupPhotos) {
      if (copyAndTrack(cp.file_path, cp.file_path)) count++;
      if (cp.thumbnail_path && cp.thumbnail_path !== cp.file_path) {
        if (copyAndTrack(cp.thumbnail_path, cp.thumbnail_path)) count++;
      }
    }
    trackCount('checkup_photos', count); count = 0;

    const checkupReports = readTable('checkup_report');
    for (const cr of checkupReports) {
      if (copyAndTrack(cr.file_path, cr.file_path)) count++;
    }
    trackCount('checkup_reports', count);

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

    let fileCount = 0;
    const backupFilesDir = path.join(restoreDir, 'files');
    if (fs.existsSync(backupFilesDir)) {
      fileCount = copyDirContentsRecursive(backupFilesDir, config.PHOTOS_DIR);
    }
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

    const stmt = db.prepare(sql);
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

router.get('/export/diary-pdf', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    let sql = "SELECT record_date, note, mood, mood_note, weight, blood_pressure_systolic, blood_pressure_diastolic, sleep_hours, diet_note, symptoms, exercise_type, created_at FROM daily_record WHERE note IS NOT NULL AND note != ''";
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    if (dateFrom) { sql += ' AND record_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND record_date <= ?'; params.push(dateTo); }
    sql += ' ORDER BY record_date ASC';

    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    if (rows.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的日记内容' });
    }

    const moodMap = { '1': '😢 很差', '2': '😔 不好', '3': '😐 一般', '4': '😊 不错', '5': '😄 很好' };

    let html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>孕程记 - 日记</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #333; line-height: 1.8; padding: 40px; max-width: 700px; margin: 0 auto; }
  h1 { text-align: center; color: #e91e63; font-size: 28px; border-bottom: 3px solid #fce4ec; padding-bottom: 12px; margin-bottom: 30px; }
  .meta { text-align: center; color: #999; font-size: 13px; margin-bottom: 35px; }
  .entry { margin-bottom: 32px; page-break-inside: avoid; }
  .entry-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .entry-date { background: linear-gradient(135deg, #e91e63, #f06292); color: #fff; padding: 4px 14px; border-radius: 16px; font-size: 14px; font-weight: bold; }
  .entry-mood { font-size: 18px; }
  .entry-body { background: #fef7f9; border-left: 4px solid #e91e63; padding: 14px 18px; border-radius: 0 10px 10px 0; white-space: pre-wrap; word-break: break-word; font-size: 15px; line-height: 1.9; }
  .entry-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .tag { background: #fff0f5; color: #c2185b; padding: 2px 10px; border-radius: 10px; font-size: 12px; }
  .footer { text-align: center; color: #bbb; font-size: 11px; margin-top: 50px; padding-top: 15px; border-top: 1px solid #eee; }
  @media print { body { padding: 0; } .entry { page-break-inside: avoid; } }
</style></head><body>`;

    html += `<h1>🌸 孕程日记</h1>`;
    html += `<div class="meta">共 ${rows.length} 篇日记 · 导出时间 ${new Date().toLocaleString('zh-CN')}</div>`;

    for (const row of rows) {
      const tags = [];
      if (row.weight) tags.push(`体重 ${row.weight}kg`);
      if (row.blood_pressure_systolic && row.blood_pressure_diastolic) tags.push(`血压 ${row.blood_pressure_systolic}/${row.blood_pressure_diastolic}`);
      if (row.sleep_hours) tags.push(`睡眠 ${row.sleep_hours}h`);
      if (row.exercise_type) tags.push(`运动 ${row.exercise_type}`);
      if (row.diet_note) tags.push(`饮食: ${row.diet_note}`);
      if (row.symptoms) {
        try { const syms = JSON.parse(row.symptoms); if (Array.isArray(syms)) tags.push(...syms); } catch {}
      }

      html += `<div class="entry">`;
      html += `<div class="entry-header">`;
      html += `<span class="entry-date">${row.record_date}</span>`;
      if (row.mood) html += `<span class="entry-mood">${moodMap[row.mood] || row.mood}</span>`;
      html += `</div>`;
      html += `<div class="entry-body">${(row.note || '').replace(/</g, '&lt;')}</div>`;
      if (tags.length > 0) {
        html += `<div class="entry-tags">`;
        for (const t of tags) html += `<span class="tag">${t}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    html += `<div class="footer">— 由 孕程记 自动生成 —</div></body></html>`;

    const filename = `孕程记_日记_${new Date().toISOString().slice(0, 10)}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(html);

    log.api('日记PDF导出', '成功', { count: rows.length });
  } catch (error) {
    log.error('日记PDF导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/browse-dir', (req, res) => {
  try {
    let dirPath = req.query.path || '/';
    if (dirPath === '/') dirPath = '/';

    const roots = [];
    for (let i = 1; i <= 10; i++) {
      const vol = `/vol${i}`;
      try {
        if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) {
          try {
            fs.accessSync(vol, fs.constants.R_OK | fs.constants.W_OK);
            roots.push({ name: `存储${i} (${vol})`, path: vol, isRoot: true, canRW: true });
          } catch {
            roots.push({ name: `存储${i}-只读 (${vol})`, path: vol, isRoot: true, canRW: false });
          }
        }
      } catch { /* skip */ }
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
