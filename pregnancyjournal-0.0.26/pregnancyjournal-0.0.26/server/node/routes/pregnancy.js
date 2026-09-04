const express = require('express');
const router = express.Router();
const db = require('../db');
const gestationalCalc = require('../services/gestational-calculator');

router.post('/pregnancies', (req, res) => {
  try {
    const { last_period_date, conception_date, due_date, baby_name } = req.body;

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
    res.json({ code: 0, data: pregnancy, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies', (req, res) => {
  try {
    const pregnancies = db.queryAll('SELECT * FROM pregnancy ORDER BY created_at DESC');
    res.json({ code: 0, data: pregnancies, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies/active', (req, res) => {
  try {
    const active = db.queryOne('SELECT * FROM pregnancy WHERE is_active = 1 LIMIT 1');
    if (!active) {
      return res.json({ code: 1001, data: null, message: '没有活跃的孕期档案' });
    }
    res.json({ code: 0, data: active, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies/active/gestational-age', (req, res) => {
  try {
    const active = db.queryOne('SELECT * FROM pregnancy WHERE is_active = 1 LIMIT 1');
    if (!active) {
      return res.json({ code: 1001, data: null, message: '没有活跃的孕期档案' });
    }

    const ga = gestationalCalc.calculateGestationalAge(active.last_period_date);
    const trimester = gestationalCalc.getTrimester(ga.weeks);
    const daysUntil = gestationalCalc.daysUntilDue(active.due_date);

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
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/pregnancies/:id', (req, res) => {
  try {
    const pregnancy = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [req.params.id]);
    if (!pregnancy) {
      return res.json({ code: 1001, data: null, message: '孕期档案不存在' });
    }
    res.json({ code: 0, data: pregnancy, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/pregnancies/:id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [req.params.id]);
    if (!existing) {
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
    params.push(req.params.id);

    db.run(`UPDATE pregnancy SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/pregnancies/:id/activate', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '孕期档案不存在' });
    }

    db.run("UPDATE pregnancy SET is_active = 0");
    db.run("UPDATE pregnancy SET is_active = 1, updated_at = datetime('now') WHERE id = ?", [req.params.id]);

    const activated = db.queryOne('SELECT * FROM pregnancy WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: activated, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
