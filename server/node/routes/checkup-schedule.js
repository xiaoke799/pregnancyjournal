const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

// 产检时间表（内嵌数据，不依赖外部文件）
const DEFAULT_SCHEDULE = [
  {
    id: "cs_001", week_range: "6-8", week_start: 6, week_end: 8,
    name: "早孕检查",
    items: ["B超确认宫内妊娠", "血常规", "尿常规", "甲状腺功能"],
    is_mandatory: true,
    description: "确认宫内妊娠，检查胚胎发育情况，排除异位妊娠"
  },
  {
    id: "cs_002", week_range: "8-10", week_start: 8, week_end: 10,
    name: "早孕期筛查",
    items: ["B超检查胎心胎芽", "血型及Rh因子", "肝肾功能", "乙肝五项", "梅毒筛查", "HIV筛查"],
    is_mandatory: true,
    description: "全面基础检查，了解孕妇身体状况，建立孕期档案"
  },
  {
    id: "cs_003", week_range: "11-13", week_start: 11, week_end: 13,
    name: "NT检查（早期唐筛）",
    items: ["NTB超测量胎儿颈项透明层", "早期唐氏综合征筛查", "血常规", "尿常规"],
    is_mandatory: true,
    description: "通过NT值和血液指标评估胎儿染色体异常风险"
  },
  {
    id: "cs_004", week_range: "15-20", week_start: 15, week_end: 20,
    name: "中期唐筛/无创DNA",
    items: ["中期唐氏综合征筛查", "血常规", "尿常规", "血压体重", "宫高腹围"],
    is_mandatory: true,
    description: "如早期唐筛高风险，可做无创DNA或羊水穿刺进一步确诊"
  },
  {
    id: "cs_005", week_range: "20-24", week_start: 20, week_end: 24,
    name: "大排畸（系统B超）",
    items: ["系统超声检查（大排畸）", "血常规", "尿常规", "血压体重"],
    is_mandatory: true,
    description: "详细检查胎儿各器官发育情况，排查重大结构畸形"
  },
  {
    id: "cs_006", week_range: "24-28", week_start: 24, week_end: 28,
    name: "妊娠期糖尿病筛查",
    items: ["OGTT糖耐量试验（75g）", "血常规", "尿常规", "血压体重", "宫高腹围"],
    is_mandatory: true,
    description: "口服葡萄糖耐量试验，筛查妊娠期糖尿病，需空腹"
  },
  {
    id: "cs_007", week_range: "28-30", week_start: 28, week_end: 30,
    name: "晚孕初期检查",
    items: ["B超检查胎儿发育", "血常规", "尿常规", "血压体重", "宫高腹围", "胎位检查"],
    is_mandatory: true,
    description: "进入孕晚期，开始两周一次产检，关注胎儿发育和胎位"
  },
  {
    id: "cs_008", week_range: "30-32", week_start: 30, week_end: 32,
    name: "晚孕常规检查",
    items: ["血常规", "尿常规", "血压体重", "宫高腹围", "胎心监护"],
    is_mandatory: true,
    description: "定期监测孕妇血压、体重增长，关注胎儿发育情况"
  },
  {
    id: "cs_009", week_range: "32-34", week_start: 32, week_end: 34,
    name: "晚孕复查",
    items: ["B超检查（胎儿大小、羊水、胎盘）", "血常规", "尿常规", "血压体重", "胎心监护"],
    is_mandatory: true,
    description: "评估胎儿生长情况、羊水量及胎盘成熟度"
  },
  {
    id: "cs_010", week_range: "34-36", week_start: 34, week_end: 36,
    name: "B族链球菌筛查",
    items: ["GBS（B族链球菌）筛查", "血常规", "尿常规", "血压体重", "胎心监护"],
    is_mandatory: true,
    description: "筛查B族链球菌感染，阳性者分娩时需预防性使用抗生素"
  },
  {
    id: "cs_011", week_range: "36-37", week_start: 36, week_end: 37,
    name: "分娩前评估",
    items: ["B超评估胎儿体重", "骨盆测量", "血常规", "凝血功能", "心电图", "胎心监护"],
    is_mandatory: true,
    description: "评估分娩方式，确定顺产或剖宫产，做好分娩准备"
  },
  {
    id: "cs_012", week_range: "37-38", week_start: 37, week_end: 38,
    name: "足月检查",
    items: ["血常规", "尿常规", "血压体重", "胎心监护", "宫颈检查", "分娩征兆评估"],
    is_mandatory: true,
    description: "胎儿已足月，每周检查一次，关注分娩征兆"
  },
  {
    id: "cs_013", week_range: "38-39", week_start: 38, week_end: 39,
    name: "临产前检查",
    items: ["血常规", "尿常规", "血压体重", "胎心监护", "B超（如需要）", "宫颈评分"],
    is_mandatory: true,
    description: "密切关注临产征兆，评估宫颈条件，随时准备入院"
  },
  {
    id: "cs_014", week_range: "39-40", week_start: 39, week_end: 40,
    name: "预产期检查",
    items: ["血常规", "尿常规", "血压体重", "胎心监护", "宫颈检查", "羊水和胎盘评估"],
    is_mandatory: true,
    description: "到达预产期，如未发动需评估是否需要催产，超过41周需住院"
  },
  {
    id: "cs_015", week_range: "41", week_start: 41, week_end: 41,
    name: "催产评估",
    items: ["胎心监护（NST）", "B超评估羊水量", "胎盘功能评估", "宫颈成熟度评分（Bishop评分）", "血压体重", "尿常规"],
    is_mandatory: true,
    description: "超过预产期1周，住院评估胎儿状况与宫颈条件，依据结果决定催产方式（缩宫素或人工破膜）"
  },
  {
    id: "cs_016", week_range: "42", week_start: 42, week_end: 42,
    name: "过期妊娠处理",
    items: ["持续胎心监护", "B超监测羊水量与胎盘钙化", "OCT催产素激惹试验", "血压体重", "尿常规", "凝血功能与肝肾功能复查"],
    is_mandatory: true,
    description: "已达过期妊娠（≥42周），需住院严密监护，积极催产或剖宫产终止妊娠，避免胎盘功能下降与胎儿窘迫"
  }
];

