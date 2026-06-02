const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');

let _scheduleCache = null;

function _loadSchedule() {
  if (_scheduleCache) return _scheduleCache;
  const filePath = path.join(config.DATA_DIR, 'checkup_schedule.json');
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    _scheduleCache = Array.isArray(data) ? data : (data.items || []);
  } else {
    _scheduleCache = [];
  }
  return _scheduleCache;
}

router.get('/checkup-schedule', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const schedule = _loadSchedule();
    const completedCheckups = await db.queryAll(
      'SELECT gestational_week FROM prenatal_checkup WHERE pregnancy_id = ? AND is_completed = 1',
      [pregnancy_id]
    );
    const completedWeeks = new Set(completedCheckups.map(c => c.gestational_week));

    const itemsWithStatus = schedule.map(item => {
      const weekStart = item.week_start || 0;
      const weekEnd = item.week_end || item.week_start || 0;
      const isCompleted = Array.from({ length: weekEnd - weekStart + 1 }, (_, i) => weekStart + i)
        .some(w => completedWeeks.has(w));
      return {
        ...item,
        is_completed: isCompleted,
        is_recommended: !isCompleted,
      };
    });

    res.json({
      code: 0,
      data: itemsWithStatus,
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.put('/checkup-schedule/:item_id/complete', async (req, res) => {
  try {
    const { item_id } = req.params;
    const { pregnancy_id } = req.query;

    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const schedule = _loadSchedule();
    const item = schedule.find(i => i.id === item_id);
    if (!item) {
      return res.json({ code: 1001, data: null, message: '产检项目不存在' });
    }

    const checkupId = db.generateId();
    const weekStart = item.week_start || 0;
    const itemNames = (item.items || []).join(', ');
    await db.run(
      `INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, gestational_day, checkup_type, notes, is_completed, is_recommended, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, 1, 1, datetime('now'), datetime('now'))`,
      [
        checkupId,
        pregnancy_id,
        new Date().toISOString().split('T')[0],
        weekStart,
        item.name || item.title || '',
        `从产检时间表标记完成: ${itemNames}`,
      ]
    );

    res.json({
      code: 0,
      data: { checkup_id: checkupId, item_id, is_completed: true },
      message: '标记完成成功'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
