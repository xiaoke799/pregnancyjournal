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

  // 如果菜谱太少，补充默认菜谱
  if (_recipesCache.length < 30) {
    logger.info('diet', `Recipes too few (${_recipesCache.length}), adding defaults`);
    const defaultRecipes = [
      // 主食
      { id: 'def_01', name: '小米粥', category: '主食', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['小米'], nutrition: '富含维生素B、易消化', description: '养胃健脾，适合晨起' },
      { id: 'def_02', name: '杂粮饭', category: '主食', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['大米','糙米','燕麦'], nutrition: '膳食纤维丰富', description: '低GI，稳定血糖' },
      { id: 'def_03', name: '南瓜馒头', category: '主食', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['南瓜','面粉'], nutrition: 'β-胡萝卜素丰富', description: '天然甜味，松软可口' },
      { id: 'def_04', name: '红薯粥', category: '主食', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['红薯','大米'], nutrition: '膳食纤维、钾', description: '促进肠道蠕动' },
      { id: 'def_05', name: '青菜面条', category: '主食', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['面条','青菜'], nutrition: '维生素、碳水化合物', description: '清淡易消化' },
      { id: 'def_06', name: '玉米排骨汤', category: '主食', suitable_weeks: [0, 42], suitable_stage: ['early','mid','late'], ingredients: ['玉米','排骨'], nutrition: '钙、蛋白质', description: '补钙佳品' },
      { id: 'def_07', name: '燕麦牛奶粥', category: '早餐', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['燕麦','牛奶'], nutrition: '钙、蛋白质、膳食纤维', description: '早餐首选，营养全面' },
      { id: 'def_08', name: '蔬菜鸡蛋饼', category: '早餐', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['鸡蛋','面粉','青菜'], nutrition: '优质蛋白', description: '快手早餐，营养均衡' },
      { id: 'def_09', name: '豆浆油条', category: '早餐', suitable_weeks: [0, 13], suitable_stage: ['preparing','early'], ingredients: ['豆浆','油条'], nutrition: '植物蛋白', description: '经典搭配，孕早期开胃' },
      { id: 'def_10', name: '全麦面包', category: '早餐', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['全麦面粉'], nutrition: '维生素B族、纤维', description: '低糖饱腹' },
      // 荤菜
      { id: 'def_11', name: '清蒸鲈鱼', category: '荤菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['鲈鱼','姜','葱'], nutrition: 'DHA、优质蛋白', description: '健脑益智，少刺安全' },
      { id: 'def_12', name: '白切鸡', category: '荤菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['鸡肉','姜葱'], nutrition: '优质蛋白', description: '清淡鲜美，低脂' },
      { id: 'def_13', name: '番茄牛腩', category: '荤菜', suitable_weeks: [0, 42], suitable_stage: ['early','mid','late'], ingredients: ['牛腩','番茄'], nutrition: '铁、锌、番茄红素', description: '酸甜开胃，补铁' },
      { id: 'def_14', name: '虾仁蒸蛋', category: '荤菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['虾仁','鸡蛋'], nutrition: '蛋白质、卵磷脂', description: '嫩滑可口，易吸收' },
      { id: 'def_15', name: '红烧排骨', category: '荤菜', suitable_weeks: [13, 42], suitable_stage: ['mid','late'], ingredients: ['排骨','冰糖'], nutrition: '钙、磷、胶原蛋白', description: '补钙强骨' },
      { id: 'def_16', name: '清炖鸽子汤', category: '荤菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late'], ingredients: ['鸽子','枸杞','红枣'], nutrition: '优质蛋白、铁', description: '滋补气血，全孕期' },
      // 素菜
      { id: 'def_17', name: '蒜蓉西兰花', category: '素菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['西兰花','大蒜'], nutrition: '叶酸、维生素C', description: '补充叶酸，预防贫血' },
      { id: 'def_18', name: '清炒菠菜', category: '素菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['菠菜','蒜'], nutrition: '铁、叶酸', description: '补铁明星食材' },
      { id: 'def_19', name: '麻婆豆腐', category: '素菜', suitable_weeks: [13, 42], suitable_stage: ['mid','late'], ingredients: ['豆腐','肉末'], nutrition: '植物蛋白、钙', description: '下饭神器，微辣版' },
      { id: 'def_20', name: '蚝油生菜', category: '素菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['生菜','蚝油'], nutrition: '维生素、纤维素', description: '清爽解腻' },
      { id: 'def_21', name: '干煸四季豆', category: '素菜', suitable_weeks: [0, 42], suitable_stage: ['early','mid','late'], ingredients: ['四季豆','肉末'], nutrition: '膳食纤维、植物蛋白', description: '口感独特，下饭' },
      { id: 'def_22', name: '醋溜白菜', category: '素菜', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['白菜','醋'], nutrition: '维生素C、纤维素', description: '开胃爽口' },
      // 汤品
      { id: 'def_23', name: '冬瓜排骨汤', category: '汤品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['冬瓜','排骨'], nutrition: '低脂、利尿消肿', description: '消水肿，全孕期' },
      { id: 'def_24', name: '紫菜蛋花汤', category: '汤品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['紫菜','鸡蛋'], nutrition: '碘、蛋白质', description: '快手营养汤' },
      { id: 'def_25', name: '玉米胡萝卜汤', category: '汤品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['玉米','胡萝卜'], nutrition: '叶黄素、膳食纤维', description: '天然甜味，护眼' },
      { id: 'def_26', name: '山药鸡汤', category: '汤品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['山药','鸡'], nutrition: '健脾益胃', description: '滋补温和不燥热' },
      { id: 'def_27', name: '海带豆腐汤', category: '汤品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late'], ingredients: ['海带','豆腐'], nutrition: '碘、钙', description: '清淡鲜甜' },
      { id: 'def_28', name: '莲藕花生汤', category: '汤品', suitable_weeks: [0, 42], suitable_stage: ['early','mid','late'], ingredients: ['莲藕','花生'], nutrition: '膳食纤维、维生素', description: '清甜滋补，全孕期' },
      // 饮品
      { id: 'def_29', name: '鲜榨橙汁', category: '饮品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['橙子'], nutrition: '维生素C、叶酸', description: '补充维C，助消化' },
      { id: 'def_30', name: '红豆薏米水', category: '饮品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['红豆','薏米'], nutrition: '祛湿消肿', description: '去水肿必备' },
      { id: 'def_31', name: '柠檬蜂蜜水', category: '饮品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['柠檬','蜂蜜'], nutrition: '维生素C', description: '清新提神' },
      { id: 'def_32', name: '红枣枸杞茶', category: '饮品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['红枣','枸杞'], nutrition: '铁、抗氧化物', description: '补血养颜' },
      { id: 'def_33', name: '牛奶', category: '饮品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['牛奶'], nutrition: '钙、蛋白质', description: '每日补钙首选' },
      { id: 'def_34', name: '酸奶', category: '饮品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['酸奶'], nutrition: '益生菌、钙', description: '助消化补钙' },
      // 甜品
      { id: 'def_35', name: '银耳莲子羹', category: '甜品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['银耳','莲子','冰糖'], nutrition: '胶质、植物蛋白', description: '润肺养颜' },
      { id: 'def_36', name: '水果沙拉', category: '甜品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['苹果','香蕉','草莓'], nutrition: '多种维生素', description: '清新解腻' },
      { id: 'def_37', name: '红豆沙', category: '甜品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['红豆','冰糖'], nutrition: '铁、膳食纤维', description: '传统甜品' },
      { id: 'def_38', name: '蒸蛋羹', category: '甜品', suitable_weeks: [0, 42], suitable_stage: ['preparing','early','mid','late','nursing'], ingredients: ['鸡蛋'], nutrition: '优质蛋白', description: '嫩滑易消化' },
    ];
    _recipesCache = [..._recipesCache, ...defaultRecipes];
    logger.info('diet', `After adding defaults: ${_recipesCache.length} total recipes`);
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
