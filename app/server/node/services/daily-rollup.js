/**
 * 胎动 / 宫缩会话 → 当天 `daily_record` 的汇总写回。
 *
 * 【为什么需要这个文件】
 * 胎动和宫缩原本是**两套互不相通的存储**：
 *   - 记录页「胎动 / 宫缩」小弹窗手填 ⇒ 写 `daily_record` 的
 *     `fetal_movement_count/duration`、`contraction_count/interval/duration/pain`
 *   - 计数器页 / 计时器页 ⇒ 只写 `fetal_movement_session`、`contraction_session`
 * 而**记录列表、统计页、CSV 导出全都只读 `daily_record`** ⇒ 用户在计数器里认认真真
 * 数了 20 分钟胎动，点「结束计数」后 `router.push('/')` 回首页，**数据在库里却哪儿都看不见**。
 *
 * 这里补上那一步：会话结束时，把当天该孕期下**所有**会话汇总回当天记录。
 * 会话明细本身一条不动（`*_session` / `*` 表是真源），记录页另取明细展示 ⇒
 * 同一天多次会话（早晚各数一次）**每一次都留痕**，汇总则进统计与导出。
 *
 * 【单位口径】（极易写错，都在这里一次说清）
 *   daily_record.fetal_movement_duration  = 分钟（记录页「用时(分钟)」，列类型 INTEGER）
 *   daily_record.contraction_duration     = 秒  （记录页「持续时间(秒)」，统计页 unit="秒"）
 *   daily_record.contraction_interval     = 分钟（记录页「间隔时间(分钟)」）
 *   contraction_session.avg_duration      = **秒**（由 `contraction.duration` 求平均，
 *                                            而 duration 来自 `(end-start)/1000`）
 *   contraction_session.avg_interval      = **秒**（由 `interval_from_prev` 求平均，
 *                                            而它同样来自 `/1000`）
 *   ⇒ 只有「宫缩间隔」需要 秒 → 分 换算，其余直接搬。
 *
 * 【一条硬规则】当天**没有任何会话**时，本模块**一个字段都不写**。
 *   这样「不用计时器、只手填」的用户行为完全不变（零影响），
 *   也绝不会把用户手写的内容悄悄抹掉。
 *   同理 `contraction_pain` 永远不写：会话表里没有疼痛信息，
 *   它只可能来自用户手填，必须原样保留。
 */
const db = require('../db');
const config = require('../config');
const logger = require('../logger');

const SCOPE = 'daily-rollup';

/** 'HH:MM:SS' → 当日秒数；非法返回 null */
function toSeconds(hms) {
  if (typeof hms !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms.trim());
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  return Number.isFinite(s) ? s : null;
}

/** 当天胎动会话汇总。count = 总次数；duration_minutes = 各次会话时长合计（分钟） */
function summarizeFetalMovement(pregnancyId, date) {
  const sessions = db.queryAll(
    `SELECT start_time, end_time, total_count FROM fetal_movement_session
     WHERE pregnancy_id = ? AND session_date = ? ORDER BY start_time ASC`,
    [pregnancyId, date]
  );
  let count = 0;
  let seconds = 0;
  let timed = 0;
  for (const s of sessions) {
    count += Number(s.total_count) || 0;
    const a = toSeconds(s.start_time);
    const b = toSeconds(s.end_time);
    if (a !== null && b !== null && b >= a) { seconds += (b - a); timed++; }
  }
  return {
    session_count: sessions.length,
    count,
    // 秒四舍五入到分钟；不足 1 分钟但确实计时过 ⇒ 记 1 分钟。
    // 否则「数了 40 秒」会得到「用时 0 分钟」，看起来像坏掉了（列是 INTEGER，存不了小数）。
    duration_minutes: timed > 0 ? Math.max(1, Math.round(seconds / 60)) : null,
  };
}

/** 当天宫缩会话汇总。按各会话的宫缩条数加权平均，避免 2 条的会话与 20 条的会话等权 */
function summarizeContraction(pregnancyId, date) {
  const sessions = db.queryAll(
    `SELECT total_count, avg_duration, avg_interval FROM contraction_session
     WHERE pregnancy_id = ? AND session_date = ?`,
    [pregnancyId, date]
  );
  let count = 0;
  let durWeighted = 0;
  let durWeight = 0;
  let intWeighted = 0;
  let intWeight = 0;
  for (const s of sessions) {
    const c = Number(s.total_count) || 0;
    count += c;
    if (c > 0 && s.avg_duration != null) { durWeighted += Number(s.avg_duration) * c; durWeight += c; }
    if (c > 0 && s.avg_interval != null) { intWeighted += Number(s.avg_interval) * c; intWeight += c; }
  }
  return {
    session_count: sessions.length,
    count,
    duration_seconds: durWeight > 0 ? Math.round(durWeighted / durWeight) : null,
    // 秒 → 分，保留 1 位小数（记录页的间隔输入是 0.5 步进）
    interval_minutes: intWeight > 0 ? Math.round(intWeighted / intWeight / 6) / 10 : null,
  };
}

