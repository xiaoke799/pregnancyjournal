const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');

function _determineStatus(value, reference_min, reference_max) {
  const numValue = parseFloat(value);
  if (reference_min !== null && reference_min !== undefined && numValue < parseFloat(reference_min)) return 'low';
  if (reference_max !== null && reference_max !== undefined && numValue > parseFloat(reference_max)) return 'high';
  return 'normal';
}

router.post('/lab-results', async (req, res) => {
  try {
    const { checkup_id, category, item_name, value, unit, reference_min, reference_max } = req.body;
    if (!checkup_id || !category || !item_name || value === undefined) {
      return res.json({ code: 1001, data: null, message: '缺少必填字段: checkup_id, category, item_name, value' });
    }
    const status = _determineStatus(value, reference_min, reference_max);
    const id = db.generateId();
    await db.run(
      `INSERT INTO lab_result (id, checkup_id, category, item_name, value, unit, reference_min, reference_max, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, checkup_id, category, item_name, value, unit || null, reference_min || null, reference_max || null, status]
    );
    const row = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/lab-results', async (req, res) => {
  try {
    const { checkup_id, category } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (checkup_id) { where += ' AND lr.checkup_id = ?'; params.push(checkup_id); }
    if (category) { where += ' AND lr.category = ?'; params.push(category); }
    const rows = await db.queryAll(
      `SELECT lr.* FROM lab_result lr ${where} ORDER BY lr.created_at DESC`,
      params
    );
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/lab-results/trend', async (req, res) => {
  try {
    const { category, item_name, pregnancy_id } = req.query;
    if (!category || !item_name || !pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少必填参数: category, item_name, pregnancy_id' });
    }
    const rows = await db.queryAll(
      `SELECT lr.*, pc.gestational_week, pc.checkup_date
       FROM lab_result lr
       JOIN prenatal_checkup pc ON lr.checkup_id = pc.id
       WHERE lr.category = ? AND lr.item_name = ? AND pc.pregnancy_id = ?
       ORDER BY pc.checkup_date ASC`,
      [category, item_name, pregnancy_id]
    );
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/lab_results/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '记录不存在' });
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/lab_results/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM lab_result WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    const fields = ['checkup_id', 'category', 'item_name', 'value', 'unit', 'reference_min', 'reference_max'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (req.body.value !== undefined || req.body.reference_min !== undefined || req.body.reference_max !== undefined) {
      const current = await db.queryOne('SELECT value, reference_min, reference_max FROM lab_result WHERE id = ?', [req.params.id]);
      const val = req.body.value !== undefined ? req.body.value : current.value;
      const rMin = req.body.reference_min !== undefined ? req.body.reference_min : current.reference_min;
      const rMax = req.body.reference_max !== undefined ? req.body.reference_max : current.reference_max;
      sets.push(`status = ?`);
      params.push(_determineStatus(val, rMin, rMax));
    }
    sets.push("updated_at = datetime('now')");
    params.push(req.params.id);
    await db.run(`UPDATE lab_result SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT * FROM lab_result WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/lab_results/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM lab_result WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '记录不存在' });
    await db.run('DELETE FROM lab_result WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
