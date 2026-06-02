const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ dest: 'uploads/', limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
const CHECKUP_BASE = path.join(config.PHOTOS_DIR, 'checkups');
const NAS_WHITELIST = ['/vol1', '/vol2', '/vol3', '/home', '/share'];
const schedule_dates_file = path.join(config.DATA_DIR, 'schedule_dates.json');

function _deleteReportFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function _readScheduleDates() {
  try {
    if (fs.existsSync(schedule_dates_file)) {
      return JSON.parse(fs.readFileSync(schedule_dates_file, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function _writeScheduleDates(data) {
  _ensureDir(path.dirname(schedule_dates_file));
  fs.writeFileSync(schedule_dates_file, JSON.stringify(data, null, 2), 'utf-8');
}

function _isNasPathSafe(p) {
  const normalized = path.normalize(p).replace(/\\/g, '/');
  return NAS_WHITELIST.some(allowed => normalized === allowed || normalized.startsWith(allowed + '/'));
}

router.post('/checkups', async (req, res) => {
  try {
    const { pregnancy_id, checkup_date, gestational_week, gestational_day, hospital, checkup_type, weight, blood_pressure, fetal_heart_rate, fundal_height, abdominal_circumference, notes, is_completed, is_recommended } = req.body;
    if (!pregnancy_id || !checkup_date || !gestational_week) {
      return res.json({ code: 1001, data: null, message: '缺少必填字段' });
    }
    const id = db.generateId();
    await db.run(
      `INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, gestational_day, hospital, checkup_type, weight, blood_pressure, fetal_heart_rate, fundal_height, abdominal_circumference, notes, is_completed, is_recommended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, pregnancy_id, checkup_date, gestational_week, gestational_day || 0, hospital || null, checkup_type || 'standard', weight || null, blood_pressure || null, fetal_heart_rate || null, fundal_height || null, abdominal_circumference || null, notes || null, is_completed || 0, is_recommended || 0]
    );
    const row = await db.queryOne('SELECT * FROM prenatal_checkup WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups', async (req, res) => {
  try {
    const { pregnancy_id, page = 1, page_size = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    const total = await db.queryOne(`SELECT COUNT(*) as count FROM prenatal_checkup ${where}`, params);
    const rows = await db.queryAll(`SELECT * FROM prenatal_checkup ${where} ORDER BY checkup_date DESC LIMIT ? OFFSET ?`, [...params, parseInt(page_size), offset]);
    res.json({ code: 0, data: { list: rows, total: total.count, page: parseInt(page), page_size: parseInt(page_size) }, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM prenatal_checkup WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '记录不存在' });
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM prenatal_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    const fields = ['pregnancy_id', 'checkup_date', 'gestational_week', 'gestational_day', 'hospital', 'checkup_type', 'weight', 'blood_pressure', 'fetal_heart_rate', 'fundal_height', 'abdominal_circumference', 'notes', 'is_completed', 'is_recommended'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    }
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    await db.run(`UPDATE prenatal_checkup SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT * FROM prenatal_checkup WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM prenatal_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    const photos = await db.queryAll('SELECT file_path FROM checkup_photo WHERE checkup_id = ?', [req.params.id]);
    for (const p of photos) { _deleteReportFile(p.file_path); }
    const reports = await db.queryAll('SELECT file_path FROM checkup_report WHERE checkup_id = ?', [req.params.id]);
    for (const r of reports) { _deleteReportFile(r.file_path); }
    await db.run('DELETE FROM checkup_photo WHERE checkup_id = ?', [req.params.id]);
    await db.run('DELETE FROM checkup_report WHERE checkup_id = ?', [req.params.id]);
    await db.run('DELETE FROM lab_result WHERE checkup_id = ?', [req.params.id]);
    await db.run('DELETE FROM prenatal_checkup WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checkups/:id/photos', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ code: 1001, data: null, message: '请上传文件' });
    const ext = path.extname(req.file.originalname);
    const filename = uuidv4() + ext;
    const checkupDir = path.join(CHECKUP_BASE, checkupId, 'photos');
    if (!fs.existsSync(checkupDir)) fs.mkdirSync(checkupDir, { recursive: true });
    const destPath = path.join(checkupDir, filename);
    _ensureDir(config.PHOTOS_DIR);
    fs.renameSync(req.file.path, destPath);
    const id = db.generateId();
    await db.run(
      `INSERT INTO checkup_photo (id, checkup_id, file_path, note, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, req.params.id, destPath, req.body.note || null]
    );
    const row = await db.queryOne('SELECT * FROM checkup_photo WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/:id/photos', async (req, res) => {
  try {
    const rows = await db.queryAll('SELECT * FROM checkup_photo WHERE checkup_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/photos/:photo_id', async (req, res) => {
  try {
    const photo = await db.queryOne('SELECT * FROM checkup_photo WHERE id = ?', [req.params.photo_id]);
    if (!photo) return res.json({ code: 1001, data: null, message: '照片不存在' });
    _deleteReportFile(photo.file_path);
    await db.run('DELETE FROM checkup_photo WHERE id = ?', [req.params.photo_id]);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checkups/custom', async (req, res) => {
  try {
    const { pregnancy_id, name, items, checkup_date, notes } = req.body;
    if (!pregnancy_id || !name) {
      return res.json({ code: 1001, data: null, message: '缺少必填字段' });
    }
    const id = db.generateId();
    const itemsJson = Array.isArray(items) ? JSON.stringify(items) : null;
    await db.run(
      `INSERT INTO custom_checkup (id, pregnancy_id, name, items, checkup_date, notes, is_completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [id, pregnancy_id, name, itemsJson, checkup_date || null, notes || null]
    );
    const row = await db.queryOne('SELECT * FROM custom_checkup WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/custom', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    const rows = await db.queryAll(`SELECT * FROM custom_checkup ${where} ORDER BY created_at DESC`, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/custom/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM custom_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    const fields = ['pregnancy_id', 'name', 'checkup_date', 'notes', 'is_completed'];
    const sets = [];
    const params = [];
    if (req.body.items !== undefined) {
      sets.push('items = ?');
      params.push(Array.isArray(req.body.items) ? JSON.stringify(req.body.items) : req.body.items);
    }
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
    }
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    await db.run(`UPDATE custom_checkup SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT * FROM custom_checkup WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/custom/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM custom_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    await db.run('DELETE FROM custom_checkup WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/custom/:id/complete', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM custom_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    await db.run('UPDATE custom_checkup SET is_completed = 1, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
    const row = await db.queryOne('SELECT * FROM custom_checkup WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

const ALLOWED_REPORT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

router.post('/checkups/:id/reports', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ code: 1001, data: null, message: '请上传文件' });
    if (!ALLOWED_REPORT_MIMES.includes(req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.json({ code: 1001, data: null, message: '仅支持图片(JPEG/PNG/WebP/HEIC)和PDF格式' });
    }
    const { checkup_type, report_category, sub_item } = req.body;
    if (!checkup_type || !report_category) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.json({ code: 1001, data: null, message: '缺少checkup_type或report_category字段' });
    }
    const ext = path.extname(req.file.originalname);
    const filename = uuidv4() + ext;
    const reportDir = path.join(CHECKUP_BASE, checkupId, 'reports');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const destPath = path.join(reportDir, filename);
    fs.renameSync(req.file.path, destPath);
    const id = db.generateId();
    await db.run(
      `INSERT INTO checkup_report (id, checkup_id, file_path, filename, file_type, mime_type, file_size, checkup_type, report_category, sub_item, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, req.params.id, destPath, req.file.originalname, ext.slice(1), req.file.mimetype, req.file.size, checkup_type, report_category, sub_item || null]
    );
    const row = await db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/:id/reports', async (req, res) => {
  try {
    const { checkup_type } = req.query;
    let where = 'WHERE checkup_id = ?';
    const params = [req.params.id];
    if (checkup_type) { where += ' AND checkup_type = ?'; params.push(checkup_type); }
    const rows = await db.queryAll(`SELECT * FROM checkup_report ${where} ORDER BY created_at DESC`, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/reports/:id/download', async (req, res) => {
  try {
    const report = await db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [req.params.id]);
    if (!report || !report.file_path) return res.status(404).json({ code: 1001, data: null, message: '报告不存在' });
    if (!fs.existsSync(report.file_path)) return res.status(404).json({ code: 1001, data: null, message: '文件不存在' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.filename)}"`);
    res.setHeader('Content-Type', report.mime_type || 'application/octet-stream');
    res.sendFile(path.resolve(report.file_path));
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/reports/:id', async (req, res) => {
  try {
    const report = await db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [req.params.id]);
    if (!report) return res.json({ code: 1001, data: null, message: '报告不存在' });
    _deleteReportFile(report.file_path);
    await db.run('DELETE FROM checkup_report WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/files/browse', async (req, res) => {
  try {
    let reqPath = req.query.path || '/';
    reqPath = decodeURIComponent(reqPath);
    const normalized = path.normalize(reqPath).replace(/\\/g, '/');
    if (!_isNasPathSafe(normalized)) {
      return res.json({ code: 1001, data: null, message: '路径不在允许范围内' });
    }
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      return res.json({ code: 1001, data: null, message: '目录不存在' });
    }
    const entries = fs.readdirSync(normalized, { withFileTypes: true })
      .filter(dirent => !dirent.name.startsWith('.'))
      .filter(dirent => {
        if (dirent.isDirectory()) return true;
        const ext = path.extname(dirent.name).toLowerCase();
        const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.bmp'];
        return imgExts.includes(ext) || ext === '.pdf';
      })
      .map(dirent => ({
        name: dirent.name,
        path: path.join(normalized, dirent.name).replace(/\\/g, '/'),
        is_directory: dirent.isDirectory(),
        size: dirent.isDirectory() ? null : fs.statSync(path.join(normalized, dirent.name)).size
      }));
    res.json({ code: 0, data: { path: normalized, entries }, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checkups/:id/reports/from-nas', async (req, res) => {
  try {
    const { nas_path, checkup_type, report_category, sub_item } = req.body;
    if (!nas_path || !checkup_type || !report_category) {
      return res.json({ code: 1001, data: null, message: '缺少必填字段' });
    }
    const normalized = path.normalize(nas_path).replace(/\\/g, '/');
    if (!_isNasPathSafe(normalized)) {
      return res.json({ code: 1001, data: null, message: 'NAS路径不在允许范围内' });
    }
    if (!fs.existsSync(normalized)) {
      return res.json({ code: 1001, data: null, message: 'NAS源文件不存在' });
    }
    const stat = fs.statSync(normalized);
    const ext = path.extname(nas_path);
    const filename = uuidv4() + ext;
    const destPath = path.join(REPORTS_DIR, filename);
    _ensureDir(REPORTS_DIR);
    fs.copyFileSync(normalized, destPath);
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf' };
    const id = db.generateId();
    await db.run(
      `INSERT INTO checkup_report (id, checkup_id, file_path, filename, file_type, mime_type, file_size, checkup_type, report_category, sub_item, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, req.params.id, destPath, path.basename(nas_path), ext.slice(1), mimeMap[ext.toLowerCase()] || 'application/octet-stream', stat.size, checkup_type, report_category, sub_item || null]
    );
    const row = await db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkup-schedule/:pregnancy_id/dates', async (req, res) => {
  try {
    const allDates = _readScheduleDates();
    const userDates = allDates[req.params.pregnancy_id] || {};
    res.json({ code: 0, data: userDates, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkup-schedule/:pregnancy_id/dates/:schedule_id', async (req, res) => {
  try {
    const { date_str } = req.body;
    if (!date_str) return res.json({ code: 1001, data: null, message: '缺少date_str字段' });
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date_str)) return res.json({ code: 1001, data: null, message: '日期格式应为YYYY-MM-DD' });
    const allDates = _readScheduleDates();
    if (!allDates[req.params.pregnancy_id]) allDates[req.params.pregnancy_id] = {};
    allDates[req.params.pregnancy_id][req.params.schedule_id] = date_str;
    _writeScheduleDates(allDates);
    res.json({ code: 0, data: { schedule_id: req.params.schedule_id, date_str }, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
