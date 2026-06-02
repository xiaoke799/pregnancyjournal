const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');

const DEFAULT_CHECKLISTS = [
  { type: 'delivery_bag', name: '待产包清单', file: 'default_checklist_delivery.json' },
  { type: 'newborn_prep', name: '新生儿准备清单', file: 'default_checklist_newborn.json' },
  { type: 'delivery_check', name: '产房待检清单', file: 'default_checklist_delivery_check.json' },
  { type: 'confinement', name: '月子物品清单', file: 'default_checklist_confinement.json' }
];

function _loadDefaultItems(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const items = [];
  let sortOrder = 0;
  const categories = data.categories || [];
  for (const cat of categories) {
    const categoryName = cat.category || '';
    for (const itemData of (cat.items || [])) {
      items.push({
        name: itemData.name || '',
        description: itemData.description || null,
        category: categoryName,
        is_mandatory: itemData.mandatory ? 1 : 0,
        sort_order: sortOrder++
      });
    }
  }
  return items;
}

function _ensureDefaultChecklists(pregnancyId) {
  const existing = db.queryOne(
    'SELECT COUNT(*) as count FROM checklist WHERE pregnancy_id = ?',
    [pregnancyId]
  );

  if (existing.count > 0) return;

  for (const cl of DEFAULT_CHECKLISTS) {
    const filePath = path.join(config.DATA_DIR, cl.file);
    if (!fs.existsSync(filePath)) continue;

    let items;
    try {
      items = _loadDefaultItems(filePath);
    } catch (e) {
      console.warn(`Failed to load ${cl.file}:`, e.message);
      continue;
    }

    const checklistId = db.generateId();
    db.run(
      'INSERT INTO checklist (id, pregnancy_id, type, name) VALUES (?, ?, ?, ?)',
      [checklistId, pregnancyId, cl.type, cl.name]
    );

    items.forEach((item) => {
      const itemId = db.generateId();
      db.run(
        `INSERT INTO checklist_item (id, checklist_id, name, description, category, is_checked, is_custom, is_mandatory, sort_order)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [itemId, checklistId, item.name, item.description, item.category, item.is_mandatory, item.sort_order]
      );
    });
  }
}

router.get('/checklists/progress', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    _ensureDefaultChecklists(pregnancy_id);

    const checklists = db.queryAll(
      `SELECT c.id, c.name, c.type,
              (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id) as total,
              (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id AND is_checked = 1) as checked
       FROM checklist c
       WHERE c.pregnancy_id = ?
       ORDER BY c.created_at`,
      [pregnancy_id]
    );

    let totalItems = 0;
    let checkedItems = 0;
    const list = [];

    for (const cl of checklists) {
      const t = cl.total || 0;
      const ck = cl.checked || 0;
      totalItems += t;
      checkedItems += ck;
      list.push({
        id: cl.id,
        name: cl.name,
        type: cl.type,
        total: t,
        checked: ck,
        percentage: t > 0 ? Math.round((ck / t) * 100) : 0
      });
    }

    res.json({
      code: 0,
      data: {
        total: totalItems,
        checked: checkedItems,
        percentage: totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0,
        checklists: list
      },
      message: 'success'
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checklists', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }

    _ensureDefaultChecklists(pregnancy_id);

    const checklists = db.queryAll(
      'SELECT * FROM checklist WHERE pregnancy_id = ? ORDER BY created_at',
      [pregnancy_id]
    );

    for (const cl of checklists) {
      cl.items = db.queryAll(
        'SELECT * FROM checklist_item WHERE checklist_id = ? ORDER BY sort_order',
        [cl.id]
      );
    }

    res.json({ code: 0, data: checklists, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checklists/:id', (req, res) => {
  try {
    const checklist = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!checklist) {
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    const items = db.queryAll(
      'SELECT * FROM checklist_item WHERE checklist_id = ? ORDER BY sort_order, created_at',
      [req.params.id]
    );

    res.json({ code: 0, data: { ...checklist, items }, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checklists/:id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    const { name } = req.body;
    if (!name) {
      return res.json({ code: 1001, data: null, message: 'name 为必填项' });
    }

    db.run("UPDATE checklist SET name = ? WHERE id = ?", [name, req.params.id]);

    const updated = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checklists/:id/items', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    const { name, description, category, is_custom, is_mandatory } = req.body;
    if (!name) {
      return res.json({ code: 1001, data: null, message: 'name 为必填项' });
    }

    const maxOrder = db.queryOne(
      'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM checklist_item WHERE checklist_id = ?',
      [req.params.id]
    );

    const itemId = db.generateId();
    db.run(
      `INSERT INTO checklist_item (id, checklist_id, name, description, category, is_checked, is_custom, is_mandatory, sort_order)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [itemId, req.params.id, name, description || null, category || '', is_custom ? 1 : 0, is_mandatory ? 1 : 0, maxOrder.max_order + 1]
    );

    const item = db.queryOne('SELECT * FROM checklist_item WHERE id = ?', [itemId]);
    res.json({ code: 0, data: item, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checklists/items/:item_id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM checklist_item WHERE id = ?', [req.params.item_id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '条目不存在' });
    }

    const updates = [];
    const params = [];

    if (req.body.name !== undefined) {
      updates.push('name = ?');
      params.push(req.body.name);
    }
    if (req.body.description !== undefined) {
      updates.push('description = ?');
      params.push(req.body.description);
    }
    if (req.body.is_checked !== undefined) {
      updates.push('is_checked = ?');
      params.push(req.body.is_checked ? 1 : 0);
    }
    if (req.body.is_mandatory !== undefined) {
      updates.push('is_mandatory = ?');
      params.push(req.body.is_mandatory ? 1 : 0);
    }
    if (req.body.category !== undefined) {
      updates.push('category = ?');
      params.push(req.body.category);
    }
    if (req.body.sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(req.body.sort_order);
    }

    if (updates.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有需要更新的字段' });
    }

    params.push(req.params.item_id);
    db.run(`UPDATE checklist_item SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = db.queryOne('SELECT * FROM checklist_item WHERE id = ?', [req.params.item_id]);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checklists/items/:item_id', (req, res) => {
  try {
    const existing = db.queryOne('SELECT * FROM checklist_item WHERE id = ?', [req.params.item_id]);
    if (!existing) {
      return res.json({ code: 1001, data: null, message: '条目不存在' });
    }

    db.run('DELETE FROM checklist_item WHERE id = ?', [req.params.item_id]);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checklists/:id/init-default', (req, res) => {
  try {
    const checklist = db.queryOne(
      'SELECT * FROM checklist WHERE id = ?',
      [req.params.id]
    );
    if (!checklist) {
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    db.run('DELETE FROM checklist_item WHERE checklist_id = ?', [req.params.id]);

    const defaultCl = DEFAULT_CHECKLISTS.find(c => c.type === checklist.type);
    if (!defaultCl) {
      return res.json({ code: 1001, data: null, message: '未找到对应的默认配置' });
    }

    const filePath = path.join(config.DATA_DIR, defaultCl.file);
    if (!fs.existsSync(filePath)) {
      return res.json({ code: 1001, data: null, message: '默认配置文件不存在' });
    }

    let items;
    try {
      items = _loadDefaultItems(filePath);
    } catch (e) {
      return res.json({ code: 1001, data: null, message: '读取默认配置失败: ' + e.message });
    }

    items.forEach((item) => {
      const itemId = db.generateId();
      db.run(
        `INSERT INTO checklist_item (id, checklist_id, name, description, category, is_checked, is_custom, is_mandatory, sort_order)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [itemId, req.params.id, item.name, item.description, item.category, item.is_mandatory, item.sort_order]
      );
    });

    const refreshed = db.queryAll(
      'SELECT * FROM checklist_item WHERE checklist_id = ? ORDER BY sort_order',
      [req.params.id]
    );

    const updatedChecklist = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: { ...updatedChecklist, items: refreshed }, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
