const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');

router.post('/contractions/sessions', async (req, res) => {
  try {
    const { pregnancy_id, session_date, start_time } = req.body;
    if (!pregnancy_id) return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    const now = new Date();
    const dateStr = session_date || now.toISOString().slice(0, 10);
    const timeStr = start_time || now.toTimeString().slice(0, 8);
    const id = db.generateId();
    await db.run(
      `INSERT INTO contraction_session (id, pregnancy_id, session_date, start_time, end_time, total_count, avg_duration, avg_interval, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, NULL, NULL, datetime('now'))`,
      [id, pregnancy_id, dateStr, timeStr]
    );
    const row = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    const rows = await db.queryAll(`SELECT * FROM contraction_session ${where} ORDER BY session_date DESC, start_time DESC`, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '会话不存在' });
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/contractions/sessions/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const now = new Date().toTimeString().slice(0, 8);
    const contractions = await db.queryAll(
      `SELECT * FROM contraction WHERE session_id = ? ORDER BY start_time ASC`,
      [req.params.id]
    );
    const total_count = contractions.length;
    let total_duration = 0;
    let total_interval = 0;
    let interval_count = 0;
    for (let i = 0; i < contractions.length; i++) {
      const c = contractions[i];
      if (c.start_time && c.end_time) {
        const start = new Date(`2000-01-01 ${c.start_time}`);
        const end = new Date(`2000-01-01 ${c.end_time}`);
        total_duration += (end - start) / 1000;
      }
      if (i > 0 && c.interval_from_prev !== null) {
        total_interval += c.interval_from_prev;
        interval_count++;
      }
    }
    const avg_duration = total_count > 0 ? Math.round(total_duration / total_count) : null;
    const avg_interval = interval_count > 0 ? Math.round(total_interval / interval_count) : null;
    await db.run(
      `UPDATE contraction_session SET end_time = ?, total_count = ?, avg_duration = ?, avg_interval = ? WHERE id = ?`,
      [now, total_count, avg_duration, avg_interval, req.params.id]
    );
    const row = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/contractions/sessions/:id/contractions', async (req, res) => {
  try {
    const { action, start_time, end_time } = req.body;
    const session = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!session) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const now = new Date().toTimeString().slice(0, 8);
    if (action === 'start') {
      const activeContraction = await db.queryOne(
        `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [req.params.id]
      );
      if (activeContraction) {
        await db.run('UPDATE contraction SET end_time = ? WHERE id = ?', [now, activeContraction.id]);
        if (activeContraction.start_time) {
          const s = new Date(`2000-01-01 ${activeContraction.start_time}`);
          const e = new Date(`2000-01-01 ${now}`);
          const duration = Math.round((e - s) / 1000);
          await db.run('UPDATE contraction SET duration = ? WHERE id = ?', [duration, activeContraction.id]);
        }
      }
      const lastContraction = await db.queryOne(
        `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NOT NULL ORDER BY start_time DESC LIMIT 1`,
        [req.params.id]
      );
      let interval_from_prev = null;
      if (lastContraction && lastContraction.end_time) {
        const prevEnd = new Date(`2000-01-01 ${lastContraction.end_time}`);
        const currStart = new Date(`2000-01-01 ${now}`);
        interval_from_prev = Math.round((currStart - prevEnd) / 1000);
      }
      const id = db.generateId();
      await db.run(
        `INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
        [id, req.params.id, start_time || now, interval_from_prev]
      );
      const row = await db.queryOne('SELECT * FROM contraction WHERE id = ?', [id]);
      res.json({ code: 0, data: row, message: 'success' });
    } else if (action === 'end') {
      const activeContraction = await db.queryOne(
        `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [req.params.id]
      );
      if (!activeContraction) return res.json({ code: 1001, data: null, message: '没有进行中的宫缩' });
      const endTime = end_time || now;
      await db.run('UPDATE contraction SET end_time = ? WHERE id = ?', [endTime, activeContraction.id]);
      if (activeContraction.start_time) {
        const s = new Date(`2000-01-01 ${activeContraction.start_time}`);
        const e = new Date(`2000-01-01 ${endTime}`);
        const duration = Math.round((e - s) / 1000);
        await db.run('UPDATE contraction SET duration = ? WHERE id = ?', [duration, activeContraction.id]);
      }
      const row = await db.queryOne('SELECT * FROM contraction WHERE id = ?', [activeContraction.id]);
      res.json({ code: 0, data: row, message: 'success' });
    } else if (action === 'manual') {
      if (!start_time || !end_time) return res.json({ code: 1001, data: null, message: '手动模式需要start_time和end_time' });
      const s = new Date(`2000-01-01 ${start_time}`);
      const e = new Date(`2000-01-01 ${end_time}`);
      const duration = Math.round((e - s) / 1000);
      const lastContraction = await db.queryOne(
        `SELECT * FROM contraction WHERE session_id = ? ORDER BY start_time DESC LIMIT 1`,
        [req.params.id]
      );
      let interval_from_prev = null;
      if (lastContraction && lastContraction.end_time) {
        const prevEnd = new Date(`2000-01-01 ${lastContraction.end_time}`);
        interval_from_prev = Math.round((s - prevEnd) / 1000);
      }
      const id = db.generateId();
      await db.run(
        `INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [id, req.params.id, start_time, end_time, duration, interval_from_prev]
      );
      const row = await db.queryOne('SELECT * FROM contraction WHERE id = ?', [id]);
      res.json({ code: 0, data: row, message: 'success' });
    } else {
      res.json({ code: 1001, data: null, message: '无效的action，支持: start/end/manual' });
    }
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions/:id/contractions', async (req, res) => {
  try {
    const rows = await db.queryAll(
      `SELECT * FROM contraction WHERE session_id = ? ORDER BY start_time ASC`,
      [req.params.id]
    );
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions/:id/analysis', async (req, res) => {
  try {
    const session = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!session) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const contractions = await db.queryAll(
      `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NOT NULL ORDER BY start_time ASC`,
      [req.params.id]
    );
    const total_count = contractions.length;
    let total_duration = 0;
    let total_interval = 0;
    let interval_count = 0;
    for (let i = 0; i < contractions.length; i++) {
      const c = contractions[i];
      if (c.duration) total_duration += c.duration;
      if (c.interval_from_prev !== null) { total_interval += c.interval_from_prev; interval_count++; }
    }
    const avg_duration = total_count > 0 ? Math.round(total_duration / total_count) : 0;
    const avg_interval = interval_count > 0 ? Math.round(total_interval / interval_count) : 0;
    const oneHourAgo = Date.now() - 3600000;
    const sessionDate = session.session_date;
    const sessionStartTs = session.start_time
      ? new Date(sessionDate + 'T' + session.start_time).getTime()
      : null;
    const last_hour_contractions = contractions.filter(c => {
      if (!c.start_time) return false;
      let ts = new Date(sessionDate + 'T' + c.start_time).getTime();
      // 处理跨午夜：若宫缩时间早于会话开始时间，说明已跨到次日
      if (sessionStartTs !== null && ts < sessionStartTs) {
        ts += 24 * 60 * 60 * 1000;
      }
      return ts >= oneHourAgo;
    });
    const last_hour_count = last_hour_contractions.length;
    let is_511_met = false;
    if (last_hour_count >= 12) {
      const allLongEnough = last_hour_contractions.every(c => c.duration >= 60);
      is_511_met = allLongEnough;
    }
    let recommendation = '';
    if (is_511_met) {
      recommendation = '已满足5-1-1规则（每5分钟1次宫缩，持续1小时以上，每次持续超过1分钟），建议立即前往医院待产。';
    } else if (avg_interval > 0 && avg_interval <= 300 && last_hour_count >= 6) {
      recommendation = '宫缩频率较高，正在接近5-1-1规则，请密切观察并做好前往医院的准备。';
    } else if (total_count >= 3 && avg_duration >= 30) {
      recommendation = '宫缩已经开始规律出现，但尚未达到5-1-1标准，请继续观察宫缩变化趋势。';
    } else if (total_count > 0) {
      recommendation = '目前宫缩尚不规律或频率较低，继续在家休息观察即可。';
    } else {
      recommendation = '暂无足够数据进行5-1-1规则分析，请继续记录宫缩情况。';
    }
    res.json({
      code: 0,
      data: {
        session_id: req.params.id,
        total_count,
        avg_duration,
        avg_interval,
        last_hour_count,
        is_511_met,
        recommendation
      },
      message: 'success'
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
