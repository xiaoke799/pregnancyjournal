const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const heic = require('../services/heic');

// ===== 版本标记：部署后可通过日志确认是否加载了最新代码 =====
logger.info('daily-record', `模块加载 v0.0.29 [${new Date().toISOString()}]`);

/**
 * 数值字段「读时归一」
 *
 * 背景：老库升级时，缺失的列是由 db.js 的 migrateDb 用 ALTER TABLE ADD COLUMN 补出来的。
 * 早期实现一律补成 TEXT，而 SQLite 按列亲和性存值 —— TEXT 列里写数字 92 会存成字符串 '92'，
 * 读出来就是 "92"。前端拿它绑 n-input-number、画折线图都会出问题
 * （实测：升级库 waist/bust/hip 读回是字符串，新装库是数字）。
 *
 * 现在两个层面都处理：
 *  ① db.js 已改成「按建表语句声明的类型补列」→ 以后升级不会再产生 TEXT 数值列；
 *  ② 这里在**读取出口**统一把数值列转回数字 —— 已经升级过的老库改不了列类型，
 *     但用户读到的数据必须是数字。归一发生在读侧，不修改任何用户数据。
 */
const NUMERIC_FIELDS = [
  'weight', 'fetal_heart_rate', 'body_temperature', 'bust', 'waist', 'hip',
  'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
  'sleep_hours', 'exercise_duration', 'hcg_value', 'hcg_weeks', 'uric_acid',
  'is_plan_done', 'water_intake',
  'contraction_count', 'contraction_interval', 'contraction_duration',
  'fetal_movement_count', 'fetal_movement_duration',
];

function normalizeNumericFields(row) {
  if (!row || typeof row !== 'object') return row;
  for (const f of NUMERIC_FIELDS) {
    const v = row[f];
    if (typeof v === 'string') {
      const s = v.trim();
      if (s !== '' && !isNaN(Number(s))) row[f] = Number(s);
    }
  }
  return row;
}

/** 单条记录出口统一走这里 */
function shape(record) {
  return normalizeNumericFields(record) || null;
}

/** 列表出口统一走这里 */
function shapeList(records) {
  return Array.isArray(records) ? records.map(r => normalizeNumericFields(r)) : [];
}

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
      if (!fs.existsSync(DIARY_BASE)) fs.mkdirSync(DIARY_BASE, { recursive: true });
      cb(null, DIARY_BASE);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${db.generateId()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // HEIC/HEIF 也放行：iPhone 默认就拍这个格式，传上来后转成 JPEG（见下面的 diary-image 路由），
    // 否则 iPhone 用户根本没法往日记里插图。TIFF 不放行（浏览器显示不了）。
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片类型，仅允许 JPEG / PNG / WebP / HEIC'));
    }
  }
});

// 把 multer 的错误（体积超限 / 类型不符）转成 JSON，避免前端只看到「服务器内部错误」
//
// ⚠️ 字段名必须是 'file'：本项目所有上传接口都用 'file'
// （`checkup.js` 的 /checkups/:id/photos、/checkups/:id/reports，`photo.js` 的 /photos，
// 前端 `api/checkup.ts` 与日记的调用点也都是 append('file')）。
// 这里曾写成 'image' ⇒ multer 抛 `Unexpected field` ⇒ **日记插图上传从来没成功过**
// （HTTP 仍是 200，只带业务码 1001，日志里只有一行 warn，极难发现）。
function uploadDiaryImage(req, res, next) {
  const mw = upload.single('file');
  return mw(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '图片过大，最大支持 5MB（可先压缩或改用其它图片）'
        : (err.message || '图片上传失败');
      logger.warn('daily-record', `日记插图上传失败: ${msg}`);
      return res.json({ code: 1001, data: null, message: msg });
    }
    next();
  });
}

