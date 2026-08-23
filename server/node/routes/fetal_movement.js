const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');

router.post('/fetal-movements/sessions', async (req, res) => {
  try {
    const { pregnancy_id, session_date, start_time } = req.body;
    if (!pregnancy_id) return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    const now = new Date();
    const dateStr = session_date || now.toISOString().slice(0, 10);
    const timeStr = start_time || now.toTimeString().slice(0, 8);
    const id = db.generateId();
    await db.run(
      `INSERT INTO fetal_movement_session (id, pregnancy_id, session_date, start_time, end_time, total_count, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, datetime('now'))`,
      [id, pregnancy_id, dateStr, timeStr]
    );
    const row = await db.queryOne('SELECT * FROM fetal_movement_session WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/fetal-movements/sessions', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    const rows = await db.queryAll(`SELECT * FROM fetal_movement_session ${where} ORDER BY session_date DESC, start_time DESC`, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/fetal-movements/sessions/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM fetal_movement_session WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '会话不存在' });
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/fetal-movements/sessions/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM fetal_movement_session WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const now = new Date().toTimeString().slice(0, 8);
    const countResult = await db.queryOne(
      `SELECT COUNT(*) as count FROM fetal_movement WHERE session_id = ?`,
      [req.params.id]
    );
    const total_count = countResult.count;
    await db.run(
      `UPDATE fetal_movement_session SET end_time = ?, total_count = ? WHERE id = ?`,
      [now, total_count, req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM fetal_movement_session WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/fetal-movements/sessions/:id/kicks', async (req, res) => {
  try {
    const session = await db.queryOne('SELECT * FROM fetal_movement_session WHERE id = ?', [req.params.id]);
    if (!session) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const timestamp = new Date().toISOString();
    const id = db.generateId();
    await db.run(
      `INSERT INTO fetal_movement (id, session_id, timestamp, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [id, req.params.id, timestamp]
    );
    await db.run(
      `UPDATE fetal_movement_session SET total_count = total_count + 1 WHERE id = ?`,
      [req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM fetal_movement WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/fetal-movements/sessions/:id/kicks', async (req, res) => {
  try {
    const rows = await db.queryAll(
      `SELECT * FROM fetal_movement WHERE session_id = ? ORDER BY timestamp ASC`,
      [req.params.id]
    );
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
