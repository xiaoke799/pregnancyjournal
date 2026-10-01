/**
 * 时间字符串归一化 —— 「同一个列里混着两种写法」的统一入口。
 *
 * 【为什么需要】
 * `contraction` 表的 `start_time` / `end_time` 历史上有**两种写法**：
 *   · 自动计时（start / end 动作）：服务端写 `new Date().toTimeString().slice(0, 8)`
 *     ⇒ 'HH:MM:SS'（**本地**墙钟时间）
 *   · 手动补记（manual 动作）：前端 `n-date-picker` 给的是本地时间，经
 *     `dayjs(...).toISOString()` 变成 **UTC ISO**（'2026-10-01T06:30:00.000Z'）后**原样落库**
 * 而所有下游都按 'HH:MM:SS' 解析 ⇒ 四种静默故障（构建、类型检查、vue-tsc 全都发现不了）：
 *   ① `new Date('2000-01-01 ' + iso)` = Invalid Date ⇒ 时长算成 NaN ⇒ 存进 SQLite 变成 NULL；
 *   ② `refreshSessionAggregate` 的 total_duration 被 NaN 污染 ⇒ **整个会话**的平均时长变 NULL；
 *   ③ `ORDER BY start_time` 是**字符串**比较 ⇒ '1' 开头的 'HH:MM:SS' 永远排在 '2' 开头的 ISO
 *      前面 ⇒ 明细乱序、`analysis` 取「最后一条」取错；
 *   ④ `analysis` 的 `sessionDate + 'T' + iso` 解析失败 ⇒ 那条宫缩被整个忽略。
 *   净效果：**手动补记一条宫缩，当天记录的「宫缩持续时长」整体丢失**（连自动记的一起）。
 *
 * 【口径】输出一律是**本地** 'HH:MM:SS'（与自动计时写入的格式完全一致）⇒
 *   写侧落库后格式统一，读侧对已存在的老 ISO 行也能正确解析（读时归一）。
 *   解析不出来一律返回 null，由调用方按「没有时间」处理 —— **绝不把 NaN 往下游传**。
 *
 * 【为什么单独一个文件】纯函数、零依赖 ⇒ 回归可以**直接 require 单测**（不必起后端），
 *   见 `tools/verify/probe_contraction_manual_time.js`。
 */

/** 'H:MM' / 'HH:MM' / 'HH:MM:SS' 或任意 Date 可解析的字符串 → 本地 'HH:MM:SS'；无法识别返回 null */
function toHmsLocal(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  // 已经是「时:分[:秒]」的写法：补零后原样返回（'9:5:3' 这类不合法写法不会被匹配，落到下面的 Date 分支）
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const p = s.split(':');
    return `${String(p[0]).padStart(2, '0')}:${p[1]}:${p[2] || '00'}`;
  }
  // ISO / 其它可解析写法：交给 Date，再按**本地时区**转回墙钟时间
  // （自动计时写入的也是本地墙钟时间，两者必须同口径，否则会差 8 小时）
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toTimeString().slice(0, 8);
}

/**
 * 两个墙钟时刻之间的**秒数**，跨午夜自动 +24h（宫缩计时常在深夜，跨零点不能算成负数）。
 * 任一无法识别返回 null —— 调用方据此跳过，不要编造 0。
 */
function hmsDiffSeconds(from, to) {
  const a = toHmsLocal(from);
  const b = toHmsLocal(to);
  if (a === null || b === null) return null;
  let sec = (new Date(`2000-01-01 ${b}`) - new Date(`2000-01-01 ${a}`)) / 1000;
  if (!Number.isFinite(sec)) return null;
  if (sec < 0) sec += 86400;
  return Math.round(sec);
}

module.exports = { toHmsLocal, hmsDiffSeconds };
