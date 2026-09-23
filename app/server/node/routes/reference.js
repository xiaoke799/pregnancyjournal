const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');

function _loadJson(filename) {
  const filePath = path.join(config.DATA_DIR, filename);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
    const data = _loadJson('food_safety.json');
    if (!data) {
      return res.json({ code: 1001, data: null, message: '食材安全数据不存在' });
    }

    if (keyword) {
      const results = [];
      const searchLower = keyword.toLowerCase();

      if (Array.isArray(data)) {
        data.forEach(item => {
          if ((item.name && item.name.toLowerCase().includes(searchLower)) ||
            (item.category && item.category.toLowerCase().includes(searchLower))) {
            results.push(item);
          }
        });
      } else if (data.items && Array.isArray(data.items)) {
        data.items.forEach(item => {
          if ((item.name && item.name.toLowerCase().includes(searchLower))) {
            results.push(item);
          }
        });
      }

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
