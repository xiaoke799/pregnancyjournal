const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

let _recipesCache = null;
let _foodSafetyCache = null;

function _weekToStage(week) {
  if (week <= 0) return 'preparing';
  if (week <= 13) return 'early';
  if (week <= 27) return 'mid';
  if (week <= 42) return 'late';
  return 'nursing';
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
  logger.info('diet', `loadRecipes - loading from ${filePath}`);
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    _recipesCache = Array.isArray(raw) ? raw : (raw.recipes || []);
    logger.info('diet', `loadRecipes - loaded ${_recipesCache.length} recipes`);
  } else {
    logger.warn('diet', `loadRecipes - file not found at ${filePath}`);
    _recipesCache = [];
  }
  return _recipesCache;
}

function loadFoodSafety() {
  if (_foodSafetyCache) return _foodSafetyCache;
  const filePath = path.join(config.DATA_DIR, 'food_safety_v3.json');
  logger.info('diet', `loadFoodSafety - loading from ${filePath}`);
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Normalize malformed categories data: some categories have {name, icon, items: [...]}
    // while others are flattened as {name, safety, note, safety_by_stage} directly in the array
    const rawCategories = raw.categories || [];
    logger.info('diet', `loadFoodSafety - raw categories count: ${rawCategories.length}`);
    const normalized = [];
    let currentCategory = null;

    for (const entry of rawCategories) {
      // If it has "items" array or has "icon", it's a proper category header
      if (entry.icon || (entry.items && Array.isArray(entry.items))) {
        if (currentCategory) normalized.push(currentCategory);
        currentCategory = {
          name: entry.name,
          icon: entry.icon || '🍽️',
          items: entry.items || [],
        };
      } else if (entry.name) {
        // Flattened item - belongs to current category
        if (!currentCategory) {
          currentCategory = { name: '其他', icon: '🍽️', items: [] };
        }
        currentCategory.items.push({
          name: entry.name,
          safety: entry.safety || 'caution',
          note: entry.note || '',
          safety_by_stage: entry.safety_by_stage || null,
        });
      }
    }
    if (currentCategory) normalized.push(currentCategory);

    // Also ensure each item has safety_by_stage
    for (const cat of normalized) {
      for (const item of cat.items) {
        if (!item.safety_by_stage && item.safety) {
          item.safety_by_stage = _convertSafetyToByStage(item.safety);
        }
      }
    }

    const totalItems = normalized.reduce((sum, cat) => sum + cat.items.length, 0);
    logger.info('diet', `loadFoodSafety - normalized: ${normalized.length} categories, ${totalItems} total items`);
    _foodSafetyCache = { categories: normalized };
  } else {
    logger.warn('diet', `loadFoodSafety - file not found at ${filePath}`);
    _foodSafetyCache = { categories: [] };
  }
  return _foodSafetyCache;
}

router.get('/diet/recipes', (req, res) => {
  try {
    const recipesData = loadRecipes();
    const allParam = req.query.all === 'true' || req.query.all === '1';

    if (allParam) {
      logger.info('diet', `GET /recipes - returning all ${recipesData.length} recipes`);
      return res.json({ code: 0, data: recipesData, message: 'success' });
    }

    const week = parseInt(req.query.week) || 0;
    const stage = _weekToStage(week);
    logger.info('diet', `GET /recipes - week=${week}, stage=${stage}, total recipes=${recipesData.length}`);

    const filteredRecipes = recipesData.filter(recipe => {
      const suitableWeeks = recipe.suitable_weeks || [0, 42];
      if (Array.isArray(suitableWeeks) && suitableWeeks.length >= 2) {
        if (week < suitableWeeks[0] || week > suitableWeeks[1]) return false;
      }
      const suitableStage = recipe.suitable_stage || [];
      if (Array.isArray(suitableStage) && !suitableStage.includes(stage)) return false;
      return true;
    });

    logger.info('diet', `GET /recipes - filtered to ${filteredRecipes.length} recipes for stage=${stage}`);
    res.json({ code: 0, data: filteredRecipes, message: 'success' });
  } catch (error) {
    logger.error('diet', `GET /recipes error: ${error.message}`);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/diet/spin', (req, res) => {
  try {
    const body = req.body || {};
    const week = parseInt(req.query.week) || parseInt(body.week) || 0;
    const stage = _weekToStage(week);
    const recipesData = loadRecipes();
    logger.info('diet', `POST /spin - week=${week}, stage=${stage}`);

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
      logger.warn('diet', `POST /spin - no matching recipes for week=${week}, stage=${stage}`);
      return res.json({ code: 1001, data: null, message: '没有匹配的食谱' });
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    logger.info('diet', `POST /spin - selected recipe "${candidates[randomIndex].name}" from ${candidates.length} candidates`);
    res.json({ code: 0, data: candidates[randomIndex], message: 'success' });
  } catch (error) {
    logger.error('diet', `POST /spin error: ${error.message}`);
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
