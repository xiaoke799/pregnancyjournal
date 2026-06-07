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

const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'avi', 'ogg', 'mkv', 'flv', 'wmv', 'm4v',
  '3gp', '3g2', 'mts', 'm2ts', 'ts', 'vob', 'rm', 'rmvb', 'asf'
]);
const VIDEO_MIMES = (mime) => typeof mime === 'string' && mime.startsWith('video/');

function _isVideo(filename, contentType) {
  if (contentType && VIDEO_MIMES(contentType)) return true;
  const ext = path.extname(filename || '').toLowerCase().slice(1);
  return VIDEO_EXTS.has(ext);
}

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function _getDateDir() {
  const now = new Date();
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const ALBUM_BASE = path.join(config.PHOTOS_DIR, 'album');
const MEDIA_BASE = path.join(config.MEDIA_DIR);

function _detectMediaType(filename, contentType) {
  return _isVideo(filename, contentType) ? 'video' : 'image';
}

function _getThumbnailPath(originalPath, mediaType) {
  if (mediaType === 'video' && originalPath) {
    const dir = path.dirname(originalPath);
    const base = path.basename(originalPath, path.extname(originalPath));
    return path.join(dir, `thumb_${base}.jpg`);
  }
  return originalPath;
}

router.post('/photos', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ code: 1001, data: null, message: '请上传文件' });
    const { pregnancy_id, photo_type, gestational_week, gestational_day, milestone_type, checkup_id, note, media_type: reqMedia } = req.body;
    logger.info('photo', `POST /photos - file=${req.file.originalname}, size=${req.file.size}, type=${photo_type}, pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id || !photo_type) {
      logger.warn('photo', 'POST /photos - missing required fields');
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.json({ code: 1001, data: null, message: '缺少必填字段: pregnancy_id, photo_type' });
    }
    const detectedType = _detectMediaType(req.file.originalname, req.file.mimetype);
    const finalMediaType = reqMedia || detectedType;
    const ext = path.extname(req.file.originalname);
    const filename = uuidv4() + ext;
    const dateDir = _getDateDir();
    let destPath, thumbnail_path;
    if (finalMediaType === 'video') {
      destPath = path.join(MEDIA_BASE, dateDir, filename);
      _ensureDir(path.join(MEDIA_BASE, dateDir));
    } else {
      destPath = path.join(ALBUM_BASE, dateDir, filename);
      _ensureDir(path.join(ALBUM_BASE, dateDir));
    }
    fs.renameSync(req.file.path, destPath);
    thumbnail_path = _getThumbnailPath(destPath, finalMediaType);
    const id = db.generateId();
    await db.run(
      `INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, gestational_week, gestational_day, milestone_type, checkup_id, note, media_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, pregnancy_id, photo_type, destPath, thumbnail_path, gestational_week || null, gestational_day || null, milestone_type || null, checkup_id || null, note || null, finalMediaType]
    );
    const row = await db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [id]);
    logger.info('photo', `POST /photos - uploaded id=${id}, media_type=${finalMediaType}, path=${destPath}`);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    logger.error('photo', 'POST /photos error', e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/photos', async (req, res) => {
  try {
    const { pregnancy_id, photo_type, gestational_week } = req.query;
    logger.info('photo', `GET /photos - pregnancy_id=${pregnancy_id}, photo_type=${photo_type}, week=${gestational_week}`);
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    if (photo_type) { where += ' AND photo_type = ?'; params.push(photo_type); }
    if (gestational_week) { where += ' AND gestational_week = ?'; params.push(gestational_week); }
    const rows = await db.queryAll(`SELECT * FROM pregnancy_photo ${where} ORDER BY created_at DESC`, params);
    logger.info('photo', `GET /photos - returned ${rows.length} photos`);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    logger.error('photo', 'GET /photos error', e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/photos/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '照片不存在' });
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/photos/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM pregnancy_photo WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '照片不存在' });
    const fields = ['pregnancy_id', 'photo_type', 'gestational_week', 'gestational_day', 'milestone_type', 'checkup_id', 'note'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
    }
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    await db.run(`UPDATE pregnancy_photo SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/photos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    logger.info('photo', `DELETE /photos/${id}`);
    const photo = await db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [id]);
    if (!photo) {
      logger.warn('photo', `DELETE /photos/${id} - photo not found`);
      return res.json({ code: 1001, data: null, message: '照片不存在' });
    }
    if (photo.file_path && fs.existsSync(photo.file_path)) { try { fs.unlinkSync(photo.file_path); } catch (e) {} }
    if (photo.thumbnail_path && photo.thumbnail_path !== photo.file_path && fs.existsSync(photo.thumbnail_path)) { try { fs.unlinkSync(photo.thumbnail_path); } catch (e) {} }
    await db.run('DELETE FROM pregnancy_photo WHERE id = ?', [id]);
    logger.info('photo', `DELETE /photos/${id} - deleted successfully, file=${photo.file_path}`);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    logger.error('photo', `DELETE /photos/${req.params.id} error`, e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/photos/:id/file', async (req, res) => {
  try {
    const photo = await db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [req.params.id]);
    if (!photo || !photo.file_path) return res.status(404).json({ code: 1001, data: null, message: '照片不存在' });
    if (!fs.existsSync(photo.file_path)) return res.status(404).json({ code: 1001, data: null, message: '文件不存在' });
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.tiff': 'image/tiff', '.heic': 'image/heic', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.ogg': 'video/ogg', '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv', '.m4v': 'video/x-m4v', '.3gp': 'video/3gpp' };
    const ext = path.extname(photo.file_path).toLowerCase();
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.sendFile(path.resolve(photo.file_path));
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/photos/:id/thumbnail', async (req, res) => {
  try {
    const photo = await db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ code: 1001, data: null, message: '照片不存在' });
    let thumbPath = photo.thumbnail_path;
    if (!thumbPath || !fs.existsSync(thumbPath)) {
      thumbPath = photo.file_path;
    }
    if (!thumbPath || !fs.existsSync(thumbPath)) return res.status(404).json({ code: 1001, data: null, message: '文件不存在' });
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
    const ext = path.extname(thumbPath).toLowerCase();
    res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg');
    res.sendFile(path.resolve(thumbPath));
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
