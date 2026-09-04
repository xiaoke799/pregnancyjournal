const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

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
    const { pregnancy_id, checkup_date, gestational_week, checkup_type } = req.body;
    logger.info('checkup', `POST /checkups - pregnancy_id=${pregnancy_id}, date=${checkup_date}, week=${gestational_week}, type=${checkup_type}`);
    if (!pregnancy_id || !checkup_date || !gestational_week) {
      logger.warn('checkup', 'POST /checkups - missing required fields');
      return res.json({ code: 1001, data: null, message: '缺少必填字段' });
    }
    if (!config.isValidDate(checkup_date)) {
      return res.json({ code: 1001, data: null, message: 'checkup_date 格式无效，应为 YYYY-MM-DD' });
    }
    const id = db.generateId();
    await db.run(
      `INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, gestational_day, hospital, checkup_type, weight, blood_pressure, fetal_heart_rate, fundal_height, abdominal_circumference, notes, is_completed, is_recommended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, pregnancy_id, checkup_date, gestational_week, req.body.gestational_day || 0, req.body.hospital || null, checkup_type || 'standard', req.body.weight || null, req.body.blood_pressure || null, req.body.fetal_heart_rate || null, req.body.fundal_height || null, req.body.abdominal_circumference || null, req.body.notes || null, req.body.is_completed || 0, req.body.is_recommended || 0]
    );
    const row = await db.queryOne('SELECT * FROM prenatal_checkup WHERE id = ?', [id]);
    logger.info('checkup', `POST /checkups - checkup created (id=${id})`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `POST /checkups 异常: ${e.message}, body={date:${req.body.checkup_date},week:${req.body.gestational_week},type:${req.body.checkup_type}}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups', async (req, res) => {
  try {
    const { pregnancy_id, page = 1, page_size = 20 } = req.query;
    logger.info('checkup', `GET /checkups - pregnancy_id=${pregnancy_id}, page=${page}, size=${page_size}`);
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    const total = await db.queryOne(`SELECT COUNT(*) as count FROM prenatal_checkup ${where}`, params);
    const rows = await db.queryAll(`SELECT * FROM prenatal_checkup ${where} ORDER BY checkup_date DESC LIMIT ? OFFSET ?`, [...params, parseInt(page_size), offset]);
    logger.info('checkup', `GET /checkups - found ${rows.length} records, total=${total.count}`);
    res.json({ code: 0, data: { list: rows, items: rows, total: total.count, page: parseInt(page), page_size: parseInt(page_size) }, message: 'success' });
  } catch (e) {
    logger.error('checkup', `GET /checkups error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/:id', async (req, res) => {
  try {
    logger.info('checkup', `GET /checkups/${req.params.id}`);
    const row = await db.queryOne('SELECT * FROM prenatal_checkup WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '记录不存在' });
    logger.info('checkup', `GET /checkups/${req.params.id} - found`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `GET /checkups/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/:id', async (req, res) => {
  try {
    logger.info('checkup', `PUT /checkups/${req.params.id} - fields=${Object.keys(req.body).join(',')}`);
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
    logger.info('checkup', `PUT /checkups/${req.params.id} - updated successfully`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `PUT /checkups/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/:id', async (req, res) => {
  try {
    logger.info('checkup', `DELETE /checkups/${req.params.id}`);
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
    logger.info('checkup', `DELETE /checkups/${req.params.id} - deleted with ${photos.length} photos, ${reports.length} reports`);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    logger.error('checkup', `DELETE /checkups/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checkups/:id/photos', upload.single('file'), async (req, res) => {
  try {
    logger.info('checkup', `POST /checkups/${req.params.id}/photos - file=${req.file?.originalname}`);
    if (!req.file) return res.json({ code: 1001, data: null, message: '请上传文件' });
    const ext = path.extname(req.file.originalname);
    const filename = uuidv4() + ext;
    const checkupDir = path.join(CHECKUP_BASE, req.params.id, 'photos');
    if (!fs.existsSync(checkupDir)) fs.mkdirSync(checkupDir, { recursive: true });
    const destPath = path.join(checkupDir, filename);
    _ensureDir(config.PHOTOS_DIR);
    fs.renameSync(req.file.path, destPath);
    const id = db.generateId();
    // 产检照片暂不生成独立缩略图，thumbnail_path 指向原图（前端可直接使用）
    await db.run(
      `INSERT INTO checkup_photo (id, checkup_id, file_path, thumbnail_path, note, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [id, req.params.id, destPath, destPath, req.body.note || null]
    );
    const row = await db.queryOne('SELECT * FROM checkup_photo WHERE id = ?', [id]);
    logger.info('checkup', `POST /checkups/${req.params.id}/photos - photo saved (id=${id})`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `POST /checkups/:id/photos error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/:id/photos', async (req, res) => {
  try {
    logger.info('checkup', `GET /checkups/${req.params.id}/photos`);
    const rows = await db.queryAll('SELECT * FROM checkup_photo WHERE checkup_id = ? ORDER BY created_at DESC', [req.params.id]);
    logger.info('checkup', `GET /checkups/${req.params.id}/photos - ${rows.length} photos`);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    logger.error('checkup', `GET /checkups/:id/photos error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/photos/:photo_id', async (req, res) => {
  try {
    logger.info('checkup', `DELETE /checkups/photos/${req.params.photo_id}`);
    const photo = await db.queryOne('SELECT * FROM checkup_photo WHERE id = ?', [req.params.photo_id]);
    if (!photo) return res.json({ code: 1001, data: null, message: '照片不存在' });
    _deleteReportFile(photo.file_path);
    await db.run('DELETE FROM checkup_photo WHERE id = ?', [req.params.photo_id]);
    logger.info('checkup', `DELETE /checkups/photos/${req.params.photo_id} - deleted`);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    logger.error('checkup', `DELETE /checkups/photos/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checkups/custom', async (req, res) => {
  try {
    const { pregnancy_id, name } = req.body;
    logger.info('checkup', `POST /checkups/custom - pregnancy_id=${pregnancy_id}, name=${name}`);
    if (!pregnancy_id || !name) {
      logger.warn('checkup', 'POST /checkups/custom - missing required fields');
      return res.json({ code: 1001, data: null, message: '缺少必填字段' });
    }
    const id = db.generateId();
    const itemsJson = Array.isArray(req.body.items) ? JSON.stringify(req.body.items) : null;
    await db.run(
      `INSERT INTO custom_checkup (id, pregnancy_id, name, items, checkup_date, notes, is_completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [id, pregnancy_id, name, itemsJson, req.body.checkup_date || null, req.body.notes || null]
    );
    const row = await db.queryOne('SELECT * FROM custom_checkup WHERE id = ?', [id]);
    logger.info('checkup', `POST /checkups/custom - custom checkup created (id=${id})`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `POST /checkups/custom error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/custom', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;

    // [诊断] 先查全表总数（不带过滤），确认数据是否真的存进去了
    const allRows = await db.queryAll('SELECT id, pregnancy_id, name, checkup_date FROM custom_checkup ORDER BY created_at DESC');
    logger.info('checkup', `GET /checkups/custom pid=${pregnancy_id || '无'} | 全表=${allRows.length}条 ${JSON.stringify(allRows.map(r => r.id + ':' + r.name))}`);

    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    const rows = await db.queryAll(`SELECT * FROM custom_checkup ${where} ORDER BY created_at DESC`, params);
    logger.info('checkup', `GET /checkups/custom → 返回 ${rows.length} 条数据`);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    logger.error('checkup', `GET /checkups/custom error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/custom/:id', async (req, res) => {
  try {
    logger.info('checkup', `PUT /checkups/custom/${req.params.id} - fields=${Object.keys(req.body).join(',')}`);
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
    logger.info('checkup', `PUT /checkups/custom/${req.params.id} - updated successfully`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `PUT /checkups/custom/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/custom/:id', async (req, res) => {
  try {
    logger.info('checkup', `DELETE /checkups/custom/${req.params.id}`);
    const existing = await db.queryOne('SELECT id FROM custom_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    await db.run('DELETE FROM custom_checkup WHERE id = ?', [req.params.id]);
    logger.info('checkup', `DELETE /checkups/custom/${req.params.id} - deleted`);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    logger.error('checkup', `DELETE /checkups/custom/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/custom/:id/complete', async (req, res) => {
  try {
    logger.info('checkup', `PUT /checkups/custom/${req.params.id}/complete`);
    const existing = await db.queryOne('SELECT id FROM custom_checkup WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    await db.run('UPDATE custom_checkup SET is_completed = 1, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
    const row = await db.queryOne('SELECT * FROM custom_checkup WHERE id = ?', [req.params.id]);
    logger.info('checkup', `PUT /checkups/custom/${req.params.id}/complete - marked as completed`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('checkup', `PUT /checkups/custom/:id/complete error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

const ALLOWED_REPORT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

const REPORTS_DIR = path.join(CHECKUP_BASE, 'reports');

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
    const reportDir = path.join(CHECKUP_BASE, req.params.id, 'reports');
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
    const resolvedPath = path.resolve(report.file_path);
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ code: 1001, data: null, message: '文件不存在' });
    // 图片类型用 inline（浏览器可直接显示），其他用 attachment（下载）
    const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(report.filename || '');
    res.setHeader('Content-Disposition', `${isImage ? 'inline' : 'attachment'}; filename="${encodeURIComponent(report.filename)}"`);
    res.setHeader('Content-Type', report.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(resolvedPath);
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
    const parentPath = path.dirname(normalized);
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
        type: dirent.isDirectory() ? 'dir' : 'file',
        size: dirent.isDirectory() ? null : fs.statSync(path.join(normalized, dirent.name)).size,
        mtime: fs.statSync(path.join(normalized, dirent.name)).mtime.getTime(),
      }));
    res.json({ code: 0, data: { path: normalized, parent: normalized === '/' ? null : parentPath, entries }, message: 'success' });
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

// ========== 检验结果 (lab_result) 路由 ==========

router.post('/checkups/:id/lab-results', async (req, res) => {
  try {
    const { category, item_name, value, unit, reference_min, reference_max, status } = req.body;
    if (!category || !item_name || value === undefined || value === null) {
      return res.json({ code: 1001, data: null, message: '缺少必填字段：category、item_name、value' });
    }
    const id = db.generateId();
    await db.run(
      `INSERT INTO lab_result (id, checkup_id, category, item_name, value, unit, reference_min, reference_max, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, req.params.id, category, item_name, Number(value), unit || null,
       reference_min !== undefined ? Number(reference_min) : null,
       reference_max !== undefined ? Number(reference_max) : null,
       status || 'normal']
    );
    const row = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [id]);
    logger.info('checkup', `POST /lab-results - created (id=${id}, checkup_id=${req.params.id})`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checkups/:id/lab-results', async (req, res) => {
  try {
    const { category } = req.query;
    let where = 'WHERE checkup_id = ?';
    const params = [req.params.id];
    if (category) { where += ' AND category = ?'; params.push(category); }
    const rows = await db.queryAll(`SELECT * FROM lab_result ${where} ORDER BY created_at ASC`, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checkups/lab-results/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    const fields = ['category', 'item_name', 'value', 'unit', 'reference_min', 'reference_max', 'status'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(f === 'value' || f === 'reference_min' || f === 'reference_max' ? Number(req.body[f]) : req.body[f]);
      }
    }
    if (sets.length === 0) return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    sets.push('updated_at = datetime(\'now\')');
    params.push(req.params.id);
    await db.run(`UPDATE lab_result SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checkups/lab-results/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    await db.run('DELETE FROM lab_result WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
