const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

router.post('/reminders', (req, res) => {
  try {
    const { pregnancy_id, title, trigger_date, trigger_time, reminder_type,
            source_type, source_id, is_enabled, notes } = req.body;
    logger.info('reminder', `POST /reminders - title=${title}, trigger_date=${trigger_date}, pregnancy_id=${pregnancy_id}`);

    if (!pregnancy_id || !title) {
      logger.warn('reminder', 'POST /reminders - missing required fields: pregnancy_id or title');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 和 title 为必填项' });
    }

    const id = db.generateId();
    db.run(
      `INSERT INTO reminder (id, pregnancy_id, title, trigger_date, trigger_time,
       reminder_type, source_type, source_id, is_enabled, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, pregnancy_id, title, trigger_date || null, trigger_time || null,
       reminder_type || 'custom', source_type || null, source_id || null,
       is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1, notes || null]
    );

    const reminder = db.queryOne('SELECT * FROM reminder WHERE id = ?', [id]);
    logger.info('reminder', `POST /reminders - created id=${id}, title=${title}`);
    res.json({ code: 0, data: reminder, message: 'success' });
  } catch (e) {
    logger.error('reminder', 'POST /reminders error', e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/reminders', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    const reminders = db.queryAll(
      'SELECT * FROM reminder WHERE pregnancy_id = ? ORDER BY trigger_date ASC, trigger_time ASC',
      [pregnancy_id]
    );

    res.json({ code: 0, data: reminders, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/reminders/upcoming', (req, res) => {
  try {
    const { pregnancy_id, days = 7 } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));
    const futureStr = futureDate.toISOString().split('T')[0];

    const reminders = db.queryAll(
      `SELECT * FROM reminder
       WHERE pregnancy_id = ?
         AND is_enabled = 1
         AND (is_triggered = 0 OR is_triggered IS NULL)
         AND trigger_date >= ?
         AND trigger_date <= ?
       ORDER BY trigger_date ASC, trigger_time ASC`,
      [pregnancy_id, today, futureStr]
    );

    res.json({ code: 0, data: reminders, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/reminders/:id', (req, res) => {
  try {
    const reminder = db.queryOne('SELECT * FROM reminder WHERE id = ?', [req.params.id]);
    if (!reminder) {
      return res.json({ code: 1001, data: null, message: '提醒不存在' });
    }
    res.json({ code: 0, data: reminder, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/reminders/:id', (req, res) => {
  try {
    const id = req.params.id;
    logger.info('reminder', `PUT /reminders/${id} - fields=${Object.keys(req.body).join(',')}`);
    const existing = db.queryOne('SELECT * FROM reminder WHERE id = ?', [id]);
    if (!existing) {
      logger.warn('reminder', `PUT /reminders/${id} - reminder not found`);
      return res.json({ code: 1001, data: null, message: '提醒不存在' });
    }

    const updates = [];
    const params = [];

    const fields = ['title', 'trigger_date', 'trigger_time', 'reminder_type',
                    'source_type', 'source_id', 'is_enabled', 'is_completed',
                    'is_triggered', 'notes'];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'is_enabled' || field === 'is_completed' || field === 'is_triggered') {
          updates.push(`${field} = ?`);
          params.push(req.body[field] ? 1 : 0);
        } else {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
        }
      }
    }

    if (updates.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    db.run(`UPDATE reminder SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM reminder WHERE id = ?', [id]);
    logger.info('reminder', `PUT /reminders/${id} - updated ${updates.length} fields, is_completed=${updated?.is_completed}`);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    logger.error('reminder', `PUT /reminders/${req.params.id} error`, e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/reminders/:id', (req, res) => {
  try {
    const id = req.params.id;
    logger.info('reminder', `DELETE /reminders/${id}`);
    const existing = db.queryOne('SELECT * FROM reminder WHERE id = ?', [id]);
    if (!existing) {
      logger.warn('reminder', `DELETE /reminders/${id} - reminder not found`);
      return res.json({ code: 1001, data: null, message: '提醒不存在' });
    }

    db.run('DELETE FROM reminder WHERE id = ?', [id]);
    logger.info('reminder', `DELETE /reminders/${id} - deleted successfully, title=${existing.title}`);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    logger.error('reminder', `DELETE /reminders/${req.params.id} error`, e);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
