const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');

router.post('/habit-checkins', async (req, res) => {
  try {
    const { pregnancy_id, date, items, note } = req.body;
    if (!pregnancy_id || !date) {
      return res.json({ code: 1001, data: null, message: '缺少必要参数pregnancy_id或date' });
    }

    const existing = await db.queryOne(
      'SELECT id FROM habit_checkin WHERE pregnancy_id = ? AND date = ?',
      [pregnancy_id, date]
    );

    const itemsJson = JSON.stringify(items || []);

    if (existing) {
      await db.run(
        'UPDATE habit_checkin SET items = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [itemsJson, note || '', existing.id]
      );
      res.json({ code: 0, data: { id: existing.id, updated: true }, message: '更新成功' });
    } else {
      const id = db.generateId();
      await db.run(
        'INSERT INTO habit_checkin (id, pregnancy_id, date, items, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [id, pregnancy_id, date, itemsJson, note || '']
      );
      res.json({ code: 0, data: { id, created: true }, message: '创建成功' });
    }
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/habit-checkins', async (req, res) => {
  try {
    const { pregnancy_id, start_date, end_date, page = 1, page_size = 20 } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const offset = (parseInt(page) - 1) * parseInt(page_size);
    let whereClause = 'WHERE pregnancy_id = ?';
    let params = [pregnancy_id];

    if (start_date) {
      whereClause += ' AND date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      whereClause += ' AND date <= ?';
      params.push(end_date);
    }

    const totalResult = await db.queryOne(
      `SELECT COUNT(*) as total FROM habit_checkin ${whereClause}`, params
    );
    const total = totalResult.total;

    const list = await db.queryAll(
      `SELECT * FROM habit_checkin ${whereClause} ORDER BY date DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(page_size), offset]
    );

    list.forEach(item => {
      if (typeof item.items === 'string') {
        try { item.items = JSON.parse(item.items); } catch (e) { item.items = []; }
      }
    });

    res.json({
      code: 0,
      data: {
        list,
        pagination: {
          page: parseInt(page),
          page_size: parseInt(page_size),
          total,
          total_pages: Math.ceil(total / parseInt(page_size))
        }
      },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/habit-checkins/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { pregnancy_id } = req.query;

    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const record = await db.queryOne(
      'SELECT * FROM habit_checkin WHERE pregnancy_id = ? AND date = ?',
      [pregnancy_id, date]
    );

    if (record && typeof record.items === 'string') {
      try { record.items = JSON.parse(record.items); } catch (e) { record.items = []; }
    }

    res.json({ code: 0, data: record || null, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/habit-checkins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const record = await db.queryOne('SELECT * FROM habit_checkin WHERE id = ?', [id]);

    if (!record) {
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    if (typeof record.items === 'string') {
      try { record.items = JSON.parse(record.items); } catch (e) { record.items = []; }
    }

    res.json({ code: 0, data: record, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.put('/habit-checkins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { items, note } = req.body;

    const existing = await db.queryOne('SELECT id FROM habit_checkin WHERE id = ?', [id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    const updates = [];
    const params = [];

    if (items !== undefined) {
      updates.push('items = ?');
      params.push(JSON.stringify(items));
    }
    if (note !== undefined) {
      updates.push('note = ?');
      params.push(note);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await db.run(`UPDATE habit_checkin SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ code: 0, data: { id, updated: true }, message: '更新成功' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.delete('/habit-checkins/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.queryOne('SELECT id FROM habit_checkin WHERE id = ?', [id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '记录不存在' });
    }

    await db.run('DELETE FROM habit_checkin WHERE id = ?', [id]);

    res.json({ code: 0, data: { id, deleted: true }, message: '删除成功' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
