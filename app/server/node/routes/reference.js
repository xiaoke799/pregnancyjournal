const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// ⚠️ 这些是**安装包自带的只读参考资料**，必须从 ASSETS_DIR（安装目录）读，
// 而不是 DATA_DIR（用户可写持久区）。此前写成 DATA_DIR，指向的是用户数据目录，
// 那里根本没有这些文件 ⇒ 所有 /reference/* 恒返回「数据不存在」。
// 参考真实文件清单见 ASSETS_DIR：food_safety_v3.json / recipes.json /
// checkup_schedule.json / checkup_subitem_aliases.json / default_checklist_*.json。
function _loadJson(filename) {
  const filePath = path.join(config.ASSETS_DIR, filename);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      // 只读资源损坏时给调用方一个明确的失败，而不是把整个路由炸掉
      logger.error('reference', `解析 ${filePath} 失败: ${e.message}`);
      return null;
    }
  }
  return null;
}

router.get('/reference/development/:week', (req, res) => {
  try {
    const week = parseInt(req.params.week);
    if (isNaN(week) || week < 1 || week > 42) {
      return res.json({ code: 1001, data: null, message: '孕周参数无效(1-42)' });
    }
    const data = _loadJson('fetal_development.json');
    if (!data || !data.weeks) {
      return res.json({ code: 1001, data: null, message: '发育数据文件不存在' });
    }
    const weekData = data.weeks.find(w => w.week === week);
    if (!weekData) {
      return res.json({ code: 1001, data: null, message: `未找到第${week}周的发育数据` });
    }
    res.json({ code: 0, data: weekData, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/reference/development', (req, res) => {
  try {
    const data = _loadJson('fetal_development.json');
    if (!data) {
      return res.json({ code: 0, data: { weeks: [] }, message: '暂无发育数据' });
    }
    res.json({ code: 0, data: data, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/reference/checkup-plan', (req, res) => {
  try {
    const data = _loadJson('checkup_standards.json');
    if (!data) {
      return res.json({ code: 1001, data: null, message: '产检标准数据不存在' });
    }
    res.json({ code: 0, data: data, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/reference/checkup-items/:type', (req, res) => {
  try {
    const type = req.params.type;
    const data = _loadJson('checkup_items_knowledge.json');
    if (!data) {
      return res.json({ code: 1001, data: null, message: '产检项目知识库不存在' });
    }
    if (type && data[type]) {
      return res.json({ code: 0, data: { type, items: data[type] }, message: 'success' });
    }
    if (type && !data[type]) {
      return res.json({ code: 1001, data: null, message: `未找到类型为${type}的产检项目` });
    }
    res.json({ code: 0, data: data, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/reference/ranges/:category', (req, res) => {
  try {
    const category = req.params.category;
    const data = _loadJson('reference_ranges.json');
    if (!data) {
      return res.json({ code: 1001, data: null, message: '参考范围数据不存在' });
    }
    if (category && data[category]) {
      return res.json({ code: 0, data: { category, ranges: data[category] }, message: 'success' });
    }
    if (category && !data[category]) {
      return res.json({ code: 1001, data: null, message: `未找到${category}的参考范围` });
    }
    res.json({ code: 0, data: data, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/reference/iom-weight', (req, res) => {
  try {
    const data = _loadJson('iom_weight_standards.json');
    if (!data) {
      return res.json({ code: 1001, data: null, message: 'IOM体重标准数据不存在' });
    }
    res.json({ code: 0, data: data, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/reference/food-safety', (req, res) => {
  try {
    const keyword = req.query.keyword;
    // ⚠️ 真实文件名是 food_safety_v3.json，此前写成 food_safety.json（该文件全仓不存在）。
    const data = _loadJson('food_safety_v3.json');
    if (!data) {
      return res.json({ code: 1001, data: null, message: '食材安全数据不存在' });
    }

    // 真实结构是 { metadata: {...}, categories: [{ name, icon, items: [{name, safety, note, aliases?}] }] }，
    // 不是顶层数组、也没有顶层 items 字段——原来的两条分支都匹配不上，搜索恒返回空。
    const categories = Array.isArray(data.categories) ? data.categories : [];

    if (keyword) {
      const searchLower = String(keyword).toLowerCase();
      const results = [];
      categories.forEach(cat => {
        const items = Array.isArray(cat.items) ? cat.items : [];
        items.forEach(item => {
          const name = String(item.name || '');
          const aliases = Array.isArray(item.aliases) ? item.aliases : [];
          const note = String(item.note || '');
          const hit =
            name.toLowerCase().includes(searchLower) ||
            aliases.some(a => String(a).toLowerCase().includes(searchLower)) ||
            note.toLowerCase().includes(searchLower) ||
            String(cat.name || '').toLowerCase().includes(searchLower);
          if (hit) {
            results.push({ ...item, category: cat.name, icon: cat.icon });
          }
        });
      });

      return res.json({
        code: 0,
        data: { keyword, results, count: results.length },
        message: 'success'
      });
    }

    res.json({ code: 0, data: data, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