function getSchedule() { return DEFAULT_SCHEDULE; }

router.get('/checkup-schedule/completed-weeks', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `GET /completed-weeks - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'GET /completed-weeks - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }
    const completedCheckups = await db.queryAll(
      'SELECT gestational_week FROM prenatal_checkup WHERE pregnancy_id = ? AND is_completed = 1',
      [pregnancy_id]
    );
    logger.info('checkup-schedule', `GET /completed-weeks - found ${completedCheckups.length} completed weeks`);
    res.json({
      code: 0,
      data: completedCheckups.map(c => c.gestational_week),
      message: 'success'
    });
  } catch (error) {
    logger.error('checkup-schedule', 'GET /completed-weeks error', error);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/checkup-schedule', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `GET /checkup-schedule - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'GET /checkup-schedule - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const schedule = getSchedule();
    const completedCheckups = await db.queryAll(
      'SELECT gestational_week FROM prenatal_checkup WHERE pregnancy_id = ? AND is_completed = 1',
      [pregnancy_id]
    );
    const completedWeeks = new Set(completedCheckups.map(c => c.gestational_week));

    const itemsWithStatus = schedule.map(item => {
      const weekStart = item.week_start || 0;
      const weekEnd = item.week_end || item.week_start || 0;
      const isCompleted = Array.from({ length: weekEnd - weekStart + 1 }, (_, i) => weekStart + i)
        .some(w => completedWeeks.has(w));
      return {
        ...item,
        is_completed: isCompleted,
        is_recommended: !isCompleted,
      };
    });

    logger.info('checkup-schedule', `GET /checkup-schedule - returned ${itemsWithStatus.length} items`);
    res.json({ code: 0, data: itemsWithStatus, message: 'success' });
  } catch (error) {
    logger.error('checkup-schedule', 'GET /checkup-schedule error', error);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.put('/checkup-schedule/:item_id/complete', async (req, res) => {
  try {
    const { item_id } = req.params;
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `PUT /:item_id/complete - pregnancy_id=${pregnancy_id}, item_id=${item_id}`);

    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'PUT /:item_id/complete - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    // 检查是否已经标记过
    var existing = null;
    try {
      existing = db.queryOne(
        'SELECT id, is_completed FROM prenatal_checkup WHERE pregnancy_id = ? AND notes LIKE ? LIMIT 1',
        [pregnancy_id, '%从产检时间表标记完成%' + item_id + '%']
      );
    } catch (queryErr) {
      logger.error('checkup-schedule', 'PUT /:item_id/complete queryOne error', queryErr);
    }

    if (existing && existing.is_completed === 1) {
      logger.info('checkup-schedule', `PUT /:item_id/complete - already marked complete (id=${existing.id})`);
      return res.json({
        code: 0,
        data: { checkup_id: existing.id, item_id: item_id, is_completed: true, already_marked: true },
        message: '已标记完成'
      });
    }

    var schedule = getSchedule();
    var item = null;
    for (var si = 0; si < schedule.length; si++) {
      if (schedule[si].id === item_id) { item = schedule[si]; break; }
    }
    if (!item) {
      logger.warn('checkup-schedule', `PUT /:item_id/complete - item not found: ${item_id}`);
      return res.json({ code: 1001, data: null, message: '产检项目不存在: ' + item_id });
    }

    var weekStart = item.week_start || 0;
    var itemNames = [];
    var itemsArr = item.items || [];
    for (var ii = 0; ii < itemsArr.length; ii++) {
      var iname = typeof itemsArr[ii] === 'string' ? itemsArr[ii] : (itemsArr[ii].name || '');
      if (iname) itemNames.push(iname);
    }
    var itemNamesStr = itemNames.join(', ');
    var checkupId = existing ? existing.id : db.generateId();
    var nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (existing) {
      // 更新已有记录
      try {
        await db.run(
          'UPDATE prenatal_checkup SET is_completed = 1, updated_at = ? WHERE id = ?',
          [nowStr, checkupId]
        );
        logger.info('checkup-schedule', `PUT /:item_id/complete - updated existing record (id=${checkupId})`);
      } catch (updateErr) {
        logger.error('checkup-schedule', 'PUT /:item_id/complete update error', updateErr);
        return res.status(500).json({ code: 1001, data: null, message: '更新失败: ' + updateErr.message });
      }
    } else {
      // 新建记录 - 使用JS计算的日期避免sql.js兼容问题
      try {
        await db.run(
          "INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, gestational_day, checkup_type, notes, is_completed, is_recommended, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, 1, 1, ?, ?)",
          [
            checkupId,
            pregnancy_id,
            new Date().toISOString().split('T')[0],
            weekStart,
            item.name || item.title || '',
            '从产检时间表标记完成: ' + itemNamesStr + ' [' + item_id + ']',
            nowStr,
            nowStr
          ]
        );
        logger.info('checkup-schedule', `PUT /:item_id/complete - inserted new record (id=${checkupId})`);
      } catch (insertErr) {
        logger.error('checkup-schedule', 'PUT /:item_id/complete insert error', insertErr);
        return res.status(500).json({ code: 1001, data: null, message: '插入失败: ' + insertErr.message });
      }
    }

    logger.info('checkup-schedule', `PUT /:item_id/complete - success, checkup_id=${checkupId}, item_id=${item_id}`);
    res.json({
      code: 0,
      data: { checkup_id: checkupId, item_id: item_id, is_completed: true },
      message: '标记完成成功'
    });
  } catch (error) {
    logger.error('checkup-schedule', 'PUT /:item_id/complete unexpected error', error);
    res.status(500).json({ code: 1001, data: null, message: error.message || '服务器内部错误' });
  }
});

