const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const rollup = require('../services/daily-rollup');
// 时间归一入口：`contraction.start_time/end_time` 历史上混着 'HH:MM:SS'（自动计时）
// 与 ISO（早期手动补记原样落库）两种写法，所有解析都必须过这里（详见该文件注释）。
const { toHmsLocal, hmsDiffSeconds } = require('../services/hms-time');

/**
 * 按明细重算会话汇总（`avg_duration` / `avg_interval` 都是**秒**）。
 *
 * 抽出来的理由有二：
 *  ① 「结束计时」和「每记一条宫缩」都要算同一份东西 —— 原来这段只写在 PUT 里，
 *     于是**用户不点结束就直接关掉应用，会话的时长/间隔永远是空**，
 *     写回当天记录时就没有这两项（记录页只看得到次数）。
 *  ② 汇总只有一个算法，避免两处各写一遍、慢慢算得不一样。
 *
 * `end_time` 传了就连同结束时间一起落库（= 结束会话），不传只刷新汇总。
 */
function refreshSessionAggregate(sessionId, endTime) {
  // ⚠️ 排序放在 **JS 里按归一后的时间**做，不能交给 SQL：这一列历史上混着
  //    'HH:MM:SS'（自动计时）与 ISO（早期手动补记）两种写法，字符串比较会把
  //    '1' 开头的 'HH:MM:SS' 永远排在 '2' 开头的 ISO 前面 ⇒ 顺序与真实时间无关
  //    （进而让「第一条没有间隔」的判断也落错位置）。
  const contractions = db.queryAll(
    `SELECT * FROM contraction WHERE session_id = ?`,
    [sessionId]
  ).sort((a, b) =>
    String(toHmsLocal(a.start_time) || '').localeCompare(String(toHmsLocal(b.start_time) || ''))
  );
  const total_count = contractions.length;
  let total_duration = 0;
  let total_interval = 0;
  let interval_count = 0;
  for (let i = 0; i < contractions.length; i++) {
    const c = contractions[i];
    // 时长一律走归一入口：老库里手动补记的行是 ISO，直接拼 '2000-01-01 ' 会得到
    // Invalid Date ⇒ NaN ⇒ 污染**整个会话**的平均时长（落库变 NULL），
    // 连带当天记录的「宫缩持续时长」一起丢。算不出（缺 end_time）时返回 null，跳过。
    const sec = hmsDiffSeconds(c.start_time, c.end_time);
    if (sec !== null) total_duration += sec;
    // 第一条宫缩没有「距上一次的间隔」
    if (i > 0 && c.interval_from_prev != null) {
      total_interval += c.interval_from_prev;
      interval_count++;
    }
  }
  // ⚠️ 分母是 total_count（不是「有 end_time 的条数」）—— 保留原口径，
  // 否则进行中还未结束的那一条会让平均值虚高。
  const avg_duration = total_count > 0 ? Math.round(total_duration / total_count) : null;
  const avg_interval = interval_count > 0 ? Math.round(total_interval / interval_count) : null;
  if (endTime) {
    db.run(
      `UPDATE contraction_session SET end_time = ?, total_count = ?, avg_duration = ?, avg_interval = ? WHERE id = ?`,
      [endTime, total_count, avg_duration, avg_interval, sessionId]
    );
  } else {
    db.run(
      `UPDATE contraction_session SET total_count = ?, avg_duration = ?, avg_interval = ? WHERE id = ?`,
      [total_count, avg_duration, avg_interval, sessionId]
    );
  }
  return { total_count, avg_duration, avg_interval };
}

