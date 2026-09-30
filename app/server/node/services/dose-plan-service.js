/**
 * 用药 / 营养补充「医嘱计划」的**唯一判定口径**。
 *
 * ⚠️ 今日列表（前端）与到点提醒（推送）**必须共用本文件**，否则会出现
 *    「页面显示今天要吃、提醒却没推」这种两处规则漂移 —— 这是最容易漏的一类缺陷。
 *
 * 设计要点：
 *  · 提醒是**计划驱动**的：只在方案配置的时间点推，不是把药列一遍就全提醒；
 *  · 只有「今天按医嘱该服」的方案才会进入待办（看起止日期 / 起止孕周 / 频率）；
 *  · 「今天吃没吃」由 dose_checkin 按 (plan_id, date) 记录 ——
 *    不能用 reminder.is_completed（那是一次性开关，勾完就永不再提醒，做每日服药反而更危险）。
 */
const db = require('../db');
const config = require('../config');
const { calculateGestationalAge } = require('./gestational-calculator');

const KIND_LABEL = { medication: '药品', supplement: '营养补充' };
const DEFAULT_TIMES = ['08:00'];


function safeJsonArray(v, fallback = []) {
  if (v === null || v === undefined || v === '') return fallback;
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

/** 提醒时间点：只认 "HH:mm"，去重排序。取不到就退回默认一个时间点。 */
function planTimes(plan) {
  const list = safeJsonArray(plan && plan.reminder_times)
    .map((t) => String(t).trim())
    .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  const uniq = Array.from(new Set(list)).sort();
  return uniq.length ? uniq : DEFAULT_TIMES.slice();
}

function parseLocalDate(dateStr) {
  // 用 T00:00:00 强制按本地时区解析（直接 new Date('2026-09-30') 会按 UTC 算，差 8 小时）
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
}

function daysBetween(aStr, bStr) {
  const a = parseLocalDate(aStr);
  const b = parseLocalDate(bStr);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * 把 SQLite 的 `CURRENT_TIMESTAMP`（**UTC** 的 `YYYY-MM-DD HH:MM:SS`）
 * 换算成本地 `YYYY-MM-DD`。
 *
 * ⚠️ 为什么必须换算：`created_at` 存的是 UTC，而判定用的 `date` 是本地日期。
 *    UTC+8 下 00:00~08:00 建的记录，其 UTC 日期还是「昨天」—— 直接 `slice(0, 10)`
 *    会让「隔天服药」的锚点落到昨天，第一天就被跳过（已踩过）。
 * 只有**带时间部分**的才按 UTC 解析；纯日期或解析失败就原样取前 10 字符
 * （宁可差一天，也不要因为一个脏值把整条判定搞崩）。
 */
function localDateOf(ts) {
  const s = String(ts || '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 该日期对应的孕周；取不到末次月经时返回 null（孕周约束视为不生效） */
function gestationalWeekOn(pregnancyId, date) {
  const p = db.queryOne('SELECT last_period_date FROM pregnancy WHERE id = ?', [pregnancyId]);
  if (!p || !p.last_period_date) return null;
  try {
    return calculateGestationalAge(p.last_period_date, date).weeks;
  } catch (e) {
    return null;
  }
}

/**
 * 某天是否「按医嘱该服」。
 * 判定 = **全部约束都满足**；没配置的约束视为通过。
 */
function isPlanDueOn(plan, date, week) {
  if (!plan) return false;
  if (Number(plan.is_enabled) === 0) return false;

  if (plan.start_date && date < String(plan.start_date).slice(0, 10)) return false;
  if (plan.end_date && date > String(plan.end_date).slice(0, 10)) return false;

  if (week !== null && week !== undefined) {
    if (plan.start_week !== null && plan.start_week !== undefined && plan.start_week !== '') {
      if (week < Number(plan.start_week)) return false;
    }
    if (plan.end_week !== null && plan.end_week !== undefined && plan.end_week !== '') {
      if (week > Number(plan.end_week)) return false;
    }
  }

  const freq = plan.frequency || 'daily';
  if (freq === 'weekdays') {
    const days = safeJsonArray(plan.weekdays).map(Number).filter((n) => n >= 1 && n <= 7);
    // ⚠️ 空数组**不等于「不限制」**：选了「每周指定」却一天都没勾，语义就是「没有该吃的日子」。
    //    此前写成 `if (days.length) { ... }` ⇒ 空数组直接跳过过滤 ⇒ **每天都提醒**（上线前检查 #5）。
    //    routes 层加的「至少勾一天」只拦得住新写入，**存量脏数据只能靠这里兜底**，
    //    所以本判定必须自己闭环，不能指望上游已校验。
    if (!days.length) return false;
    const dow = parseLocalDate(date).getDay();          // JS: 0=周日..6=周六
    const iso = dow === 0 ? 7 : dow;                    // 转成 1=周一..7=周日
    if (!days.includes(iso)) return false;
  } else if (freq === 'interval2') {
    // 隔天：以 start_date 为锚（routes 层在新建/编辑时都会钉一个本地起始日）。
    //
    // ⚠️ 但**不能**用 `|| date` 兜底 —— 那等于「锚点 = 查询日」，差值恒为 0 ⇒ 每天都提醒。
    //    这正是上线前检查 #4 的根因：编辑成「隔天」后 start_date 被清成 null，
    //    服务层又拿查询日当锚，于是 7 天判定出 `1111111`（应为 `1010101`）。
    //    路由层修好之后新数据不会再有 null，但**存量脏数据**只有这里能兜住。
    // ⚠️ 也不能直接用 created_at 的字符串日期：SQLite 的 CURRENT_TIMESTAMP 是 **UTC**，
    //    而 date 是本地日期 —— UTC+8 在 00:00~08:00 建的方案会被算成「昨天建的」，
    //    第一天直接被跳过。所以必须**按本地时区换算**后再当锚点。
    const anchor = plan.start_date || localDateOf(plan.created_at) || date;
    if (Math.abs(daysBetween(anchor, date)) % 2 !== 0) return false;
  }
  return true;
}

/** 某天应服的方案列表（已按 sort_order / 时间排序） */
function listDuePlans(pregnancyId, date) {
  const all = db.queryAll(
    'SELECT * FROM dose_plan WHERE pregnancy_id = ? ORDER BY sort_order ASC, created_at ASC',
    [pregnancyId]
  );
  const week = gestationalWeekOn(pregnancyId, date);
  return all.filter((p) => isPlanDueOn(p, date, week));
}

/** 某天某方案是否已打卡 */
function isCheckedOn(planId, date) {
  const row = db.queryOne(
    'SELECT id FROM dose_checkin WHERE plan_id = ? AND date = ?',
    [planId, date]
  );
  return !!row;
}

/** 某天已打卡的 plan_id 集合（一次查完，避免 N+1） */
function checkedPlanIdsOn(pregnancyId, date) {
  const rows = db.queryAll(
    'SELECT plan_id FROM dose_checkin WHERE pregnancy_id = ? AND date = ?',
    [pregnancyId, date]
  );
  return new Set(rows.map((r) => r.plan_id));
}

/** 今日待办（按种类，一天一条） */
function buildTodayList(pregnancyId, date) {
  const due = listDuePlans(pregnancyId, date);
  const checked = checkedPlanIdsOn(pregnancyId, date);
  return due.map((p) => ({
    id: p.id,
    kind: p.kind,
    kind_label: KIND_LABEL[p.kind] || '其它',
    name: p.name,
    dosage: p.dosage || '',
    note: p.note || '',
    reminder_times: planTimes(p),
    frequency: p.frequency || 'daily',
    // 带上「每周指定」具体是哪几天：否则前端只能显示「每周指定」，
    // 用户看不出今天是该吃还是不该吃（顺手也让推送文案有据可依）
    weekdays: safeJsonArray(p.weekdays).map(Number).filter((n) => n >= 1 && n <= 7),
    taken: checked.has(p.id),
  }));
}

module.exports = {
  KIND_LABEL,
  DEFAULT_TIMES,
  safeJsonArray,
  planTimes,
  daysBetween,
  localDateOf,
  gestationalWeekOn,
  isPlanDueOn,
  listDuePlans,
  isCheckedOn,
  checkedPlanIdsOn,
  buildTodayList,
  today: () => config.localToday(),
};
