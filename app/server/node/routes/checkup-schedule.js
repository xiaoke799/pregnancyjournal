const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

// 产检时间表：唯一数据源 = 随包发布的只读资源 checkup_schedule.json（config.ASSETS_DIR）
// 原内嵌 DEFAULT_SCHEDULE 数组已移除，改为读该文件；产检页 / 首页 / 推送 / 导出 共用此一份。
const fs = require('fs');
const path = require('path');
const config = require('../config');

let _scheduleCache = null;
let _scheduleMtime = -1;
function getSchedule() {
  try {
    const jsonPath = path.join(config.ASSETS_DIR, 'checkup_schedule.json');
    const mtime = fs.existsSync(jsonPath) ? fs.statSync(jsonPath).mtimeMs : 0;
    if (_scheduleCache && _scheduleMtime === mtime) return _scheduleCache;
    const list = mtime ? JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) : [];
    _scheduleCache = Array.isArray(list) ? list : [];
    _scheduleMtime = mtime;
    return _scheduleCache;
  } catch (e) {
    logger.error('checkup-schedule', 'load checkup_schedule.json failed', e);
    return _scheduleCache || [];
  }
}

// 本地日期统一由 config.localToday() 提供（唯一实现，避免各处再写一份）。
// ⚠️ 不能用 new Date().toISOString().split('T')[0] —— 那是 UTC，东八区 00:00~08:00 会差一天，
// 会导致「前端按本地算的完成日期」与「后端记录里的完成日期」对不上。