router.post('/contractions/sessions', async (req, res) => {
  try {
    const { pregnancy_id, session_date, start_time } = req.body;
    if (!pregnancy_id) return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    const now = new Date();
    // 用本地日期：toISOString 是 UTC，东八区凌晨会把会话记成前一天
    const dateStr = session_date || config.localToday(now);
    const timeStr = start_time || now.toTimeString().slice(0, 8);
    const id = db.generateId();
    await db.run(
      `INSERT INTO contraction_session (id, pregnancy_id, session_date, start_time, end_time, total_count, avg_duration, avg_interval, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, NULL, NULL, datetime('now'))`,
      [id, pregnancy_id, dateStr, timeStr]
    );
    const row = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions', async (req, res) => {
  try {
    const { pregnancy_id, date } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (pregnancy_id) { where += ' AND pregnancy_id = ?'; params.push(pregnancy_id); }
    // 记录页按「某一天」取会话明细，用它展示当天记了几次、各多少条
    if (date) { where += ' AND session_date = ?'; params.push(date); }
    const rows = await db.queryAll(`SELECT * FROM contraction_session ${where} ORDER BY session_date DESC, start_time DESC`, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions/:id', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!row) return res.json({ code: 1001, data: null, message: '会话不存在' });
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.put('/contractions/sessions/:id', async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!existing) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const now = new Date().toTimeString().slice(0, 8);
    refreshSessionAggregate(req.params.id, now);
    // 「结束计时」= 这次宫缩记录生效的时刻：把当天所有会话汇总写回 daily_record
    // （记录列表 / 统计 / CSV 都只读 daily_record，不写回就等于计时白记）。
    // 注意 avg_interval 是**秒**，rollup 里负责换算成记录页要的分钟。
    // 会话明细仍在 contraction(_session) 表里，一条不动。
    rollup.syncContraction(existing.pregnancy_id, existing.session_date);
    const row = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    res.json({ code: 0, data: row, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.post('/contractions/sessions/:id/contractions', async (req, res) => {
  try {
    const { action, start_time, end_time } = req.body;
    const session = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!session) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const now = new Date().toTimeString().slice(0, 8);
    if (action === 'start') {
      // 本次这条宫缩的起点：调用方若显式传了时间（可能是 ISO），先归一成本地 'HH:MM:SS'
      const startHms = toHmsLocal(start_time) || now;
      const activeContraction = await db.queryOne(
        `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [req.params.id]
      );
      if (activeContraction) {
        await db.run('UPDATE contraction SET end_time = ? WHERE id = ?', [now, activeContraction.id]);
        // 时长走归一入口（这一列可能是老库里的 ISO 写法）；算不出就不写，
        // 宁可不给时长，也不要写个 NaN 进库（SQLite 会把 NaN 存成 NULL）
        const autoDur = hmsDiffSeconds(activeContraction.start_time, now);
        if (autoDur !== null) {
          await db.run('UPDATE contraction SET duration = ? WHERE id = ?', [autoDur, activeContraction.id]);
        }
      }
      // 取「时间上最晚的一条已结束宫缩」做间隔基准。不能用 SQL 的 `ORDER BY start_time DESC`：
      // 该列混着 'HH:MM:SS' 与 ISO 老写法，字符串排序的结果与真实时间无关。
      const doneRows = await db.queryAll(
        `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NOT NULL`,
        [req.params.id]
      );
      doneRows.sort((a, b) =>
        String(toHmsLocal(a.start_time) || '').localeCompare(String(toHmsLocal(b.start_time) || ''))
      );
      const lastContraction = doneRows[doneRows.length - 1];
      let interval_from_prev = null;
      if (lastContraction && lastContraction.end_time) {
        const diff = hmsDiffSeconds(lastContraction.end_time, startHms);
        if (diff !== null) interval_from_prev = diff;
      }
      const id = db.generateId();
      await db.run(
        `INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
        [id, req.params.id, startHms, interval_from_prev]
      );
      const row = await db.queryOne('SELECT * FROM contraction WHERE id = ?', [id]);
      // 每记一条宫缩就刷新会话汇总 + 同步当天记录（理由同胎动：不点「结束计时」也不能丢）
      refreshSessionAggregate(req.params.id);
      rollup.syncContraction(session.pregnancy_id, session.session_date);
      res.json({ code: 0, data: row, message: 'success' });
    } else if (action === 'end') {
      const activeContraction = await db.queryOne(
        `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [req.params.id]
      );
      if (!activeContraction) return res.json({ code: 1001, data: null, message: '没有进行中的宫缩' });
      const endHms = toHmsLocal(end_time) || now;
      await db.run('UPDATE contraction SET end_time = ? WHERE id = ?', [endHms, activeContraction.id]);
      // 同上：时长走归一入口，算不出就不写（避免 NaN 落库变 NULL）
      const endDur = hmsDiffSeconds(activeContraction.start_time, endHms);
      if (endDur !== null) {
        await db.run('UPDATE contraction SET duration = ? WHERE id = ?', [endDur, activeContraction.id]);
      }
      const row = await db.queryOne('SELECT * FROM contraction WHERE id = ?', [activeContraction.id]);
      refreshSessionAggregate(req.params.id);
      rollup.syncContraction(session.pregnancy_id, session.session_date);
      res.json({ code: 0, data: row, message: 'success' });
    } else if (action === 'manual') {
      if (!start_time || !end_time) return res.json({ code: 1001, data: null, message: '手动模式需要start_time和end_time' });
      // 🔴 归一成本地 'HH:MM:SS' 再落库。前端 n-date-picker 给的是**本地**时间，
      //    经 `dayjs(...).toISOString()` 变成 **UTC ISO** 才发过来；以前直接
      //    `new Date('2000-01-01 ' + iso)` ⇒ Invalid Date ⇒ duration = NaN ⇒
      //    存进 SQLite 变 NULL，且 refreshSessionAggregate 把**整个会话**的平均时长
      //    一起污染成 NULL —— 用户看到的就是「手动补记一条宫缩，当天时长全没了」。
      //    同时落库格式与自动计时统一，明细排序、5-1-1 分析也一起恢复正确。
      const startHms = toHmsLocal(start_time);
      const endHms = toHmsLocal(end_time);
      if (startHms === null || endHms === null) {
        return res.json({ code: 1001, data: null, message: '时间格式无法识别' });
      }
      const duration = hmsDiffSeconds(startHms, endHms);
      // 取时间上最晚的那一条做「距上一次间隔」的基准；同样先归一（老行可能是 ISO），
      // 否则排序会落在错误的位置上。
      const allRows = await db.queryAll(`SELECT * FROM contraction WHERE session_id = ?`, [req.params.id]);
      allRows.sort((a, b) =>
        String(toHmsLocal(a.start_time) || '').localeCompare(String(toHmsLocal(b.start_time) || ''))
      );
      const lastContraction = allRows[allRows.length - 1];
      let interval_from_prev = null;
      if (lastContraction && lastContraction.end_time) {
        const diff = hmsDiffSeconds(lastContraction.end_time, startHms);
        // 负值（补记的时刻早于上一条）宁可不给间隔，也不要往库里写负数
        if (diff !== null && diff >= 0) interval_from_prev = diff;
      }
      const id = db.generateId();
      await db.run(
        `INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [id, req.params.id, startHms, endHms, duration, interval_from_prev]
      );
      const row = await db.queryOne('SELECT * FROM contraction WHERE id = ?', [id]);
      refreshSessionAggregate(req.params.id);
      rollup.syncContraction(session.pregnancy_id, session.session_date);
      res.json({ code: 0, data: row, message: 'success' });
    } else {
      res.json({ code: 1001, data: null, message: '无效的action，支持: start/end/manual' });
    }
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions/:id/contractions', async (req, res) => {
  try {
    const rows = await db.queryAll(
      `SELECT * FROM contraction WHERE session_id = ?`,
      [req.params.id]
    );
    // 老库里同一列混着 'HH:MM:SS'（自动计时）与 ISO（早期手动补记）⇒ SQL 字符串排序
    // 会把 ISO 行整批甩到 'HH:MM:SS' 行前后、与真实先后无关；在 JS 里按归一后的时间排。
    rows.sort((a, b) =>
      String(toHmsLocal(a.start_time) || '').localeCompare(String(toHmsLocal(b.start_time) || ''))
    );
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

router.get('/contractions/sessions/:id/analysis', async (req, res) => {
  try {
    const session = await db.queryOne('SELECT * FROM contraction_session WHERE id = ?', [req.params.id]);
    if (!session) return res.json({ code: 1001, data: null, message: '会话不存在' });
    const contractions = await db.queryAll(
      `SELECT * FROM contraction WHERE session_id = ? AND end_time IS NOT NULL ORDER BY start_time ASC`,
      [req.params.id]
    );
    const total_count = contractions.length;
    let total_duration = 0;
    let total_interval = 0;
    let interval_count = 0;
    for (let i = 0; i < contractions.length; i++) {
      const c = contractions[i];
      if (c.duration) total_duration += c.duration;
      if (c.interval_from_prev !== null) { total_interval += c.interval_from_prev; interval_count++; }
    }
    const avg_duration = total_count > 0 ? Math.round(total_duration / total_count) : 0;
    const avg_interval = interval_count > 0 ? Math.round(total_interval / interval_count) : 0;

    // ---------- 把「HH:MM:SS」还原成会话自己的时间轴 ----------
    // ⚠️ 绝不能用 Date.now() 当「现在」：那样「最近一小时」是相对真实墙钟算的，
    // 回头分析昨晚/上周的会话时，所有宫缩都落在窗口之外，last_hour_count 恒为 0，
    // 结论永远掉到「暂无足够数据」——历史会话的分析等于没用。
    // 这里改用**该会话最后一次宫缩的时间**作为锚点。
    const sessionDate = session.session_date;
    // 会话表的时间一直是 'HH:MM:SS'，但同样过一遍归一入口（防脏数据），
    // 且与下面逐条宫缩的解析口径保持一致。
    const sessionStartHms = toHmsLocal(session.start_time);
    const sessionStartTs = sessionStartHms
      ? new Date(sessionDate + 'T' + sessionStartHms).getTime()
      : null;
    const tsOf = (c) => {
      // 🔴 必须归一：早期手动补记的行 start_time 是 ISO，`sessionDate + 'T' + iso`
      //    拼出来解析失败 ⇒ 这条被判 null 整个忽略，窗口计数与跨度都算不准。
      const hms = toHmsLocal(c.start_time);
      if (!hms) return null;
      let ts = new Date(sessionDate + 'T' + hms).getTime();
      if (!Number.isFinite(ts)) return null;
      // 处理跨午夜：若宫缩时间早于会话开始时间，说明已跨到次日
      if (sessionStartTs !== null && Number.isFinite(sessionStartTs) && ts < sessionStartTs) {
        ts += 24 * 60 * 60 * 1000;
      }
      return ts;
    };

    const timeline = contractions.map(tsOf).filter(t => t !== null);
    const anchorTs = timeline.length ? timeline.reduce((a, b) => (b > a ? b : a)) : null;

    // ---------- 最近一小时窗口（相对会话锚点） ----------
    const WINDOW_MS = 60 * 60 * 1000;
    // 「已持续满 1 小时」的判定留 5 分钟余量：用户往往不是在宫缩真正开始的那一刻
    // 就打开计时器的，要求严丝合缝满 60 分钟会把真实产程判成不满足。
    const SPAN_MIN_MINUTES = 55;

    const last_hour_contractions = anchorTs === null ? [] : contractions.filter(c => {
      const ts = tsOf(c);
      return ts !== null && ts <= anchorTs && ts >= anchorTs - WINDOW_MS;
    });
    const last_hour_count = last_hour_contractions.length;

    const windowFirstTs = last_hour_contractions
      .map(tsOf)
      .filter(t => t !== null)
      .reduce((a, b) => (a === null || b < a ? b : a), null);
    const window_span_minutes = (anchorTs !== null && windowFirstTs !== null)
      ? Math.round((anchorTs - windowFirstTs) / 60000)
      : 0;

    const allLongEnough = last_hour_count > 0 && last_hour_contractions.every(c => (c.duration || 0) >= 60);

    // 5-1-1 = 每 5 分钟 1 次 + 每次持续 1 分钟以上 + **持续满 1 小时**。
    // ⚠️ 第三个「1」原来完全没校验：只要 12 次宫缩落在「距当前 60 分钟的滚动窗口」内就判定满足
    // ——实测 12 次宫缩哪怕只跨 16.5 分钟，也会直接给出「已满足 5-1-1，建议立即前往医院待产」。
    // 现在必须同时满足「窗口内首末宫缩的真实跨度 ≥ 55 分钟」。
    const is_511_met = last_hour_count >= 12 && allLongEnough && window_span_minutes >= SPAN_MIN_MINUTES;

    // 会话说到底是不是「刚记的」：超过 3 小时就明确提示这是历史记录，
    // 免得用户拿昨天会话的结论判断今天要不要去医院。
    const hoursSinceAnchor = anchorTs === null ? 0 : (Date.now() - anchorTs) / 3600000;
    const isHistorical = hoursSinceAnchor > 3;

    let recommendation = '';
    if (is_511_met) {
      recommendation = '已满足5-1-1规则（宫缩每5分钟1次、每次持续超过1分钟，并已持续1小时以上），建议立即前往医院待产。';
    } else if (last_hour_count >= 12 && allLongEnough) {
      // 密度够了、只差「持续满 1 小时」——这正是原来被漏掉的那个「1」。
      recommendation = `宫缩已达到「每5分钟1次、每次持续超过1分钟」的密度，但本次记录的跨度只有约 ${window_span_minutes} 分钟，还没满1小时。请继续记录：如持续满1小时请立即前往医院。`;
    } else if (avg_interval > 0 && avg_interval <= 300 && last_hour_count >= 6) {
      recommendation = '宫缩频率较高，正在接近5-1-1规则，请密切观察并做好前往医院的准备。';
    } else if (total_count >= 3 && avg_duration >= 30) {
      recommendation = '宫缩已经开始规律出现，但尚未达到5-1-1标准，请继续观察宫缩变化趋势。';
    } else if (total_count > 0) {
      recommendation = '目前宫缩尚不规律或频率较低，继续在家休息观察即可。';
    } else {
      recommendation = '暂无足够数据进行5-1-1规则分析，请继续记录宫缩情况。';
    }
    if (isHistorical) {
      recommendation += `（注意：这是约 ${Math.round(hoursSinceAnchor)} 小时前的记录，不能代表当前情况；如现在仍有宫缩，请新建会话重新记录。）`;
    }

    res.json({
      code: 0,
      data: {
        session_id: req.params.id,
        total_count,
        avg_duration,
        avg_interval,
        last_hour_count,
        // 本次窗口内「首次宫缩 → 末次宫缩」的真实跨度（分钟），供前端/排查核对
        window_span_minutes,
        is_511_met,
        recommendation
      },
      message: 'success'
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

module.exports = router;
