const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');

let _recipesCache = null;
let _foodSafetyCache = null;

function _weekToStage(week) {
  if (week <= 0) return 'preparing';
  if (week <= 12) return 'early';
  if (week <= 27) return 'mid';
  return 'late';
}

function _convertSafetyToByStage(safety) {
  const mapping = {
    safe:     { preparing: 'safe', early: 'safe', mid: 'safe', late: 'safe', nursing: 'safe' },
    caution:  { preparing: 'safe', early: 'caution', mid: 'caution', late: 'caution', nursing: 'safe' },
    avoid:    { preparing: 'caution', early: 'unsafe', mid: 'caution', late: 'caution', nursing: 'caution' },
    limit:    { preparing: 'limit', early: 'limit', mid: 'limit', late: 'limit', nursing: 'limit' },
  };
  return mapping[safety] || mapping.caution;
}

function loadRecipes() {
  if (_recipesCache) return _recipesCache;
  const filePath = path.join(config.DATA_DIR, 'recipes.json');
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    _recipesCache = Array.isArray(raw) ? raw : (raw.recipes || []);
  } else {
    _recipesCache = [];
  }
  return _recipesCache;
}

function loadFoodSafety() {
  if (_foodSafetyCache) return _foodSafetyCache;
  const filePath = path.join(config.DATA_DIR, 'food_safety_v3.json');
  if (fs.existsSync(filePath)) {
    _foodSafetyCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else {
    _foodSafetyCache = { categories: [] };
  }
  return _foodSafetyCache;
}

router.get('/diet/recipes', (req, res) => {
  try {
    const recipesData = loadRecipes();
    const allParam = req.query.all === 'true' || req.query.all === '1';

    if (allParam) {
      return res.json({ code: 0, data: recipesData, message: 'success' });
    }

    const week = parseInt(req.query.week) || 0;
    const stage = _weekToStage(week);

    const filteredRecipes = recipesData.filter(recipe => {
      const suitableWeeks = recipe.suitable_weeks || [0, 42];
      if (Array.isArray(suitableWeeks) && suitableWeeks.length >= 2) {
        if (week < suitableWeeks[0] || week > suitableWeeks[1]) return false;
      }
      const suitableStage = recipe.suitable_stage || [];
      if (Array.isArray(suitableStage) && !suitableStage.includes(stage)) return false;
      return true;
    });

    res.json({ code: 0, data: filteredRecipes, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/diet/spin', (req, res) => {
  try {
    const body = req.body || {};
    const week = parseInt(req.query.week) || parseInt(body.week) || 0;
    const stage = _weekToStage(week);
    const recipesData = loadRecipes();

    const candidates = recipesData.filter(recipe => {
      const suitableWeeks = recipe.suitable_weeks || [0, 42];
      if (Array.isArray(suitableWeeks) && suitableWeeks.length >= 2) {
        if (week < suitableWeeks[0] || week > suitableWeeks[1]) return false;
      }
      const suitableStage = recipe.suitable_stage || [];
      if (Array.isArray(suitableStage) && !suitableStage.includes(stage)) return false;
      return true;
    });

    if (candidates.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有匹配的食谱' });
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    res.json({ code: 0, data: candidates[randomIndex], message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/diet/food-safety', (req, res) => {
  try {
    const category = req.query.category;
    const foodSafetyData = loadFoodSafety();
    const allCategories = foodSafetyData.categories || [];

    if (category) {
      const cat = allCategories.find(c => c.name === category);
      if (!cat) {
        return res.json({ code: 1001, data: null, message: '未找到该分类' });
      }
      const itemsWithStage = (cat.items || []).map(item => ({
        name: item.name,
        safety_by_stage: item.safety_by_stage || _convertSafetyToByStage(item.safety),
        note: item.note || '',
        image: item.image || null,
      }));
      return res.json({
        code: 0,
        data: [{ name: cat.name, icon: cat.icon, items: itemsWithStage }],
        message: 'success'
      });
    }

    const result = allCategories.map(cat => ({
      name: cat.name,
      icon: cat.icon,
      items: (cat.items || []).map(item => ({
        name: item.name,
        safety_by_stage: item.safety_by_stage || _convertSafetyToByStage(item.safety),
        note: item.note || '',
        image: item.image || null,
      })),
    }));

    res.json({ code: 0, data: result, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/diet/food-safety/search', (req, res) => {
  try {
    const keyword = (req.query.keyword || '').trim();
    if (!keyword) {
      return res.json({ code: 1001, data: null, message: '请输入搜索关键词' });
    }

    const foodSafetyData = loadFoodSafety();
    const results = [];

    (foodSafetyData.categories || []).forEach(cat => {
      (cat.items || []).forEach(item => {
        if ((item.name || '').includes(keyword) || (item.note || '').includes(keyword)) {
          results.push({
            name: item.name,
            safety_by_stage: item.safety_by_stage || _convertSafetyToByStage(item.safety),
            note: item.note || '',
            image: item.image || null,
          });
        }
      });
    });

    res.json({ code: 0, data: results, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