// 设置产检实际完成日期
router.post('/checkup-schedule/schedule-date', async (req, res) => {
  try {
    const { pregnancy_id, schedule_id, date } = req.body;
    logger.info('checkup-schedule', `POST /schedule-date - pregnancy_id=${pregnancy_id}, schedule_id=${schedule_id}, date=${date}`);
    if (!pregnancy_id || !schedule_id || !date) {
      logger.warn('checkup-schedule', 'POST /schedule-date - missing required params');
      return res.json({ code: 1001, data: null, message: '参数缺失' });
    }

    // 确保 schedule_dates 表存在
    await db.run(`
      CREATE TABLE IF NOT EXISTS schedule_dates (
        pregnancy_id TEXT NOT NULL,
        schedule_id TEXT NOT NULL,
        checkup_date TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (pregnancy_id, schedule_id),
        FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
      )
    `);

    // upsert
    await db.run(
      `INSERT INTO schedule_dates (pregnancy_id, schedule_id, checkup_date)
       VALUES (?, ?, ?)
       ON CONFLICT(pregnancy_id, schedule_id) DO UPDATE SET checkup_date = excluded.checkup_date, updated_at = datetime('now')`,
      [pregnancy_id, schedule_id, date]
    );

    logger.info('checkup-schedule', `POST /schedule-date - success, schedule_id=${schedule_id}, date=${date}`);
    res.json({ code: 0, data: { schedule_id, date }, message: '设置成功' });
  } catch (error) {
    logger.error('checkup-schedule', 'POST /schedule-date error', error);
    res.json({ code: 1002, data: null, message: error.message });
  }
});

// 获取所有已设置的产检日期
router.get('/checkup-schedule/dates', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    logger.info('checkup-schedule', `GET /dates - pregnancy_id=${pregnancy_id}`);
    if (!pregnancy_id) {
      logger.warn('checkup-schedule', 'GET /dates - missing pregnancy_id');
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    }

    const rows = await db.queryAll(
      'SELECT schedule_id, checkup_date FROM schedule_dates WHERE pregnancy_id = ?',
      [pregnancy_id]
    );

    const dates = {};
    for (const row of rows) {
      dates[row.schedule_id] = row.checkup_date;
    }

    logger.info('checkup-schedule', `GET /dates - returned ${rows.length} dates`);
    res.json({ code: 0, data: dates });
  } catch (error) {
    logger.error('checkup-schedule', 'GET /dates error', error);
    res.json({ code: 1002, data: null, message: error.message });
  }
});

module.exports = router;
