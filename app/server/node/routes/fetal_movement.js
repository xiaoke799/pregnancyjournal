const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const rollup = require('../services/daily-rollup');

router.post('/fetal-movements/sessions', async (req, res) => {
  try {
    const { pregnancy_id, session_date, start_time } = req.body;
    if (!pregnancy_id) return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    const now = new Date();
    // 用本地日期：toISOString 是 UTC，东八区凌晨会把会话记成前一天
    const dateStr = session_date || config.localToday(now);
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
    const { pregnancy_id, date } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    // 记录页按「某一天」取会话明细，用它展示当天数了几次、各多少次
    if (date) { where += ' AND session_date = ?'; params.push(date); }
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
    // 「结束计数」= 这次胎动记录真正生效的时刻：把当天所有会话汇总写回 daily_record，
    // 否则记录列表 / 统计 / CSV（都只读 daily_record）永远看不到计数器的成果。
    // 会话明细仍在 fetal_movement(_session) 表里，一条不动 —— 同一天数几次都留痕。
    rollup.syncFetalMovement(existing.pregnancy_id, existing.session_date);
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
    // 走 db 的事务辅助（而不是裸 BEGIN）：这样模块内的落盘能感知到事务开着，
    // 不会在事务中间导出、把这次写入静默回滚掉。
    db.beginTransaction();
    await db.run(
      `INSERT INTO fetal_movement (id, session_id, timestamp, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [id, req.params.id, timestamp]
    );
    await db.run(
      `UPDATE fetal_movement_session SET total_count = total_count + 1 WHERE id = ?`,
      [req.params.id]
    );
    db.commitTransaction();
    // 每按一次胎动就同步一次汇总。
    // 为什么不能只靠「结束计数」那一处回调：用户数到一半直接关掉应用 / 切走不点结束，
    // 这次计数就永远写不回 daily_record（记录列表/统计/首页都看不到）——
    // 那正是「没联动」最痛的一条。放在 commit 之后是为了：即便汇总失败，
    // 这一次胎动已经落库，绝不会被一起回滚。
    rollup.syncFetalMovement(session.pregnancy_id, session.session_date);
    const row = await db.queryOne('SELECT * FROM fetal_movement WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    db.rollbackTransaction();
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
