const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');
const gestationalCalc = require('../services/gestational-calculator');

router.post('/pregnancies', (req, res) => {
  try {
    const { last_period_date, conception_date, due_date, baby_name } = req.body;
    logger.info('pregnancy', `POST /pregnancies - last_period_date=${last_period_date}, conception_date=${conception_date}, due_date=${due_date}`);

    if (!last_period_date && !conception_date && !due_date) {
      return res.json({ code: 1001, data: null, message: '必须提供 last_period_date、conception_date 或 due_date 之一' });
    }

    let lmp, calculatedDueDate;

    if (last_period_date) {
      lmp = last_period_date;
      calculatedDueDate = gestationalCalc.calculateDueDateFromLmp(last_period_date);
    } else if (conception_date) {
      lmp = gestationalCalc.calculateLmpFromDueDate(
        gestationalCalc.calculateDueDateFromConception(conception_date)
      );
      calculatedDueDate = gestationalCalc.calculateDueDateFromConception(conception_date);
    } else if (due_date) {
      lmp = gestationalCalc.calculateLmpFromDueDate(due_date);
      calculatedDueDate = due_date;
    }

    const id = db.generateId();
    db.run(
      `INSERT INTO pregnancy (id, last_period_date, conception_date, due_date, baby_name, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, lmp, conception_date || null, calculatedDueDate, baby_name || null]
    );

    const pregnancy = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [id]);
    logger.info('pregnancy', `POST /pregnancies - created id=${id}`, { id });
    res.json({ code: 0, data: pregnancy, message: 'success' });
  } catch (e) {
    logger.error('pregnancy', `POST /pregnancies error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies', (req, res) => {
  try {
    const pregnancies = db.queryAll('SELECT * FROM pregnancy ORDER BY created_at DESC');
    logger.info('pregnancy', `GET /pregnancies - returned ${pregnancies.length} records`);
    res.json({ code: 0, data: pregnancies, message: 'success' });
  } catch (e) {
    logger.error('pregnancy', `GET /pregnancies error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies/active', (req, res) => {
  try {
    const active = db.queryOne('SELECT * FROM pregnancy WHERE is_active = 1 LIMIT 1');
    if (!active) {
      logger.warn('pregnancy', 'GET /pregnancies/active - no active pregnancy found');
      return res.json({ code: 1001, data: null, message: '没有活跃的孕期档案' });
    }
    logger.info('pregnancy', `GET /pregnancies/active - found id=${active.id}`, { id: active.id });
    res.json({ code: 0, data: active, message: 'success' });
  } catch (e) {
    logger.error('pregnancy', `GET /pregnancies/active error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies/active/gestational-age', (req, res) => {
  try {
    const active = db.queryOne('SELECT * FROM pregnancy WHERE is_active = 1 LIMIT 1');
    if (!active) {
      logger.warn('pregnancy', 'GET /pregnancies/active/gestational-age - no active pregnancy found');
      return res.json({ code: 1001, data: null, message: '没有活跃的孕期档案' });
    }

    const ga = gestationalCalc.calculateGestationalAge(active.last_period_date);
    const trimester = gestationalCalc.getTrimester(ga.weeks);
    const daysUntil = gestationalCalc.daysUntilDue(active.due_date);

    logger.info('pregnancy', `GET /pregnancies/active/gestational-age - weeks=${ga.weeks}+${ga.days}, trimester=${trimester}`, { id: active.id });
    res.json({
      code: 0,
      data: {
        weeks: ga.weeks,
        days: ga.days,
        total_days: ga.total_days,
        due_date: active.due_date,
        days_until_due: daysUntil,
        trimester
      },
      message: 'success'
    });
  } catch (e) {
    logger.error('pregnancy', `GET /pregnancies/active/gestational-age error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies/:id', (req, res) => {
  try {
    const id = req.params.id;
    logger.info('pregnancy', `GET /pregnancies/${id}`, { id });
    const pregnancy = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [id]);
    if (!pregnancy) {
      logger.warn('pregnancy', `GET /pregnancies/${id} - not found`);
      return res.json({ code: 1001, data: null, message: '孕期档案不存在' });
    }
    res.json({ code: 0, data: pregnancy, message: 'success' });
  } catch (e) {
    logger.error('pregnancy', `GET /pregnancies/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/pregnancies/:id', (req, res) => {
  try {
    const id = req.params.id;
    logger.info('pregnancy', `PUT /pregnancies/${id} - fields=${Object.keys(req.body).join(',')}`, { id });
    const existing = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [id]);
    if (!existing) {
      logger.warn('pregnancy', `PUT /pregnancies/${id} - not found`);
      return res.json({ code: 1001, data: null, message: '孕期档案不存在' });
    }

    const { last_period_date, conception_date, due_date, baby_name, is_active } = req.body;
    let updates = [];
    let params = [];

    if (baby_name !== undefined) {
      updates.push('baby_name = ?');
      params.push(baby_name);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (last_period_date !== undefined) {
      updates.push('last_period_date = ?');
      params.push(last_period_date);
      const newDue = gestationalCalc.calculateDueDateFromLmp(last_period_date);
      updates.push('due_date = ?');
      params.push(newDue);
    } else if (conception_date !== undefined) {
      updates.push('conception_date = ?');
      params.push(conception_date);
      const newDue = gestationalCalc.calculateDueDateFromConception(conception_date);
      updates.push('due_date = ?');
      params.push(newDue);
      const newLmp = gestationalCalc.calculateLmpFromDueDate(newDue);
      updates.push('last_period_date = ?');
      params.push(newLmp);
    } else if (due_date !== undefined) {
      updates.push('due_date = ?');
      params.push(due_date);
      const newLmp = gestationalCalc.calculateLmpFromDueDate(due_date);
      updates.push('last_period_date = ?');
      params.push(newLmp);
    }

    if (updates.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    db.run(`UPDATE pregnancy SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [id]);
    logger.info('pregnancy', `PUT /pregnancies/${id} - updated successfully`, { id });
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    logger.error('pregnancy', `PUT /pregnancies/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/pregnancies/:id/activate', async (req, res) => {
  try {
    const id = req.params.id;
    logger.info('pregnancy', `PUT /pregnancies/${id}/activate`, { id });
    const existing = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [id]);
    if (!existing) {
      logger.warn('pregnancy', `PUT /pregnancies/${id}/activate - not found`);
      return res.json({ code: 1001, data: null, message: '孕期档案不存在' });
    }

    await db.run(`UPDATE pregnancy SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = CASE WHEN id = ? THEN datetime('now') ELSE updated_at END`, [id, id]);

    const activated = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [id]);
    logger.info('pregnancy', `PUT /pregnancies/${id}/activate - activated`, { id });
    res.json({ code: 0, data: activated, message: 'success' });
  } catch (e) {
    logger.error('pregnancy', `PUT /pregnancies/:id/activate error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
