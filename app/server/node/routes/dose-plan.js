/**
 * 用药 / 营养补充「医嘱计划」+ 每日打卡。
 *
 * 数据落点：dose_plan（方案，一次配置）+ dose_checkin（按天打卡，plan_id + date 唯一）。
 * 「今天该不该吃」的判定全部交给 services/dose-plan-service.js —— 本文件不做第二套规则。
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const dosePlan = require('../services/dose-plan-service');

const KINDS = ['medication', 'supplement'];
const FREQS = ['daily', 'interval2', 'weekdays'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function fail(res, message) {
  return res.json({ code: 1001, data: null, message });
}

function ok(res, data, message = '成功') {
  return res.json({ code: 0, data, message });
}

function normDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).slice(0, 10);
  return DATE_RE.test(s) ? s : undefined;      // undefined = 传了但格式不对
}

function normInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 45 ? n : undefined;
}

/** 校验并归一化方案入参；返回 { values } 或 { error } */
function normalizePlanBody(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};

  if (!partial || b.kind !== undefined) {
    const kind = partial ? b.kind : (b.kind || 'medication');
    if (!KINDS.includes(kind)) return { error: 'kind 只能是 medication 或 supplement' };
    out.kind = kind;
  }
  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name) return { error: '缺少名称' };
    if (name.length > 40) return { error: '名称过长（最多 40 字）' };
    out.name = name;
  }
  if (b.dosage !== undefined) out.dosage = String(b.dosage || '').trim().slice(0, 40);

  if (b.reminder_times !== undefined) {
    const raw = dosePlan.safeJsonArray(b.reminder_times);
    const times = Array.from(new Set(raw.map((t) => String(t).trim()).filter((t) => TIME_RE.test(t)))).sort();
    if (raw.length && !times.length) return { error: '提醒时间格式不对（应为 HH:mm）' };
    if (times.length > 6) return { error: '提醒时间点最多 6 个' };
    out.reminder_times = JSON.stringify(times.length ? times : dosePlan.DEFAULT_TIMES);
  }
  if (b.frequency !== undefined) {
    if (!FREQS.includes(b.frequency)) return { error: 'frequency 只能是 daily / interval2 / weekdays' };
    out.frequency = b.frequency;
  }
  if (b.weekdays !== undefined) {
    const days = dosePlan.safeJsonArray(b.weekdays).map(Number).filter((n) => n >= 1 && n <= 7);
    out.weekdays = JSON.stringify(Array.from(new Set(days)).sort());
  }
  for (const k of ['start_date', 'end_date']) {
    if (b[k] !== undefined) {
      const d = normDate(b[k]);
      if (d === undefined) return { error: `${k} 格式应为 YYYY-MM-DD` };
      out[k] = d;
    }
  }
  for (const k of ['start_week', 'end_week']) {
    if (b[k] !== undefined) {
      const n = normInt(b[k]);
      if (n === undefined) return { error: `${k} 应为 0~45 的整数` };
      out[k] = n;
    }
  }
  if (out.start_date && out.end_date && out.start_date > out.end_date) {
    return { error: '开始日期不能晚于结束日期' };
  }
  if (out.start_week != null && out.end_week != null && out.start_week > out.end_week) {
    return { error: '开始孕周不能大于结束孕周' };
  }
  if (b.note !== undefined) out.note = String(b.note || '').trim().slice(0, 120);
  if (b.is_enabled !== undefined) out.is_enabled = b.is_enabled ? 1 : 0;
  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order);
    out.sort_order = Number.isInteger(n) ? n : 0;
  }
  return { values: out };
}

// ============ 方案 ============
router.get('/dose-plans', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) return fail(res, '缺少pregnancy_id参数');
    const list = db.queryAll(
      'SELECT * FROM dose_plan WHERE pregnancy_id = ? ORDER BY sort_order ASC, created_at ASC',
      [pregnancy_id]
    );
    return ok(res, list.map((p) => ({
      ...p,
      reminder_times: dosePlan.planTimes(p),
      weekdays: dosePlan.safeJsonArray(p.weekdays),
    })));
  } catch (error) {
    return fail(res, error.message);
  }
});