router.get('/checkup-schedule/completed-weeks', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `GET /completed-weeks - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'GET /completed-weeks - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }
    const completedCheckups = await db.queryAll(
      'SELECT gestational_week FROM prenatal_checkup WHERE pregnancy_id = ? AND is_completed = 1',
      [pregnancy_id]
    );
    logger.info('checkup-schedule', `GET /completed-weeks - found ${completedCheckups.length} completed weeks`);
    res.json({
      code: 0,
      data: completedCheckups.map(c => c.gestational_week),
      message: 'success'
    });
  } catch (error) {
    logger.error('checkup-schedule', 'GET /completed-weeks error', error);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/checkup-schedule', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `GET /checkup-schedule - pregnancy_id=${pregnancy_id}`);
    const schedule = getSchedule();

    // ⚠️ 未传 pregnancy_id（用户还没建档/还没选孕期）时也返回排期本体，
    // 只是不带完成状态 —— 保证产检页在任何情况下都有内容，不会白屏/空白。
    if (!pregnancy_id) {
      const plain = schedule.map(item => ({ ...item, is_completed: false, is_recommended: true, completed_at: null }));
      logger.info('checkup-schedule', `GET /checkup-schedule - no pregnancy_id, returned ${plain.length} items (no status)`);
      return res.json({ code: 0, data: plain, message: 'success' });
    }

    // 完成判定取【周区间命中】∪【条目 id 命中】两条口径，互为兜底：
    //   - 周区间命中：老口径，兼容用户在产检页外自行添加的记录；
    //   - 条目 id 命中：从 notes 里的 [cs_00X] 标记取（那条标记正是「标记完成」的去重键）。
    // 之所以要加第二条：排期孕周若发生调整（如 cs_001 早孕检查由第 5 周校正为第 6 周），
    // 老记录写入的 gestational_week 可能已不在新区间内，但标记本身仍明确指向同一条目。
    const completedCheckups = await db.queryAll(
      'SELECT gestational_week, notes, checkup_date FROM prenatal_checkup WHERE pregnancy_id = ? AND is_completed = 1',
      [pregnancy_id]
    );
    const completedWeeks = new Set(completedCheckups.map(c => c.gestational_week));
    const completedItemIds = new Set();
    const completedAtById = {};
    const MARK = '从产检时间表标记完成';
    for (const row of completedCheckups) {
      const notes = String((row && row.notes) || '');
      if (notes.indexOf(MARK) === -1) continue; // 只认「标记完成」产生的记录，避免误判用户自填备注
      const found = notes.match(/\[cs_[A-Za-z0-9_-]+\]/g) || [];
      const day = String((row && row.checkup_date) || '').slice(0, 10);
      for (const tag of found) {
        const id = tag.slice(1, -1);
        completedItemIds.add(id);
        // 实际完成日期：纯读取推导（不改写任何数据），同一项目有多条记录时取最早那次。
        // 老用户没手填过「完成日期」也能拿到真实完成时间 —— 就是当初点「标记完成」产生的记录日期。
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!completedAtById[id] || day < completedAtById[id])) {
          completedAtById[id] = day;
        }
      }
    }

    const itemsWithStatus = schedule.map(item => {
      const weekStart = item.week_start || 0;
      const weekEnd = item.week_end || item.week_start || 0;
      const hitByWeek = Array.from({ length: weekEnd - weekStart + 1 }, (_, i) => weekStart + i)
        .some(w => completedWeeks.has(w));
      const isCompleted = hitByWeek || completedItemIds.has(item.id);
      return {
        ...item,
        is_completed: isCompleted,
        is_recommended: !isCompleted,
        // 实际完成日期（YYYY-MM-DD），未完成/推导不出时为 null。前端优先用用户手填的「完成日期」。
        completed_at: completedAtById[item.id] || null,
      };
    });

    logger.info('checkup-schedule', `GET /checkup-schedule - returned ${itemsWithStatus.length} items`);
    res.json({ code: 0, data: itemsWithStatus, message: 'success' });
  } catch (error) {
    logger.error('checkup-schedule', 'GET /checkup-schedule error', error);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.put('/checkup-schedule/:item_id/complete', async (req, res) => {
  try {
    const { item_id } = req.params;
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `PUT /:item_id/complete - pregnancy_id=${pregnancy_id}, item_id=${item_id}`);

    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'PUT /:item_id/complete - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    // 检查是否已经标记过
    var existing = null;
    try {
      existing = db.queryOne(
        'SELECT id, is_completed FROM prenatal_checkup WHERE pregnancy_id = ? AND notes LIKE ? LIMIT 1',
        [pregnancy_id, '%从产检时间表标记完成%' + item_id + '%']
      );
    } catch (queryErr) {
      logger.error('checkup-schedule', 'PUT /:item_id/complete queryOne error', queryErr);
    }

    if (existing && existing.is_completed === 1) {
      logger.info('checkup-schedule', `PUT /:item_id/complete - already marked complete (id=${existing.id})`);
      return res.json({
        code: 0,
        data: { checkup_id: existing.id, item_id: item_id, is_completed: true, already_marked: true },
        message: '已标记完成'
      });
    }

    var schedule = getSchedule();
    var item = null;
    for (var si = 0; si < schedule.length; si++) {
      if (schedule[si].id === item_id) { item = schedule[si]; break; }
    }
    if (!item) {
      logger.warn('checkup-schedule', `PUT /:item_id/complete - item not found: ${item_id}`);
      return res.json({ code: 1001, data: null, message: '产检项目不存在: ' + item_id });
    }

    var weekStart = item.week_start || 0;
    var itemNames = [];
    var itemsArr = item.items || [];
    for (var ii = 0; ii < itemsArr.length; ii++) {
      var iname = typeof itemsArr[ii] === 'string' ? itemsArr[ii] : (itemsArr[ii].name || '');
      if (iname) itemNames.push(iname);
    }
    var itemNamesStr = itemNames.join(', ');
    var checkupId = existing ? existing.id : db.generateId();
    var nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (existing) {
      // 更新已有记录
      try {
        await db.run(
          'UPDATE prenatal_checkup SET is_completed = 1, updated_at = ? WHERE id = ?',
          [nowStr, checkupId]
        );
        logger.info('checkup-schedule', `PUT /:item_id/complete - updated existing record (id=${checkupId})`);
      } catch (updateErr) {
        logger.error('checkup-schedule', 'PUT /:item_id/complete update error', updateErr);
        return res.status(500).json({ code: 1001, data: null, message: '更新失败: ' + updateErr.message });
      }
    } else {
      // 新建记录 - 使用JS计算的日期避免sql.js兼容问题
      try {
        await db.run(
          "INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, gestational_day, checkup_type, notes, is_completed, is_recommended, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, 1, 1, ?, ?)",
          [
            checkupId,
            pregnancy_id,
            config.localToday(),
            weekStart,
            item.name || item.title || '',
            '从产检时间表标记完成: ' + itemNamesStr + ' [' + item_id + ']',
            nowStr,
            nowStr
          ]
        );
        logger.info('checkup-schedule', `PUT /:item_id/complete - inserted new record (id=${checkupId})`);
      } catch (insertErr) {
        logger.error('checkup-schedule', 'PUT /:item_id/complete insert error', insertErr);
        return res.status(500).json({ code: 1001, data: null, message: '插入失败: ' + insertErr.message });
      }
    }

    logger.info('checkup-schedule', `PUT /:item_id/complete - success, checkup_id=${checkupId}, item_id=${item_id}`);
    res.json({
      code: 0,
      data: { checkup_id: checkupId, item_id: item_id, is_completed: true },
      message: '标记完成成功'
    });
  } catch (error) {
    logger.error('checkup-schedule', 'PUT /:item_id/complete unexpected error', error);
    res.status(500).json({ code: 1001, data: null, message: error.message || '服务器内部错误' });
  }
});

// 取消完成（撤销「标记完成」，给误按兜底）
// 只回退【本应用「标记完成」自己产生的记录】——判定依据是 notes 里那句 MARK，
// 用户手动添加/自己写了备注的产检记录一律不碰，避免误删用户数据。
// 「标记完成」当时顺带写的完成日期也会一起清掉，但仅当它正好等于被撤销那条记录的日期
// （即确认是我们自动写的）；用户手填的完成日期保留不动。
router.delete('/checkup-schedule/:item_id/complete', async (req, res) => {
  try {
    const { item_id } = req.params;
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `DELETE /:item_id/complete - pregnancy_id=${pregnancy_id}, item_id=${item_id}`);

    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'DELETE /:item_id/complete - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const MARK = '从产检时间表标记完成';
    const completed = await db.queryAll(
      'SELECT id, checkup_date, notes, gestational_week FROM prenatal_checkup WHERE pregnancy_id = ? AND is_completed = 1',
      [pregnancy_id]
    );

    // 主口径：notes 里同时带 MARK 和 [本条目的 id] —— 就是「标记完成」写的那条
    const markerId = '[' + item_id + ']';
    let targets = completed.filter(r => {
      const n = String((r && r.notes) || '');
      return n.indexOf(MARK) !== -1 && n.indexOf(markerId) !== -1;
    });

    // 兜底口径：极早期版本写的记录可能没带 [cs_00X] 标记，只在孕周区间上命中。
    // 仍然要求带 MARK 字样（确认是本应用生成的），且不带动任何 [cs_xxx] 标记（否则属于别的条目）。
    if (!targets.length) {
      let item = null;
      try { item = getSchedule().find(s => s.id === item_id) || null; } catch (schedErr) {
        logger.warn('checkup-schedule', `DELETE /:item_id/complete - getSchedule failed: ${schedErr.message}`);
      }
      if (item) {
        const ws = item.week_start || 0;
        const we = item.week_end || item.week_start || 0;
        targets = completed.filter(r => {
          const n = String((r && r.notes) || '');
          if (n.indexOf(MARK) === -1) return false;
          if (/\[cs_[A-Za-z0-9_-]+\]/.test(n)) return false;
          const w = Number(r && r.gestational_week);
          return Number.isFinite(w) && w >= ws && w <= we;
        });
      }
    }

    if (!targets.length) {
      logger.info('checkup-schedule', `DELETE /:item_id/complete - no app-generated record to undo for ${item_id}`);
      return res.json({
        code: 0,
        data: { item_id, is_completed: false, changed: 0, date_cleared: null, reason: 'not_found' },
        message: '没有可取消的完成记录'
      });
    }

    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    for (const t of targets) {
      await db.run('UPDATE prenatal_checkup SET is_completed = 0, updated_at = ? WHERE id = ?', [nowStr, t.id]);
    }

    // 清「标记完成」顺带写的完成日期（仅当它等于被撤销记录的日期）
    let dateCleared = null;
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS schedule_dates (
          pregnancy_id TEXT NOT NULL,
          schedule_id TEXT NOT NULL,
          checkup_date TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (pregnancy_id, schedule_id),
          FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
        )
      `);
      const autoDays = new Set(targets.map(t => String((t && t.checkup_date) || '').slice(0, 10)));
      const sd = await db.queryOne(
        'SELECT checkup_date FROM schedule_dates WHERE pregnancy_id = ? AND schedule_id = ?',
        [pregnancy_id, item_id]
      );
      if (sd && autoDays.has(String(sd.checkup_date || '').slice(0, 10))) {
        await db.run('DELETE FROM schedule_dates WHERE pregnancy_id = ? AND schedule_id = ?', [pregnancy_id, item_id]);
        dateCleared = String(sd.checkup_date).slice(0, 10);
      }
    } catch (dateErr) {
      logger.warn('checkup-schedule', `DELETE /:item_id/complete - clear schedule_date failed: ${dateErr.message}`);
    }

    logger.info('checkup-schedule', `DELETE /:item_id/complete - undone ${targets.length} record(s), date_cleared=${dateCleared}`);
    res.json({
      code: 0,
      data: { item_id, is_completed: false, changed: targets.length, date_cleared: dateCleared },
      message: '已取消完成'
    });
  } catch (error) {
    logger.error('checkup-schedule', 'DELETE /:item_id/complete unexpected error', error);
    res.status(500).json({ code: 1001, data: null, message: error.message || '服务器内部错误' });
  }
});

