/**
 * 用药/补充「该不该服」的判定规则 —— 纯函数级回归（不起服务、不连库，秒级）。
 *
 * 为什么单独有一套：`isPlanDueOn` 是「今天该不该吃」的唯一真源，
 * 一旦这里判错，症状是**用户以为吃了/没吃**，而且不报错、不崩溃，很难被发现。
 * 上线前检查就是靠 7 天节奏串（`1010101`）抓出两个静默错判：
 *
 *   #4 隔天方案：编辑后 start_date 被清空 ⇒ 旧实现用「查询日」当锚 ⇒ 差值恒为 0 ⇒ `1111111`
 *   #5 每周指定：`if (days.length)` 让空数组跳过过滤 ⇒ 一天都没勾反而每天提醒 ⇒ `1111111`
 *
 * ⚠️ 本套件刻意把「修复前的行为」也实现一遍做对照（`rhythmLegacy` / 旧 weekdays 分支），
 *    否则断言可能恒真 —— 那样这两个缺陷下次照样能溜进来。
 *
 * ⚠️ 生成日期序列必须用**本地**格式化。用 `toISOString().slice(0,10)` 会整体错位一天
 *    （本地 00:00 的 ISO 是前一天 16:00），把正确结果判成红（铁律 #5，写测试也一样踩）。
 *
 * 时区：**套件自带 TZ=Asia/Shanghai**（见下方），不依赖跑测机器的时区设置 ——
 *       否则在 UTC 机器上「UTC→本地 换算」这组断言会假红。
 */
// ⚠️ 必须在 require 业务模块之前设（实测 Node 里运行时改 process.env.TZ 会生效）
process.env.TZ = 'Asia/Shanghai';

const path = require('path');
const { SERVER_DIR } = require('./_env');

const svc = require(path.join(SERVER_DIR, 'services', 'dose-plan-service'));

let pass = 0;
let failed = 0;
const assert = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  🔴 ' + name + (extra ? '  → ' + extra : '')); }
};

const pad = (n) => String(n).padStart(2, '0');
const fmtLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateSeq = (fromDate, n = 7) => {
  const base = new Date(fromDate + 'T00:00:00');
  return Array.from({ length: n }, (_, i) => fmtLocal(new Date(base.getTime() + i * 86400000)));
};

/** 7 天「该不该服」串 —— 走**当前真实实现** */
const rhythm = (plan, fromDate) =>
  dateSeq(fromDate).map((ds) => (svc.isPlanDueOn(plan, ds, 20) ? '1' : '0')).join('');

/** 复现修复前：锚点 = `start_date || 查询日`（锚点每次都等于查询日 ⇒ 恒 due） */
const rhythmLegacy = (plan, fromDate) =>
  dateSeq(fromDate).map((ds) => {
    const anchor = plan.start_date || ds;
    const days = Math.round((new Date(ds + 'T00:00:00') - new Date(anchor + 'T00:00:00')) / 86400000);
    return Math.abs(days) % 2 === 0 ? '1' : '0';
  }).join('');

const BASE = {
  kind: 'supplement', name: 'x', frequency: 'daily', weekdays: '[]',
  start_date: null, created_at: '2026-09-30 01:00:00', is_enabled: 1, note: '',
};

console.log(`本地时间 ${new Date().toString().slice(0, 33)}（应为 GMT+0800）`);
if (new Date().getTimezoneOffset() !== -480) {
  console.log('🔴 TZ 未生效：本套件依赖 UTC+8 语义来暴露「UTC 与本地差一天」的缺陷');
}

// ============ #4 隔天方案的锚点 ============
console.log('\n【#4】「隔天」方案 7 天节奏');
// UTC 23:37 = 本地(UTC+8) 次日 07:37 —— 最容易被算错一天的边界时刻
const staleInterval = { ...BASE, name: '铁剂(隔天)', frequency: 'interval2', start_date: null, created_at: '2026-09-29 23:37:00' };

assert('localDateOf：UTC 23:37 换算成本地次日',
  svc.localDateOf('2026-09-29 23:37:00') === '2026-09-30',
  svc.localDateOf('2026-09-29 23:37:00'));