/**
 * 把 fields 写进当天记录。只写 fields 里**算得出值**的列，其余列一律不碰
 * —— 与 `daily-record.js` 的 upsert 同一条铁律（#43）：不传 ≠ 传空，传空要显式给 ''。
 *
 * ⚠️ 这里比 #43 更严一档：`null` 也算「没值」，直接跳过。
 * 原因：会话还在进行中时 `duration_minutes` / `duration_seconds` / `interval_minutes`
 * 都是 null（时长/间隔还没产生）。若把 null 写进去，就会**把用户手填的时长/间隔抹成空**——
 * 早上手动记了「胎动 20 次、用时 30 分钟」，晚上随手按一次计数器，30 分钟就没了。
 * 所以本函数只负责「覆盖掉自己能算准的字段」，算不准的一律不碰。
 */
function writeRollup(pregnancyId, date, fields) {
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined && fields[k] !== null);
  if (!cols.length) return false;
  const values = cols.map((c) => fields[c]);
  const row = db.queryOne(
    'SELECT id FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
    [pregnancyId, date]
  );
  if (row) {
    // 占位符与列名由同一个数组派生，不可能数量不匹配
    // （daily-record.js 曾手写 50 个 `?` 配 51 个列名 ⇒ 所有日常记录都写不进去）
    db.run(
      `UPDATE daily_record SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, row.id]
    );
  } else {
    db.run(
      `INSERT INTO daily_record (id, pregnancy_id, record_date, ${cols.join(', ')})
       VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})`,
      [db.generateId(), pregnancyId, date, ...values]
    );
  }
  return true;
}

/** 会话结束后同步胎动汇总。没有会话 ⇒ 直接跳过，不动用户手填值 */
function syncFetalMovement(pregnancyId, date) {
  const dateStr = date || config.localToday();
  if (!pregnancyId) return { skipped: true, reason: 'no-pregnancy' };
  try {
    const sum = summarizeFetalMovement(pregnancyId, dateStr);
    if (!sum.session_count) return { skipped: true, reason: 'no-session', ...sum };
    // ⚠️ 次数为 0 时不写。真实场景：用户点开计数器试了一下、一次没数就点「结束计数」——
    //    这一天只有一条**空会话**，把 count=0 写回去会把他手填的「胎动 20 次」清零。
    //    空会话不携带任何信息，就**不该代表这一天**。清空要由用户在记录页显式操作。
    //    （时长本来就是「算不出就跳过」，见 writeRollup 上方说明。）
    const fields = {};
    if (sum.count > 0) fields.fetal_movement_count = sum.count;
    fields.fetal_movement_duration = sum.duration_minutes;
    if (!writeRollup(pregnancyId, dateStr, fields)) {
      return { skipped: true, reason: 'empty-session', ...sum };
    }
    logger.info(SCOPE, `胎动汇总写回 ${dateStr}: ${sum.session_count} 次会话 / 共 ${sum.count} 次 / ${sum.duration_minutes ?? '-'} 分钟`);
    return { skipped: false, ...sum };
  } catch (e) {
    logger.warn(SCOPE, `胎动汇总写回失败（不影响会话本身已保存）: ${e.message}`);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

/** 会话结束后同步宫缩汇总。`contraction_pain` 永远不写（只有用户手填过才有） */
function syncContraction(pregnancyId, date) {
  const dateStr = date || config.localToday();
  if (!pregnancyId) return { skipped: true, reason: 'no-pregnancy' };
  try {
    const sum = summarizeContraction(pregnancyId, dateStr);
    if (!sum.session_count) return { skipped: true, reason: 'no-session', ...sum };
    // 同胎动：一条宫缩都没记的空会话不该把用户手填的次数清零
    const fields = {};
    if (sum.count > 0) fields.contraction_count = sum.count;
    fields.contraction_duration = sum.duration_seconds;
    fields.contraction_interval = sum.interval_minutes;
    if (!writeRollup(pregnancyId, dateStr, fields)) {
      return { skipped: true, reason: 'empty-session', ...sum };
    }
    logger.info(SCOPE, `宫缩汇总写回 ${dateStr}: ${sum.session_count} 次会话 / 共 ${sum.count} 条 / 持续 ${sum.duration_seconds ?? '-'}s / 间隔 ${sum.interval_minutes ?? '-'}min`);
    return { skipped: false, ...sum };
  } catch (e) {
    logger.warn(SCOPE, `宫缩汇总写回失败（不影响会话本身已保存）: ${e.message}`);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

/**
 * 「每天取次数最高的那一次会话」—— 供**统计曲线**用（记录页展示全部明细，两者不冲突）。
 *
 * 【为什么统计不能直接用 daily_record 的汇总值】
 * 用户明确要求「每条记录都保留，用户有往回翻记录的可能」⇒ 同一天会留好几次会话。
 * 如果把一天几次**相加**去画曲线，点会被抬高，而且失去临床意义 ——
 * 胎动和宫缩看的一直都是**单次**计数（一次数满多少 / 一次宫缩持续多久），
 * 不是「一天加起来多少」。所以统计每天只取**一个**点：当天**次数最高的那一次会话**，
 * 持续 / 间隔等也一并取**同一次会话**的值，保证一个点里的数字同源、前后不打架。
 *
 * 当天没有会话（用户只手动记过）⇒ 结果里根本没有这个日期，前端就沿用
 * daily_record 里手填的那个值，不会把只手填的日子漏掉。
 *
 * 平手规则：次数相同取**更晚**的那次（`start_time DESC`），结果确定、可复现。
 */
function getDailyRepresentative(pregnancyId, startDate, endDate) {
  const out = {};
  if (!pregnancyId) return out;
  // 日期区间的 WHERE 由调用方给（不传就是全孕期）——统计页一次取回、本地切时段
  const whereFor = (params) => {
    let w = 'WHERE pregnancy_id = ?';
    if (startDate) { w += ' AND session_date >= ?'; params.push(startDate); }
    if (endDate) { w += ' AND session_date <= ?'; params.push(endDate); }
    return w;
  };

  // 胎动：排序里带 total_count DESC ⇒ 每个日期的第一条就是「次数最高的那一次」
  const fmParams = [pregnancyId];
  const fmRows = db.queryAll(
    `SELECT session_date, start_time, end_time, total_count FROM fetal_movement_session
     ${whereFor(fmParams)} ORDER BY session_date ASC, total_count DESC, start_time DESC`,
    fmParams
  );
  for (const r of fmRows) {
    const d = String(r.session_date);
    if (out[d] && out[d].fetal_movement) continue;  // 该日期已取过第一条（= 最高的那次）
    const c = Number(r.total_count) || 0;
    // ⚠️ 空会话（一次都没数就点结束）**不代表这一天** —— 与 syncFetalMovement 同一条规则。
    //    因为行是按 total_count DESC 排的，第一条为 0 就意味着这天全是空会话，
    //    于是这个日期整体不进结果，前端会沿用 daily_record 里手填的值，
    //    而不是被这个 0 覆盖掉（否则用户手填的「胎动 20 次」在图里会变成 0）。
    if (c <= 0) continue;
    const a = toSeconds(r.start_time);
    const b = toSeconds(r.end_time);
    const dur = (a !== null && b !== null && b >= a) ? Math.max(1, Math.round((b - a) / 60)) : null;
    out[d] = out[d] || {};
    out[d].fetal_movement = { count: c, duration_minutes: dur, start_time: r.start_time || null };
  }

  // 宫缩：同上，取条数最多的那一次会话；持续/间隔都取它自己的（单位：秒 / 分钟）
  const ctParams = [pregnancyId];
  const ctRows = db.queryAll(
    `SELECT session_date, start_time, end_time, total_count, avg_duration, avg_interval FROM contraction_session
     ${whereFor(ctParams)} ORDER BY session_date ASC, total_count DESC, start_time DESC`,
    ctParams
  );
  for (const r of ctRows) {
    const d = String(r.session_date);
    if (out[d] && out[d].contraction) continue;
    const c = Number(r.total_count) || 0;
    if (c <= 0) continue;  // 同胎动：空会话不代表这一天
    out[d] = out[d] || {};
    out[d].contraction = {
      count: c,
      duration_seconds: r.avg_duration == null ? null : Number(r.avg_duration),
      interval_minutes: r.avg_interval == null ? null : Math.round(Number(r.avg_interval) / 6) / 10,
      start_time: r.start_time || null,
    };
  }

  return out;
}

/** 当天会话明细（给记录页展示「每次会话」用，只读） */function getSessionDetail(pregnancyId, date) {
  const dateStr = date || config.localToday();
  const fm = db.queryAll(
    `SELECT id, start_time, end_time, total_count FROM fetal_movement_session
     WHERE pregnancy_id = ? AND session_date = ? ORDER BY start_time ASC`,
    [pregnancyId, dateStr]
  ).map((s) => ({
    id: s.id,
    start_time: s.start_time,
    end_time: s.end_time,
    count: Number(s.total_count) || 0,
    // 未结束的会话不编造时长
    duration_minutes: (() => {
      const a = toSeconds(s.start_time);
      const b = toSeconds(s.end_time);
      if (a === null || b === null || b < a) return null;
      return Math.max(1, Math.round((b - a) / 60));
    })(),
  }));
  const ct = db.queryAll(
    `SELECT id, start_time, end_time, total_count, avg_duration, avg_interval FROM contraction_session
     WHERE pregnancy_id = ? AND session_date = ? ORDER BY start_time ASC`,
    [pregnancyId, dateStr]
  ).map((s) => ({
    id: s.id,
    start_time: s.start_time,
    end_time: s.end_time,
    count: Number(s.total_count) || 0,
    avg_duration: s.avg_duration == null ? null : Number(s.avg_duration),
    avg_interval_minutes: s.avg_interval == null ? null : Math.round(Number(s.avg_interval) / 6) / 10,
  }));
  return { date: dateStr, fetal_movement: fm, contraction: ct };
}

module.exports = {
  toSeconds,
  summarizeFetalMovement,
  summarizeContraction,
  syncFetalMovement,
  syncContraction,
  getSessionDetail,
  getDailyRepresentative,
};
