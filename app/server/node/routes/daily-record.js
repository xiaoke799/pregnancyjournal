const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');

const DIARY_BASE = path.join(config.PHOTOS_DIR, 'diary');

function _getDiaryDateDir() {
  const now = new Date();
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
}

if (!fs.existsSync(DIARY_BASE)) {
  fs.mkdirSync(DIARY_BASE, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dateDir = _getDiaryDateDir();
      const dir = path.join(DIARY_BASE, dateDir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${db.generateId()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片类型，仅允许 jpeg、png、webp'));
    }
  }
});

router.post('/daily-records/diary-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.json({ code: 1001, data: null, message: '请上传图片文件' });
    }
    res.json({
      code: 0,
      data: { url: `/api/v1/daily-records/diary/${req.file.filename}` },
      message: 'success'
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records/diary/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(403).json({ code: 1001, data: null, message: '非法的文件名' });
    }
    const filePath = path.join(DIARY_BASE, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 1001, data: null, message: '文件不存在' });
    }
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/daily-records', (req, res) => {
  try {
    const { pregnancy_id, record_date, weight, fetal_heart_rate, body_temperature,
            blood_glucose_fasting, blood_glucose_1h, blood_glucose_2h,
            mood, mood_note, stool, stool_record, note,
            blood_pressure_systolic, blood_pressure_diastolic,
            sleep_hours, sleep_quality, symptoms, exercise_type, exercise_duration,
            diet_note, medication, edema_level, vaginal_discharge, skin_condition,
            urination_frequency, hcg_value, uric_acid, supplement_record,
            intimacy_note, plan_text, plan_date, water_intake,
            contraction_count, contraction_interval,
            fetal_movement_count, fetal_movement_duration } = req.body;

    if (!pregnancy_id || !record_date) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 和 record_date 为必填项' });
    }

    const existing = db.queryOne(
      'SELECT id FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, record_date]
    );

    if (existing) {
      const updates = [];
      const params = [];

      const fields = ['weight', 'fetal_heart_rate', 'body_temperature',
                      'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
                      'mood', 'mood_note', 'stool', 'stool_record', 'note',
                      'blood_pressure_systolic', 'blood_pressure_diastolic',
                      'sleep_hours', 'sleep_quality', 'symptoms', 'exercise_type',
                      'exercise_duration', 'diet_note', 'medication',
                      'edema_level', 'vaginal_discharge', 'skin_condition', 'urination_frequency',
                      'hcg_value', 'uric_acid', 'supplement_record', 'intimacy_note',
                      'plan_text', 'plan_date', 'water_intake',
                      'contraction_count', 'contraction_interval',
                      'fetal_movement_count', 'fetal_movement_duration'];
 
      for (const field of fields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
 
      if (updates.length === 0) {
        return res.json({ code: 0, data: existing, message: 'success' });
      }
 
      updates.push("updated_at = datetime('now')");
      params.push(existing.id);
 
      db.run(`UPDATE daily_record SET ${updates.join(', ')} WHERE id = ?`, params);
 
      const updated = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [existing.id]);
      return res.json({ code: 0, data: updated, message: 'success' });
    }

    const id = db.generateId();
    db.run(
      `INSERT INTO daily_record (id, pregnancy_id, record_date,
       weight, fetal_heart_rate, body_temperature,
       blood_glucose_fasting, blood_glucose_1h, blood_glucose_2h,
       mood, mood_note, stool, stool_record, note,
       blood_pressure_systolic, blood_pressure_diastolic,
       sleep_hours, sleep_quality, symptoms, exercise_type, exercise_duration,
       diet_note, medication, edema_level, vaginal_discharge, skin_condition,
       urination_frequency, hcg_value, uric_acid, supplement_record,
       intimacy_note, plan_text, plan_date, water_intake,
       contraction_count, contraction_interval,
       fetal_movement_count, fetal_movement_duration)
       VALUES (?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?)`,
      [id, pregnancy_id, record_date,
       weight ?? null, fetal_heart_rate ?? null, body_temperature ?? null,
       blood_glucose_fasting ?? null, blood_glucose_1h ?? null, blood_glucose_2h ?? null,
       mood ?? null, mood_note || null, stool || null, stool_record || null, note || null,
       blood_pressure_systolic ?? null, blood_pressure_diastolic ?? null,
       sleep_hours ?? null, sleep_quality ?? null, symptoms || null, exercise_type || null, exercise_duration ?? null,
       diet_note || null, medication || null, edema_level || null, vaginal_discharge || null, skin_condition || null,
       urination_frequency ?? null, hcg_value ?? null, uric_acid ?? null, supplement_record || null,
       intimacy_note || null, plan_text || null, plan_date || null, water_intake ?? null,
       contraction_count ?? null, contraction_interval ?? null,
       fetal_movement_count ?? null, fetal_movement_duration ?? null]
    );

    const record = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [id]);
    res.json({ code: 0, data: record, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records', (req, res) => {
  try {
    const { pregnancy_id, start_date, end_date, page = 1, page_size = 20 } = req.query;

    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    let where = 'WHERE pregnancy_id = ?';
    const params = [pregnancy_id];

    if (start_date) {
      where += ' AND record_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      where += ' AND record_date <= ?';
      params.push(end_date);
    }

    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const limit = parseInt(page_size);

    const total = db.queryOne(`SELECT COUNT(*) as count FROM daily_record ${where}`, params);
    const records = db.queryAll(
      `SELECT * FROM daily_record ${where} ORDER BY record_date DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      code: 0,
      data: { list: records, total: total.count, page: parseInt(page), page_size: limit },
      message: 'success'
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records/:record_date', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    const record = db.queryOne(
      'SELECT * FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, req.params.record_date]
    );

    if (!record) {
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    res.json({ code: 0, data: record, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/daily-records/:record_id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [req.params.record_id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    const updates = [];
    const params = [];

    const fields = ['weight', 'fetal_heart_rate', 'body_temperature',
                    'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
                    'mood', 'mood_note', 'stool', 'stool_record', 'note',
                    'blood_pressure_systolic', 'blood_pressure_diastolic',
                    'sleep_hours', 'sleep_quality', 'symptoms', 'exercise_type',
                    'exercise_duration', 'diet_note', 'medication',
                    'edema_level', 'vaginal_discharge', 'skin_condition', 'urination_frequency',
                    'hcg_value', 'uric_acid', 'supplement_record', 'intimacy_note',
                    'plan_text', 'plan_date', 'water_intake',
                    'contraction_count', 'contraction_interval',
                    'fetal_movement_count', 'fetal_movement_duration'];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.record_id);

    db.run(`UPDATE daily_record SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [req.params.record_id]);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/daily-records/:record_id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [req.params.record_id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    db.run('DELETE FROM daily_record WHERE id = ?', [req.params.record_id]);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