assert('localDateOf：纯日期原样返回（不误当 UTC）',
  svc.localDateOf('2026-09-30') === '2026-09-30', svc.localDateOf('2026-09-30'));
assert('localDateOf：空值返回空串（不崩）', svc.localDateOf(null) === '');

const legacy4 = rhythmLegacy(staleInterval, '2026-09-30');
const fixed4 = rhythm(staleInterval, '2026-09-30');
console.log(`  修复前(锚点=查询日) = ${legacy4}   ← 每天都提醒`);
console.log(`  现在(本地换算兜底)  = ${fixed4}`);
assert('修复前确实退化成每天都提醒（缺陷真实存在）', legacy4 === '1111111', legacy4);
assert('现在是无锚点脏数据的正确隔天节奏', fixed4 === '1010101', fixed4);
assert('两者不同（断言不恒真）', legacy4 !== fixed4);

const freshInterval = { ...staleInterval, start_date: '2026-09-30' };
assert('有 start_date 的新数据节奏正确', rhythm(freshInterval, '2026-09-30') === '1010101',
  rhythm(freshInterval, '2026-09-30'));
assert('隔天：第二天不吃（不是每天）', rhythm(freshInterval, '2026-09-30')[1] === '0');

// ============ #5 每周指定空数组 ============
console.log('\n【#5】「每周指定」一天都不勾');
const emptyWd = { ...BASE, name: '空星期', frequency: 'weekdays', weekdays: '[]' };
assert('空 weekdays ⇒ 一天都不 due（修复前是每天都提醒）',
  rhythm(emptyWd, '2026-09-30') === '0000000', rhythm(emptyWd, '2026-09-30'));

// 反向对照：勾周一必须真的只在周一（不是全 1 也不是全 0）
// 2026-09-30 是周三 ⇒ 序列 三四五六日一二 ⇒ 周一落在第 6 位
const monday = { ...emptyWd, weekdays: '[1]' };
const rMon = rhythm(monday, '2026-09-30');
console.log(`  勾「周一」= ${rMon}（2026-09-30 是周三）`);
assert('勾周一 ⇒ 只在周一 due', rMon === '0000010', rMon);

// 周日的 ISO 值要到 7（JS getDay() 的 0 必须换算）
// 2026-09-30 是周三 ⇒ 序列索引 0=三 1=四 2=五 3=六 4=日 5=一 6=二
const sunday = { ...emptyWd, weekdays: '[7]' };
const rSun = rhythm(sunday, '2026-09-30');
console.log(`  勾「周日」= ${rSun}`);
assert('勾周日 ⇒ 只在周日 due（JS 的 0=周日 必须换算成 7）', rSun === '0000100', rSun);

// ============ 防误伤 ============
console.log('\n【回归】其它情形不受影响');
assert('daily 仍然每天 due', rhythm({ ...BASE, frequency: 'daily' }, '2026-09-30') === '1111111');
assert('停用方案哪天都不 due', rhythm({ ...BASE, frequency: 'daily', is_enabled: 0 }, '2026-09-30') === '0000000');
assert('起止日期之外不 due',
  rhythm({ ...BASE, frequency: 'daily', start_date: '2026-10-03' }, '2026-09-30') === '0001111');
assert('孕周未到不 due（今天 20 周 < 30）',
  rhythm({ ...BASE, frequency: 'daily', start_week: 30 }, '2026-09-30') === '0000000');
assert('孕周已过不 due（今天 20 周 > 10）',
  rhythm({ ...BASE, frequency: 'daily', end_week: 10 }, '2026-09-30') === '0000000');
assert('weekdays 字段是非法 JSON 时按「一天都不吃」处理，不崩',
  rhythm({ ...emptyWd, weekdays: '{坏值' }, '2026-09-30') === '0000000',
  rhythm({ ...emptyWd, weekdays: '{坏值' }, '2026-09-30'));

console.log(`\n==== 结果：${pass} 通过 / ${failed} 失败 ====`);
process.exit(failed ? 1 : 0);
