const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');

const DEFAULT_CHECKLISTS = [
  { type: 'delivery_room', name: '产房清单', file: 'default_checklist_delivery_room.json' },
  { type: 'hospital', name: '住院清单', file: 'default_checklist_hospital.json' },
  { type: 'confinement', name: '月子清单', file: 'default_checklist_confinement.json' }
];

const DEFAULT_TYPE_SET = new Set(DEFAULT_CHECKLISTS.map(c => c.type));

function _loadDefaultItems(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const items = [];
  let sortOrder = 0;

  if (Array.isArray(data.groups)) {
    for (const group of data.groups) {
      const prefix = group.label || (group.target === 'baby' ? '👶 宝宝' : '👩 妈妈');
      for (const cat of (group.categories || [])) {
        const categoryName = cat.category ? `${prefix}·${cat.category}` : prefix;
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
    }
  } else {
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
  }
  return items;
}

function _syncMandatoryFlags(checklistId, defaultItems) {
  const existingItems = db.queryAll(
    'SELECT id, name, is_mandatory FROM checklist_item WHERE checklist_id = ? AND is_custom = 0',
    [checklistId]
  );
  const mandatoryByName = new Map(defaultItems.map(i => [i.name, i.is_mandatory]));
  let updated = 0;
  for (const item of existingItems) {
    const shouldBe = mandatoryByName.has(item.name) ? mandatoryByName.get(item.name) : 0;
    if ((item.is_mandatory || 0) !== shouldBe) {
      db.run('UPDATE checklist_item SET is_mandatory = ? WHERE id = ?', [shouldBe, item.id]);
      updated++;
    }
  }
  return updated;
}

function _ensureDefaultChecklists(pregnancyId) {
  const existing = db.queryAll(
    'SELECT c.id, c.type, (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id) as item_count FROM checklist c WHERE c.pregnancy_id = ?',
    [pregnancyId]
  );

  const keptExisting = [];
  for (const cl of existing) {
    if (DEFAULT_TYPE_SET.has(cl.type)) {
      keptExisting.push(cl);
      continue;
    }
    const hasCustom = db.queryOne(
      'SELECT COUNT(*) as cnt FROM checklist_item WHERE checklist_id = ? AND is_custom = 1',
      [cl.id]
    );
    if (hasCustom && hasCustom.cnt > 0) {
      logger.info('checklist', `_ensureDefaultChecklists - keeping stale checklist ${cl.id} (has custom items)`);
      keptExisting.push(cl);
    } else {
      db.run('DELETE FROM checklist WHERE id = ?', [cl.id]);
      logger.info('checklist', `_ensureDefaultChecklists - removed stale checklist ${cl.id}`);
    }
  }

  const existingByType = new Map(keptExisting.map(cl => [cl.type, cl]));
  let createdCount = 0;
  let reseededCount = 0;
  let syncedCount = 0;

  for (const cl of DEFAULT_CHECKLISTS) {
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

    const existed = existingByType.get(cl.type);
    if (existed) {
      if ((existed.item_count || 0) > 0) {
        const updated = _syncMandatoryFlags(existed.id, items);
        if (updated > 0) {
          logger.info('checklist', `_ensureDefaultChecklists - synced ${updated} mandatory flags for "${cl.name}"`);
          syncedCount += updated;
        }
        continue;
      }
      items.forEach((item) => {
        const itemId = db.generateId();
        db.run(
          `INSERT INTO checklist_item (id, checklist_id, name, description, category, is_checked, is_custom, is_mandatory, sort_order)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
          [itemId, existed.id, item.name, item.description, item.category, item.is_mandatory, item.sort_order]
        );
      });
      logger.info('checklist', `_ensureDefaultChecklists - reseeded "${cl.name}" with ${items.length} items for pregnancy_id=${pregnancyId}`);
      reseededCount++;
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

  if (createdCount > 0 || reseededCount > 0 || syncedCount > 0) {
    logger.info('checklist', `_ensureDefaultChecklists - created ${createdCount}, reseeded ${reseededCount}, synced ${syncedCount} mandatory flags for pregnancy_id=${pregnancyId}`);
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

    const checklists = db.queryAll(
      `SELECT c.id, c.name, c.type,
              (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id) as total,
              (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id AND is_checked = 1) as checked,
              (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id AND is_mandatory = 1) as mandatory_total,
              (SELECT COUNT(*) FROM checklist_item WHERE checklist_id = c.id AND is_mandatory = 1 AND is_checked = 1) as mandatory_checked
       FROM checklist c
       WHERE c.pregnancy_id = ?
       ORDER BY c.created_at`,
      [pregnancy_id]
    );

    let totalItems = 0;
    let checkedItems = 0;
    let mandatoryTotal = 0;
    let mandatoryChecked = 0;
    const list = [];

    for (const cl of checklists) {
      const t = cl.total || 0;
      const ck = cl.checked || 0;
      const mt = cl.mandatory_total || 0;
      const mc = cl.mandatory_checked || 0;
      totalItems += t;
      checkedItems += ck;
      mandatoryTotal += mt;
      mandatoryChecked += mc;
      list.push({
        id: cl.id,
        name: cl.name,
        type: cl.type,
        total: t,
        checked: ck,
        mandatory_total: mt,
        mandatory_checked: mc,
        percentage: t > 0 ? Math.round((ck / t) * 100) : 0,
        mandatory_percentage: mt > 0 ? Math.round((mc / mt) * 100) : 0
      });
    }

    logger.info('checklist', `GET /checklists/progress - ${list.length} checklists, mandatory=${mandatoryChecked}/${mandatoryTotal}, total=${checkedItems}/${totalItems}`);
    res.json({
      code: 0,
      data: {
        total: totalItems,
        checked: checkedItems,
        percentage: totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0,
        mandatory_total: mandatoryTotal,
        mandatory_checked: mandatoryChecked,
        mandatory_percentage: mandatoryTotal > 0 ? Math.round((mandatoryChecked / mandatoryTotal) * 100) : 0,
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

router.delete('/checklists/:id', (req, res) => {
  try {
    logger.info('checklist', `DELETE /checklists/${req.params.id}`);
    const existing = db.queryOne('SELECT * FROM checklist WHERE id = ?', [req.params.id]);
    if (!existing) {
      logger.warn('checklist', `DELETE /checklists/${req.params.id} - not found`);
      return res.json({ code: 1001, data: null, message: '清单不存在' });
    }
    // 先删除关联条目（外键级联删除，但显式执行更安全）
    db.run('DELETE FROM checklist_item WHERE checklist_id = ?', [req.params.id]);
    db.run('DELETE FROM checklist WHERE id = ?', [req.params.id]);
    logger.info('checklist', `DELETE /checklists/${req.params.id} - deleted`);
    res.json({ code: 0, data: null, message: '删除成功' });
  } catch (e) {
    logger.error('checklist', `DELETE /checklists/:id error: ${e.message}`);
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

    // 仅删除非自定义条目，保留用户手动添加的自定义物品
    db.run('DELETE FROM checklist_item WHERE checklist_id = ? AND is_custom = 0', [req.params.id]);

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

// 确保默认清单已初始化（供前端首次加载时显式调用）
router.post('/checklists/ensure-defaults', (req, res) => {
  try {
    const { pregnancy_id } = req.body;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: 'pregnancy_id 为必填项' });
    }
    _ensureDefaultChecklists(pregnancy_id);
    res.json({ code: 0, data: null, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
