const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

router.post('/diaries', (req, res) => {
  try {
    const { pregnancy_id, entry_date, content, title } = req.body;
    logger.info('diary', `POST /diaries - pregnancy_id=${pregnancy_id}, entry_date=${entry_date}, title=${title || '(无)'}, content_len=${content?.length || 0}`);

    if (!pregnancy_id || !entry_date || !content) {
      logger.warn('diary', `POST /diaries - missing required fields: pregnancy_id=${pregnancy_id}, entry_date=${entry_date}, content=${!!content}`);
      return res.json({ code: 1001, data: null, message: 'pregnancy_id、entry_date、content 为必填项' });
    }

    const id = db.generateId();
    db.run(
      `INSERT INTO diary_entry (id, pregnancy_id, entry_date, gestational_week, title, content, mood, image_urls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, pregnancy_id, entry_date, req.body.gestational_week || 0, title || null, content, req.body.mood || null,
       Array.isArray(req.body.image_urls) ? JSON.stringify(req.body.image_urls) : (req.body.image_urls || null)]
    );

    const diary = db.queryOne('SELECT * FROM diary_entry WHERE id = ?', [id]);
    logger.info('diary', `POST /diaries - diary created (id=${id})`);
    res.json({ code: 0, data: diary, message: 'success' });
  } catch (e) {
    logger.error('diary', `POST /diaries error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/diaries', (req, res) => {
  try {
    const { pregnancy_id, start_date, end_date, page = 1, page_size = 20 } = req.query;
    logger.info('diary', `GET /diaries - pregnancy_id=${pregnancy_id}, date_range=[${start_date||'any'}~${end_date||'any'}], page=${page}`);

    if (!pregnancy_id) {
      logger.warn('diary', 'GET /diaries - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    let where = 'WHERE pregnancy_id = ?';
    const params = [pregnancy_id];

    if (start_date) {
      where += ' AND entry_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      where += ' AND entry_date <= ?';
      params.push(end_date);
    }

    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const limit = parseInt(page_size);

    const total = db.queryOne(`SELECT COUNT(*) as count FROM diary_entry ${where}`, params);
    const diaries = db.queryAll(
      `SELECT * FROM diary_entry ${where} ORDER BY entry_date DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    logger.info('diary', `GET /diaries - found ${diaries.length} diaries, total=${total.count}`);
    res.json({
      code: 0,
      data: { list: diaries, total: total.count, page: parseInt(page), page_size: limit },
      message: 'success'
    });
  } catch (e) {
    logger.error('diary', `GET /diaries error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

// 别名：兼容前端使用的 /daily-records/diaries 路径
router.get('/daily-records/diaries', (req, res) => {
  try {
    const { pregnancy_id, start_date, end_date, page = 1, page_size = 20 } = req.query;
    logger.info('diary', `GET /daily-records/diaries - pregnancy_id=${pregnancy_id}, date_range=[${start_date||'any'}~${end_date||'any'}], page=${page}`);
    if (!pregnancy_id) {
      logger.warn('diary', 'GET /daily-records/diaries - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }
    let where = 'WHERE pregnancy_id = ?';
    const params = [pregnancy_id];
    if (start_date) { where += ' AND entry_date >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND entry_date <= ?'; params.push(end_date); }
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const limit = parseInt(page_size);
    const total = db.queryOne(`SELECT COUNT(*) as count FROM diary_entry ${where}`, params);
    const diaries = db.queryAll(
      `SELECT * FROM diary_entry ${where} ORDER BY entry_date DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    logger.info('diary', `GET /daily-records/diaries - found ${diaries.length} diaries, total=${total.count}, normalizing fields`);
    // 兼容前端字段名
    const normalized = diaries.map(d => ({
      ...d,
      record_date: d.entry_date,
      note: d.content,
    }));
    res.json({
      code: 0,
      data: { items: normalized, list: normalized, total: total.count, page: parseInt(page), page_size: limit },
      message: 'success'
    });
  } catch (e) {
    logger.error('diary', `GET /daily-records/diaries error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/diaries/:id', (req, res) => {
  try {
    const diary = db.queryOne('SELECT * FROM diary_entry WHERE id = ?', [req.params.id]);
    if (!diary) {
      return res.json({ code: 1001, data: null, message: '日记不存在' });
    }
    res.json({ code: 0, data: diary, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/diaries/:id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM diary_entry WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '日记不存在' });
    }

    const updates = [];
    const params = [];

    const fields = ['pregnancy_id', 'entry_date', 'gestational_week', 'title', 'content', 'mood', 'image_urls'];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(field === 'image_urls' && Array.isArray(req.body[field])
          ? JSON.stringify(req.body[field]) : req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    db.run(`UPDATE diary_entry SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM diary_entry WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/diaries/:id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM diary_entry WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '日记不存在' });
    }

    db.run('DELETE FROM diary_entry WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
