const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');

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
  }),
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
    logger.info('daily-record', `POST /diary-image - file=${req.file?.originalname}, size=${req.file?.size}, pregnancy_id=${req.body?.pregnancy_id}`);
    if (!req.file) {
      logger.warn('daily-record', 'POST /diary-image - no file uploaded');
      return res.json({ code: 1001, data: null, message: '请上传图片文件' });
    }
    logger.info('daily-record', `POST /diary-image - saved as ${req.file.filename}`);
    res.json({
      code: 0,
      data: { url: `/api/v1/daily-records/diary/${req.file.filename}` },
      message: 'success'
    });
  } catch (e) {
    logger.error('daily-record', `POST /diary-image error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records/diary/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    logger.info('daily-record', `GET /diary/${filename}`);
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      logger.warn('daily-record', `GET /diary/${filename} - illegal filename`);
      return res.status(403).json({ code: 1001, data: null, message: '非法的文件名' });
    }
    const filePath = path.join(DIARY_BASE, filename);
    if (!fs.existsSync(filePath)) {
      logger.warn('daily-record', `GET /diary/${filename} - file not found at ${filePath}`);
      return res.status(404).json({ code: 1001, data: null, message: '文件不存在' });
    }
    logger.info('daily-record', `GET /diary/${filename} - serving file`);
    res.sendFile(filePath);
  } catch (e) {
    logger.error('daily-record', `GET /diary/${filename} error: ${e.message}`);
    res.status(500).json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/daily-records', (req, res) => {
  try {
    const { pregnancy_id, record_date } = req.body;
    logger.info('daily-record', `POST /daily-records - pregnancy_id=${pregnancy_id}, record_date=${record_date}, fields=${Object.keys(req.body).length}`);

    if (!pregnancy_id || !record_date) {
      logger.warn('daily-record', `POST /daily-records - missing required fields: pregnancy_id=${pregnancy_id}, record_date=${record_date}`);
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 和 record_date 为必填项' });
    }

    const existing = db.queryOne(
      'SELECT id FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, record_date]
    );

    if (existing) {
      logger.info('daily-record', `POST /daily-records - existing record found (id=${existing.id}), checking updates`);
      const updates = [];
      const params = [];

      const fields = ['weight', 'fetal_heart_rate', 'body_temperature',
                      'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
                      'mood', 'mood_note', 'stool', 'stool_record', 'note',
                      'blood_pressure_systolic', 'blood_pressure_diastolic',
                      'sleep_hours', 'sleep_quality', 'sleep_record', 'symptoms', 'exercise_type',
                      'exercise_duration', 'exercise_record', 'diet_note', 'diet_record', 'medication',
                      'edema_level', 'vaginal_discharge', 'skin_condition', 'urination_frequency',
                      'hcg_value', 'hcg_weeks', 'uric_acid', 'uric_acid_period', 'supplement_record', 'intimacy_note', 'intimacy_record',
                      'plan_text', 'plan_date', 'water_intake', 'habit_text',
                      'contraction_count', 'contraction_interval', 'contraction_duration', 'contraction_pain', 'contraction_record',
                      'fetal_movement_count', 'fetal_movement_duration', 'fetal_movement_record'];
 
      for (const field of fields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
 
      if (updates.length === 0) {
        logger.info('daily-record', `POST /daily-records - no fields to update for existing record`);
        return res.json({ code: 0, data: existing, message: 'success' });
      }
 
      updates.push("updated_at = datetime('now')");
      params.push(existing.id);
 
      logger.info('daily-record', `POST /daily-records - updating ${updates.length} fields: ${updates.map(u => u.split('=')[0].trim()).join(', ')}`);
      db.run(`UPDATE daily_record SET ${updates.join(', ')} WHERE id = ?`, params);
 
      const updated = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [existing.id]);
      logger.info('daily-record', `POST /daily-records - record updated successfully (id=${existing.id})`);
      return res.json({ code: 0, data: updated, message: 'success' });
    }

    const id = db.generateId();
    logger.info('daily-record', `POST /daily-records - inserting new record (id=${id})`);
    db.run(
      `INSERT INTO daily_record (id, pregnancy_id, record_date,
       weight, fetal_heart_rate, body_temperature,
       blood_glucose_fasting, blood_glucose_1h, blood_glucose_2h,
       mood, mood_note, stool, stool_record, note,
       blood_pressure_systolic, blood_pressure_diastolic,
       sleep_hours, sleep_quality, sleep_record, symptoms, exercise_type, exercise_duration, exercise_record,
       diet_note, diet_record, medication, edema_level, vaginal_discharge, skin_condition,
       urination_frequency, hcg_value, hcg_weeks, uric_acid, uric_acid_period, supplement_record,
       intimacy_note, intimacy_record, plan_text, plan_date, water_intake, habit_text,
       contraction_count, contraction_interval, contraction_duration, contraction_pain, contraction_record,
       fetal_movement_count, fetal_movement_duration, fetal_movement_record)
       VALUES (?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?)`,
      [id, pregnancy_id, record_date,
       req.body.weight ?? null, req.body.fetal_heart_rate ?? null, req.body.body_temperature ?? null,
       req.body.blood_glucose_fasting ?? null, req.body.blood_glucose_1h ?? null, req.body.blood_glucose_2h ?? null,
       req.body.mood ?? null, req.body.mood_note || null, req.body.stool || null, req.body.stool_record || null, req.body.note || null,
       req.body.blood_pressure_systolic ?? null, req.body.blood_pressure_diastolic ?? null,
       req.body.sleep_hours ?? null, req.body.sleep_quality ?? null, req.body.sleep_record || null, req.body.symptoms || null, req.body.exercise_type || null, req.body.exercise_duration ?? null, req.body.exercise_record || null,
       req.body.diet_note || null, req.body.diet_record || null, req.body.medication || null, req.body.edema_level || null, req.body.vaginal_discharge || null, req.body.skin_condition || null,
       req.body.urination_frequency ?? null, req.body.hcg_value ?? null, req.body.hcg_weeks ?? null, req.body.uric_acid ?? null, req.body.uric_acid_period || null, req.body.supplement_record || null,
       req.body.intimacy_note || null, req.body.intimacy_record || null, req.body.plan_text || null, req.body.plan_date || null, req.body.water_intake ?? null, req.body.habit_text || null,
       req.body.contraction_count ?? null, req.body.contraction_interval ?? null, req.body.contraction_duration ?? null, req.body.contraction_pain || null, req.body.contraction_record || null,
       req.body.fetal_movement_count ?? null, req.body.fetal_movement_duration ?? null, req.body.fetal_movement_record || null]
    );

    const record = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [id]);
    logger.info('daily-record', `POST /daily-records - new record inserted (id=${id})`);
    res.json({ code: 0, data: record, message: 'success' });
  } catch (e) {
    logger.error('daily-record', `POST /daily-records error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records', (req, res) => {
  try {
    const { pregnancy_id, start_date, end_date, page = 1, page_size = 20 } = req.query;
    logger.info('daily-record', `GET /daily-records - pregnancy_id=${pregnancy_id}, date_range=[${start_date||'any'}~${end_date||'any'}], page=${page}, page_size=${page_size}`);

    if (!pregnancy_id) {
      logger.warn('daily-record', 'GET /daily-records - missing pregnancy_id');
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

    logger.info('daily-record', `GET /daily-records - found ${records.length} records, total=${total.count}`);
    res.json({
      code: 0,
      data: { items: records, list: records, total: total.count, page: parseInt(page), page_size: limit },
      message: 'success'
    });
  } catch (e) {
    logger.error('daily-record', `GET /daily-records error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records/by-date/:record_date', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('daily-record', `GET /daily-records/by-date/${req.params.record_date} - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('daily-record', 'GET /daily-records/by-date - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }
    const record = db.queryOne(
      'SELECT * FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, req.params.record_date]
    );
    logger.info('daily-record', `GET /daily-records/by-date - record ${record ? 'found' : 'not found'}`);
    res.json({ code: 0, data: record || null, message: 'success' });
  } catch (e) {
    logger.error('daily-record', `GET /daily-records/by-date error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/daily-records/:record_date', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('daily-record', `GET /daily-records/${req.params.record_date} - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('daily-record', 'GET /daily-records/:date - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    const record = db.queryOne(
      'SELECT * FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, req.params.record_date]
    );

    if (!record) {
      logger.warn('daily-record', `GET /daily-records/${req.params.record_date} - record not found`);
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    logger.info('daily-record', `GET /daily-records/${req.params.record_date} - record found`);
    res.json({ code: 0, data: record, message: 'success' });
  } catch (e) {
    logger.error('daily-record', `GET /daily-records/:date error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/daily-records/:record_id', (req, res) => {
  try {
    const recordId = req.params.record_id;
    logger.info('daily-record', `PUT /daily-records/${recordId} - fields=${Object.keys(req.body).join(',')}`);
    const existing = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [recordId]);
    if (!existing) {
      logger.warn('daily-record', `PUT /daily-records/${recordId} - record not found`);
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    const updates = [];
    const params = [];

    const fields = ['weight', 'fetal_heart_rate', 'body_temperature',
                    'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
                    'mood', 'mood_note', 'stool', 'stool_record', 'note',
                    'blood_pressure_systolic', 'blood_pressure_diastolic',
                    'sleep_hours', 'sleep_quality', 'sleep_record', 'symptoms', 'exercise_type',
                    'exercise_duration', 'exercise_record', 'diet_note', 'diet_record', 'medication',
                    'edema_level', 'vaginal_discharge', 'skin_condition', 'urination_frequency',
                    'hcg_value', 'hcg_weeks', 'uric_acid', 'uric_acid_period', 'supplement_record', 'intimacy_note', 'intimacy_record',
                    'plan_text', 'plan_date', 'water_intake', 'habit_text',
                    'contraction_count', 'contraction_interval', 'contraction_duration', 'contraction_pain', 'contraction_record',
                    'fetal_movement_count', 'fetal_movement_duration', 'fetal_movement_record'];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      logger.info('daily-record', `PUT /daily-records/${recordId} - no fields to update`);
      return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(recordId);

    db.run(`UPDATE daily_record SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [recordId]);
    logger.info('daily-record', `PUT /daily-records/${recordId} - updated ${updates.length} fields successfully`);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    logger.error('daily-record', `PUT /daily-records/${req.params.record_id} error`, e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/daily-records/:record_id', (req, res) => {
  try {
    const recordId = req.params.record_id;
    logger.info('daily-record', `DELETE /daily-records/${recordId}`);
    const existing = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [recordId]);
    if (!existing) {
      logger.warn('daily-record', `DELETE /daily-records/${recordId} - record not found`);
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    db.run('DELETE FROM daily_record WHERE id = ?', [recordId]);
    logger.info('daily-record', `DELETE /daily-records/${recordId} - deleted successfully`);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    logger.error('daily-record', `DELETE /daily-records/${req.params.record_id} error`, e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