// 设置产检实际完成日期
router.post('/checkup-schedule/schedule-date', async (req, res) => {
  try {
    const { pregnancy_id, schedule_id, date } = req.body;
    logger.info('checkup-schedule', `POST /schedule-date - pregnancy_id=${pregnancy_id}, schedule_id=${schedule_id}, date=${date}`);
    if (!pregnancy_id || !schedule_id || !date) {
      logger.warn('checkup-schedule', 'POST /schedule-date - missing required params');
      return res.json({ code: 1001, data: null, message: '参数缺失' });
    }

    // 确保 schedule_dates 表存在
    await db.run(`
      CREATE TABLE IF NOT EXISTS schedule_dates (
        pregnancy_id TEXT NOT NULL,
        schedule_id TEXT NOT NULL,
        checkup_date TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (pregnancy_id, schedule_id),
        FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
      )
    `);

    // upsert
    await db.run(
      `INSERT INTO schedule_dates (pregnancy_id, schedule_id, checkup_date)
       VALUES (?, ?, ?)
       ON CONFLICT(pregnancy_id, schedule_id) DO UPDATE SET checkup_date = excluded.checkup_date, updated_at = datetime('now')`,
      [pregnancy_id, schedule_id, date]
    );

    logger.info('checkup-schedule', `POST /schedule-date - success, schedule_id=${schedule_id}, date=${date}`);
    res.json({ code: 0, data: { schedule_id, date }, message: '设置成功' });
  } catch (error) {
    logger.error('checkup-schedule', 'POST /schedule-date error', error);
    res.json({ code: 1002, data: null, message: error.message });
  }
});

// 获取所有已设置的产检日期
router.get('/checkup-schedule/dates', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `GET /dates - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'GET /dates - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    }

    const rows = await db.queryAll(
      'SELECT schedule_id, checkup_date FROM schedule_dates WHERE pregnancy_id = ?',
      [pregnancy_id]
    );

    const dates = {};
    for (const row of rows) {
      dates[row.schedule_id] = row.checkup_date;
    }

    logger.info('checkup-schedule', `GET /dates - returned ${rows.length} dates`);
    res.json({ code: 0, data: dates });
  } catch (error) {
    logger.error('checkup-schedule', 'GET /dates error', error);
    res.json({ code: 1002, data: null, message: error.message });
  }
});

module.exports = router;