router.post('/daily-records/diary-image', uploadDiaryImage, async (req, res) => {
  try {
    logger.info('daily-record', `POST /diary-image - file=${req.file?.originalname}, size=${req.file?.size}, pregnancy_id=${req.body?.pregnancy_id}`);
    if (!req.file) {
      logger.warn('daily-record', 'POST /diary-image - no file uploaded');
      return res.json({ code: 1001, data: null, message: '请上传图片文件' });
    }
    // HEIC/HEIF → 转成同名 .jpg 再返回（浏览器解不开 HEIC；原图保留）
    let filename = req.file.filename;
    const savedPath = path.join(DIARY_BASE, filename);
    if (heic.isHeicFile(savedPath)) {
      const conv = await heic.convertToJpeg(savedPath);
      if (conv.ok) {
        filename = path.basename(conv.jpegPath);
        logger.info('daily-record', `日记插图 HEIC 已转 JPEG: ${req.file.filename} → ${filename}`);
      } else {
        logger.warn('daily-record', `日记插图 HEIC 转码失败（保留原图，浏览器可能无法预览）: ${conv.error}`);
      }
    }
    logger.info('daily-record', `POST /diary-image - saved as ${filename}`);
    res.json({
      code: 0,
      data: { url: `/api/v1/daily-records/diary/${filename}` },
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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  } catch (e) {
    logger.error('daily-record', `GET /diary/${filename} error: ${e.message}`);
    res.status(500).json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/daily-records', (req, res) => {
  try {
    let { pregnancy_id, record_date } = req.body;
    const rawRecordDate = record_date; // 保存原始值用于日志追踪

    // [诊断] 完整请求体（含体重/腰围等健康数据）——已降级为 DEBUG，
    // 默认 INFO 级别不落盘；确需排查时设 LOG_LEVEL=DEBUG
    logger.debug('daily-record', `RAW BODY: ${JSON.stringify(req.body)}`);

    // 容错：确保 record_date 最终为有效 YYYY-MM-DD（任何异常都不应阻止保存）
    if (!record_date || typeof record_date !== 'string') {
      logger.info('daily-record', `record_date修复: raw=${JSON.stringify(rawRecordDate)}(type=${typeof rawRecordDate}) → 使用今天(缺失/非字符串)`);
      record_date = config.localToday();
    } else if (!config.isValidDate(record_date)) {
      const parsed = new Date(record_date);
      if (!isNaN(parsed.getTime())) {
        // 用本地日期还原：toISOString 是 UTC，东八区凌晨会把日期减一天
        const fixed = config.localToday(parsed);
        logger.info('daily-record', `record_date修复: raw=${JSON.stringify(rawRecordDate)} → ${fixed}(Date解析)`);
        record_date = fixed;
      } else {
        logger.info('daily-record', `record_date修复: raw=${JSON.stringify(rawRecordDate)} → 使用今天(解析完全失败)`);
        record_date = config.localToday();
      }
    }

    // 记录非空字段摘要
    const nonNullFields = Object.keys(req.body).filter(k => req.body[k] != null && k !== 'pregnancy_id' && k !== 'record_date');
    logger.info('daily-record', `POST pregnancy_id=${pregnancy_id}, record_date=${record_date} (raw=${JSON.stringify(rawRecordDate)}), 非空字段=[${nonNullFields.join(',')}]`);

    if (!pregnancy_id) {
      logger.warn('daily-record', `POST /daily-records - missing pregnancy_id`);
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    // 注：record_date 已在上方经过三层容错处理（缺失→今天 / 格式异常→解析修复 / 解析失败→强制今天）
    // 此处不再二次调用 isValidDate 校验（该函数在某些环境下可能误判合法日期如 "2026-06-14"）

    const existing = db.queryOne(
      'SELECT id FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, record_date]
    );

    if (existing) {
      logger.info('daily-record', `POST /daily-records - existing record found (id=${existing.id}), checking updates`);
      const updates = [];
      const params = [];

      const fields = ['weight', 'fetal_heart_rate', 'body_temperature', 'bust', 'waist', 'hip',
                      'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
                      'mood', 'mood_note', 'stool', 'stool_record', 'note',
                      'blood_pressure_systolic', 'blood_pressure_diastolic',
                      'sleep_hours', 'sleep_quality', 'symptoms', 'exercise_type',
                      'exercise_duration', 'diet_note', 'medication',
                      'edema_level', 'vaginal_discharge', 'skin_condition', 'urination_frequency',
                      'hcg_value', 'hcg_weeks', 'uric_acid', 'uric_acid_period', 'supplement_record', 'intimacy_note', 'intimacy_record',
                      'plan_text', 'plan_date', 'is_plan_done', 'water_intake', 'habit_text',
                      'contraction_count', 'contraction_interval', 'contraction_duration', 'contraction_pain',
                      'fetal_movement_count', 'fetal_movement_duration'];
 
      for (const field of fields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
 
      if (updates.length === 0) {
        logger.info('daily-record', `POST /daily-records - no fields to update for existing record`);
        return res.json({ code: 0, data: shape(existing), message: 'success' });
      }
 
      updates.push("updated_at = datetime('now')");
      params.push(existing.id);
 
      logger.info('daily-record', `POST /daily-records - updating ${updates.length} fields: ${updates.map(u => u.split('=')[0].trim()).join(', ')}`);
      db.run(`UPDATE daily_record SET ${updates.join(', ')} WHERE id = ?`, params);
 
      const updated = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [existing.id]);
      logger.info('daily-record', `POST /daily-records - record updated successfully (id=${existing.id})`);
      return res.json({ code: 0, data: shape(updated), message: 'success' });
    }

    const id = db.generateId();
    logger.info('daily-record', `POST /daily-records - inserting new record (id=${id})`);
    // ⚠️ 列顺序 === 参数顺序，且占位符由列名数组自动生成。
    // 历史坑：此处原为手写的 50 个 `?` 配上 51 个列名，SQLite 直接报
    // "50 values for 51 columns"，导致【所有】日常记录都写不进去（含新增的 waist 腰围），
    // 而接口仍返回 HTTP 200，前端只看到"保存失败"。改成自动生成 + 数量自检后不会再犯。
    const INSERT_COLUMNS = [
      'id', 'pregnancy_id', 'record_date',
      'weight', 'fetal_heart_rate', 'body_temperature', 'bust', 'waist', 'hip',
      'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
      'mood', 'mood_note', 'stool', 'stool_record', 'note',
      'blood_pressure_systolic', 'blood_pressure_diastolic',
      'sleep_hours', 'sleep_quality', 'symptoms',
      'exercise_type', 'exercise_duration',
      'diet_note', 'medication',
      'edema_level', 'vaginal_discharge', 'skin_condition',
      'urination_frequency',
      'hcg_value', 'hcg_weeks',
      'uric_acid', 'uric_acid_period',
      'supplement_record',
      'intimacy_note',
      'plan_text', 'plan_date',
      'is_plan_done',
      'water_intake',
      'habit_text',
      'contraction_count', 'contraction_interval', 'contraction_duration', 'contraction_pain',
      'fetal_movement_count', 'fetal_movement_duration',
      'intimacy_record',
    ];
    const insertParams = [
      id, pregnancy_id, record_date,
      req.body.weight ?? null, req.body.fetal_heart_rate ?? null, req.body.body_temperature ?? null, req.body.bust ?? null, req.body.waist ?? null, req.body.hip ?? null,
      req.body.blood_glucose_fasting ?? null, req.body.blood_glucose_1h ?? null, req.body.blood_glucose_2h ?? null,
      req.body.mood ?? null, req.body.mood_note || null, req.body.stool || null, req.body.stool_record || null, req.body.note || null,
      req.body.blood_pressure_systolic ?? null, req.body.blood_pressure_diastolic ?? null,
      req.body.sleep_hours ?? null, req.body.sleep_quality ?? null, req.body.symptoms || null,
      req.body.exercise_type || null, req.body.exercise_duration ?? null,
      req.body.diet_note || null, req.body.medication || null,
      req.body.edema_level || null, req.body.vaginal_discharge || null, req.body.skin_condition || null,
      req.body.urination_frequency ?? null,
      req.body.hcg_value ?? null, req.body.hcg_weeks ?? null,
      req.body.uric_acid ?? null, req.body.uric_acid_period || null,
      req.body.supplement_record || null,
      req.body.intimacy_note || null,
      req.body.plan_text || null, req.body.plan_date || null,
      req.body.is_plan_done ?? null,
      req.body.water_intake ?? null,
      req.body.habit_text || null,
      req.body.contraction_count ?? null, req.body.contraction_interval ?? null, req.body.contraction_duration ?? null, req.body.contraction_pain || null,
      req.body.fetal_movement_count ?? null, req.body.fetal_movement_duration ?? null,
      req.body.intimacy_record || null,
    ];
    // 自检：列数与参数个数不一致时立刻抛错（暴露问题），而不是发出非法 SQL 静默失败
    if (INSERT_COLUMNS.length !== insertParams.length) {
      throw new Error(`daily_record 插入字段数不匹配: columns=${INSERT_COLUMNS.length}, values=${insertParams.length}`);
    }
    db.run(
      `INSERT INTO daily_record (${INSERT_COLUMNS.join(', ')}) VALUES (${INSERT_COLUMNS.map(() => '?').join(', ')})`,
      insertParams
    );
    // 记录INSERT参数中非null字段数（用于验证数据是否正确传入）
    const nonNullCount = insertParams.filter(p => p != null).length;
    logger.info('daily-record', `POST /daily-records - INSERT执行完成 id=${id}, 非null参数=${nonNullCount}/${INSERT_COLUMNS.length}`);

    const record = db.queryOne('SELECT * FROM daily_record WHERE id = ?', [id]);
    logger.info('daily-record', `POST /daily-records - 新记录插入成功 (id=${id})`);
    res.json({ code: 0, data: shape(record), message: 'success' });
  } catch (e) {
    // 错误时记录完整上下文（请求体关键字段 + SQL错误信息）
    const errFields = Object.keys(req.body).filter(k => req.body[k] != null);
    logger.error('daily-record', `POST /daily-records 异常: ${e.message}, bodyKeys=[${errFields.join(',')}], record_date=${JSON.stringify(req.body.record_date)}, stack=${(e.stack||'').substring(0,200)}`);
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

    if (start_date && !config.isValidDate(start_date)) {
      return res.json({ code: 1001, data: null, message: 'start_date 格式无效，应为 YYYY-MM-DD' });
    }
    if (end_date && !config.isValidDate(end_date)) {
      return res.json({ code: 1001, data: null, message: 'end_date 格式无效，应为 YYYY-MM-DD' });
    }
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
      data: { items: shapeList(records), list: shapeList(records), total: total.count, page: parseInt(page), page_size: limit },
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
    res.json({ code: 0, data: shape(record), message: 'success' });
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
    res.json({ code: 0, data: shape(record), message: 'success' });
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

    const fields = ['weight', 'fetal_heart_rate', 'body_temperature', 'bust', 'waist', 'hip',
                    'blood_glucose_fasting', 'blood_glucose_1h', 'blood_glucose_2h',
                    'mood', 'mood_note', 'stool', 'stool_record', 'note',
                    'blood_pressure_systolic', 'blood_pressure_diastolic',
                    'sleep_hours', 'sleep_quality', 'symptoms', 'exercise_type',
                    'exercise_duration', 'diet_note', 'medication',
                    'edema_level', 'vaginal_discharge', 'skin_condition', 'urination_frequency',
                    'hcg_value', 'hcg_weeks', 'uric_acid', 'uric_acid_period', 'supplement_record', 'intimacy_note', 'intimacy_record',
                    'plan_text', 'plan_date', 'is_plan_done', 'water_intake', 'habit_text',
                    'contraction_count', 'contraction_interval', 'contraction_duration', 'contraction_pain',
                    'fetal_movement_count', 'fetal_movement_duration'];

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
    res.json({ code: 0, data: shape(updated), message: 'success' });
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