router.post('/dose-plans', async (req, res) => {
  try {
    const { pregnancy_id } = req.body || {};
    if (!pregnancy_id) return fail(res, '缺少必要参数pregnancy_id');
    const { values, error } = normalizePlanBody(req.body);
    if (error) return fail(res, error);

    // ⚠️「隔天」必须有明确的锚点日，否则不能用 created_at 兜底：
    //    SQLite 的 CURRENT_TIMESTAMP 是 **UTC**，而今天用的是 config.localToday()（本地）。
    //    UTC+8 在 00:00~08:00 建的隔天方案会被算成「昨天建」⇒ 今天变成不吃的那天，
    //    等于第一天就被跳过。这里显式钉一个本地起始日。
    if ((values.frequency || 'daily') === 'interval2' && !values.start_date) {
      values.start_date = config.localToday();
    }
    // ⚠️「每周指定」一个都不勾 = 服务层不过滤 = 每天都提醒（上线前检查 #5）
    if (values.frequency === 'weekdays' && !dosePlan.safeJsonArray(values.weekdays).length) {
      return fail(res, '每周指定至少要勾一天');
    }

    const id = db.generateId();
    const cols = ['id', 'pregnancy_id', ...Object.keys(values)];
    const marks = cols.map(() => '?').join(', ');
    const args = [id, pregnancy_id, ...Object.values(values)];
    db.beginTransaction();
    await db.run(
      `INSERT INTO dose_plan (${cols.join(', ')}, created_at, updated_at) VALUES (${marks}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args
    );
    db.commitTransaction();
    return ok(res, { id }, '创建成功');
  } catch (error) {
    db.rollbackTransaction();
    return fail(res, error.message);
  }
});

router.put('/dose-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.queryOne('SELECT * FROM dose_plan WHERE id = ?', [id]);
    if (!existing) return fail(res, '方案不存在');

    const { values, error } = normalizePlanBody(req.body, { partial: true });
    if (error) return fail(res, error);

    // ⚠️「隔天」锚点（上线前检查 #4）：POST 会钉 start_date，PUT 曾漏掉 ——
    //    前端每次保存都带 start_date（可能为 null），PUT 原样写库后服务层以
    //    「查询日」为锚，差值恒为 0 ⇒ 隔天方案变成每天都提醒。
    //    这里按「改后频率」补锚：沿用旧锚，旧记录没有锚就钉今天。
    const effFreq = values.frequency !== undefined ? values.frequency : existing.frequency;
    // 注意条件用 falsy：前端保存时显式传 start_date: null，normDate 会原样放行 null
    if (effFreq === 'interval2' && !values.start_date) {
      values.start_date = existing.start_date || config.localToday();
    }
    // ⚠️「每周指定」一个都不勾 = 每天都提醒（上线前检查 #5）。
    //    PUT 是部分更新：本次没传 weekdays 就看旧值，改后仍为空则拒绝。
    if (effFreq === 'weekdays') {
      const effWeekdays = values.weekdays !== undefined
        ? dosePlan.safeJsonArray(values.weekdays)
        : dosePlan.safeJsonArray(existing.weekdays);
      if (!effWeekdays.length) return fail(res, '每周指定至少要勾一天');
    }

    const keys = Object.keys(values);
    if (!keys.length) return fail(res, '没有需要更新的字段');

    const updates = keys.map((k) => `${k} = ?`);
    db.beginTransaction();
    await db.run(
      `UPDATE dose_plan SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...keys.map((k) => values[k]), id]
    );
    db.commitTransaction();
    return ok(res, { id }, '更新成功');
  } catch (error) {
    db.rollbackTransaction();
    return fail(res, error.message);
  }
});

router.delete('/dose-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.queryOne('SELECT id FROM dose_plan WHERE id = ?', [id]);
    if (!existing) return fail(res, '方案不存在');

    // ⚠️ 打卡记录显式删：PRAGMA foreign_keys 在 db.export() 之后会被重置，
    //    不能指望 ON DELETE CASCADE 一定生效（历史踩过）。
    db.beginTransaction();
    await db.run('DELETE FROM dose_checkin WHERE plan_id = ?', [id]);
    await db.run('DELETE FROM dose_plan WHERE id = ?', [id]);
    db.commitTransaction();
    return ok(res, { id }, '删除成功');
  } catch (error) {
    db.rollbackTransaction();
    return fail(res, error.message);
  }
});

// ============ 今日待办 ============
router.get('/dose-today', async (req, res) => {
  try {
    const { pregnancy_id, date } = req.query;
    if (!pregnancy_id) return fail(res, '缺少pregnancy_id参数');
    const d = date && DATE_RE.test(String(date)) ? String(date) : config.localToday();
    const items = dosePlan.buildTodayList(pregnancy_id, d);
    return ok(res, {
      date: d,
      items,
      total: items.length,
      taken: items.filter((i) => i.taken).length,
    });
  } catch (error) {
    return fail(res, error.message);
  }
});

// ============ 打卡 / 撤销 ============
router.post('/dose-checkins', async (req, res) => {
  try {
    const { pregnancy_id, plan_id, date } = req.body || {};
    if (!pregnancy_id || !plan_id) return fail(res, '缺少必要参数pregnancy_id或plan_id');
    const d = date && DATE_RE.test(String(date)) ? String(date) : config.localToday();

    const plan = await db.queryOne('SELECT id FROM dose_plan WHERE id = ? AND pregnancy_id = ?', [plan_id, pregnancy_id]);
    if (!plan) return fail(res, '方案不存在');

    // 读放在事务之外（与 habit-checkin / supplement-checkin 同一口径）
    const existing = await db.queryOne(
      'SELECT id FROM dose_checkin WHERE plan_id = ? AND date = ?',
      [plan_id, d]
    );
    if (existing) return ok(res, { id: existing.id, duplicated: true }, '今天已经打过卡了');

    const id = db.generateId();
    db.beginTransaction();
    await db.run(
      'INSERT INTO dose_checkin (id, pregnancy_id, plan_id, date, taken_at, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [id, pregnancy_id, plan_id, d]
    );
    db.commitTransaction();
    return ok(res, { id }, '打卡成功');
  } catch (error) {
    db.rollbackTransaction();
    return fail(res, error.message);
  }
});

router.delete('/dose-checkins', async (req, res) => {
  try {
    const { plan_id, date } = req.query;
    if (!plan_id) return fail(res, '缺少plan_id参数');
    const d = date && DATE_RE.test(String(date)) ? String(date) : config.localToday();
    db.beginTransaction();
    await db.run('DELETE FROM dose_checkin WHERE plan_id = ? AND date = ?', [plan_id, d]);
    db.commitTransaction();
    return ok(res, { plan_id, date: d }, '已撤销');
  } catch (error) {
    db.rollbackTransaction();
    return fail(res, error.message);
  }
});

module.exports = router;
