const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');

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
  const existing = db.queryAll(
    'SELECT id, type FROM checklist WHERE pregnancy_id = ?',
    [pregnancyId]
  );

  const existingTypes = new Set(existing.map(cl => cl.type));
  let createdCount = 0;

  for (const cl of DEFAULT_CHECKLISTS) {
    if (existingTypes.has(cl.type)) continue;

    const filePath = path.join(config.DATA_DIR, cl.file);
    if (!fs.existsSync(filePath)) {
      logger.warn('checklist', `_ensureDefaultChecklists - file not found: ${cl.file}`);
      continue;
    }

    let items;
    try {
      items = _loadDefaultItems(filePath);
    } catch (e) {
      logger.warn('checklist', `Failed to load ${cl.file}: ${e.message}`);
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

    logger.info('checklist', `_ensureDefaultChecklists - created "${cl.name}" with ${items.length} items for pregnancy_id=${pregnancyId}`);
    createdCount++;
  }

  if (createdCount > 0) {
    logger.info('checklist', `_ensureDefaultChecklists - created ${createdCount} default checklists for pregnancy_id=${pregnancyId}`);
  }
}

router.get('/checklists/progress', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      logger.warn('checklist', 'GET /checklists/progress - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }
    logger.info('checklist', `GET /checklists/progress - pregnancy_id=${pregnancy_id}`);

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

    logger.info('checklist', `GET /checklists/progress - ${list.length} checklists, total=${totalItems}, checked=${checkedItems}`);
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
    logger.error('checklist', `GET /checklists/progress error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checklists', (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      logger.warn('checklist', 'GET /checklists - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }
    logger.info('checklist', `GET /checklists - pregnancy_id=${pregnancy_id}`);

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

    logger.info('checklist', `GET /checklists - ${checklists.length} checklists with items`);
    res.json({ code: 0, data: checklists, message: 'success' });
  } catch (e) {
    logger.error('checklist', `GET /checklists error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/checklists/:id', (req, res) => {
  try {
    logger.info('checklist', `GET /checklists/${req.params.id}`);
    const checklist = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!checklist) {
      logger.warn('checklist', `GET /checklists/${req.params.id} - not found`);
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    const items = db.queryAll(
      'SELECT * FROM checklist_item WHERE checklist_id = ? ORDER BY sort_order, created_at',
      [req.params.id]
    );

    logger.info('checklist', `GET /checklists/${req.params.id} - found, ${items.length} items`);
    res.json({ code: 0, data: { ...checklist, items }, message: 'success' });
  } catch (e) {
    logger.error('checklist', `GET /checklists/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checklists/:id', (req, res) => {
  try {
    logger.info('checklist', `PUT /checklists/${req.params.id} - name=${req.body.name}`);
    const existing = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!existing) {
      logger.warn('checklist', `PUT /checklists/${req.params.id} - not found`);
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    const { name } = req.body;
    if (!name) {
      return res.json({ code: 1001, data: null, message: 'name 为必填项' });
    }

    db.run("UPDATE checklist SET name = ? WHERE id = ?", [name, req.params.id]);

    const updated = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    logger.info('checklist', `PUT /checklists/${req.params.id} - updated`);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    logger.error('checklist', `PUT /checklists/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checklists/:id/items', (req, res) => {
  try {
    logger.info('checklist', `POST /checklists/${req.params.id}/items - name=${req.body.name}`);
    const existing = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!existing) {
      logger.warn('checklist', `POST /checklists/${req.params.id}/items - checklist not found`);
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
    logger.info('checklist', `POST /checklists/${req.params.id}/items - item created (id=${itemId})`);
    res.json({ code: 0, data: item, message: 'success' });
  } catch (e) {
    logger.error('checklist', `POST /checklists/:id/items error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/checklists/items/:item_id', (req, res) => {
  try {
    logger.info('checklist', `PUT /checklists/items/${req.params.item_id} - fields=${Object.keys(req.body).join(',')}`);
    const existing = db.queryOne('SELECT * FROM checklist_item WHERE id = ?', [req.params.item_id]);
    if (!existing) {
      logger.warn('checklist', `PUT /checklists/items/${req.params.item_id} - not found`);
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
    logger.info('checklist', `PUT /checklists/items/${req.params.item_id} - updated`);
    res.json({ code: 0, data: updated, message: 'success' });
  } catch (e) {
    logger.error('checklist', `PUT /checklists/items/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.delete('/checklists/items/:item_id', (req, res) => {
  try {
    logger.info('checklist', `DELETE /checklists/items/${req.params.item_id}`);
    const existing = db.queryOne('SELECT * FROM checklist_item WHERE id = ?', [req.params.item_id]);
    if (!existing) {
      logger.warn('checklist', `DELETE /checklists/items/${req.params.item_id} - not found`);
      return res.json({ code: 1001, data: null, message: '条目不存在' });
    }

    db.run('DELETE FROM checklist_item WHERE id = ?', [req.params.item_id]);
    logger.info('checklist', `DELETE /checklists/items/${req.params.item_id} - deleted`);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    logger.error('checklist', `DELETE /checklists/items/:id error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/checklists/:id/init-default', (req, res) => {
  try {
    logger.info('checklist', `POST /checklists/${req.params.id}/init-default`);
    const checklist = db.queryOne(
      'SELECT * FROM checklist WHERE id = ?',
      [req.params.id]
    );
    if (!checklist) {
      logger.warn('checklist', `POST /checklists/${req.params.id}/init-default - not found`);
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }

    db.run('DELETE FROM checklist_item WHERE checklist_id = ?', [req.params.id]);

    const defaultCl = DEFAULT_CHECKLISTS.find(c => c.type === checklist.type);
    if (!defaultCl) {
      logger.warn('checklist', `POST /checklists/${req.params.id}/init-default - no default config for type=${checklist.type}`);
      return res.json({ code: 1001, data: null, message: '未找到对应的默认配置' });
    }

    const filePath = path.join(config.DATA_DIR, defaultCl.file);
    if (!fs.existsSync(filePath)) {
      logger.warn('checklist', `POST /checklists/${req.params.id}/init-default - file not found: ${defaultCl.file}`);
      return res.json({ code: 1001, data: null, message: '默认配置文件不存在' });
    }

    let items;
    try {
      items = _loadDefaultItems(filePath);
    } catch (e) {
      logger.error('checklist', `POST /checklists/${req.params.id}/init-default - failed to load config: ${e.message}`);
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
    logger.info('checklist', `POST /checklists/${req.params.id}/init-default - restored ${refreshed.length} items`);
    res.json({ code: 0, data: { ...updatedChecklist, items: refreshed }, message: 'success' });
  } catch (e) {
    logger.error('checklist', `POST /checklists/:id/init-default error: ${e.message}`);
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
