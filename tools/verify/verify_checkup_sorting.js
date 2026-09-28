/**
 * 验证产检列表排序：抽出 .vue 里的真实比较器源码，在 node 里跑（不是重新实现一遍）。
 *
 * 目标口径：
 *   - 已完成 → 按【实际完成日期】排位（用户手填优先，其次后端推导的 completed_at）
 *   - 未完成 → 按【计划日期】排位（标准 = LMP 推算的预计日期；自定义 = 约定检查日期）
 *   - 未设置孕期（拿不到计划日期）→ 退回原有按孕周的顺序，行为不变
 */
const path = require('path');
const { buildFunctions } = require('./_vue_extract');

const ROOT = require('./_env').REPO;
const VUE = path.join(ROOT, 'frontend/src/views/CheckupScheduleView.vue');

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

const built = buildFunctions(VUE, ['completionDateOf', 'sortDateOf', 'compareCheckupItems'], {
  scheduleDates: { value: {} },   // 测试里始终显式传 manualDates；这里只是防 ReferenceError
});
check('能从 .vue 抽出排序相关函数并可执行', built.ok,
  built.ok ? 'ok' : `缺失=[${built.missing}] err=${built.error && built.error.message}`);
if (!built.ok) {
  if (built.generated) console.log('--- 生成代码 ---\n' + built.generated + '\n---------------');
  console.log('\n通过 0 / ' + results.length + '，失败 ' + results.length);
  process.exit(1);
}
const { sortDateOf, compareCheckupItems } = built.api;

// ---- 造数据 ----
const S = (id, name, ws, expected, extra = {}) => ({
  _key: 'std_' + id, _type: 'standard', id, name, week_start: ws,
  expected_date: expected, is_completed: false, ...extra,
});
const C = (id, name, date, extra = {}) => ({
  _key: 'cst_' + id, _type: 'custom', id, name, checkup_date: date,
  week_start: extra.week_start, is_completed: false, ...extra,
});

const sortNew = (items, hasLmp = true, manual = {}) =>
  [...items].sort((a, b) => compareCheckupItems(a, b, hasLmp, manual)).map(i => i.name);
// 旧口径（仅按计划孕周），用于证明这次改动确实改变了结果
const sortOld = (items) => [...items].sort((a, b) => {
  const aw = a.week_start ?? 999, bw = b.week_start ?? 999;
  if (aw !== bw) return aw - bw;
  if (a._type !== b._type) return a._type === 'standard' ? -1 : 1;
  return (a.checkup_date || '').localeCompare(b.checkup_date || '');
}).map(i => i.name);

// ---------- T1 用户抱怨的场景：自定义条目按真实日期落位 ----------
{
  const items = [
    C('c1', '4月10日 专项检查', '2026-04-10', { week_start: 10 }),
    C('c2', '建档立卡', '2026-05-01', { week_start: 11 }),
    C('c3', '4月28日 复查', '2026-04-28', { week_start: 12 }),
  ];
  const got = sortNew(items);
  const want = ['4月10日 专项检查', '4月28日 复查', '建档立卡'];
  check('T1 自定义条目改按真实日期排（建档立卡不再夹在两条4月条目中间）',
    JSON.stringify(got) === JSON.stringify(want), `期望=${JSON.stringify(want)} 实际=${JSON.stringify(got)}`);
  check('T1b 对照：旧口径确实会把「建档立卡」插到中间（证明修补有意义）',
    JSON.stringify(sortOld(items)) !== JSON.stringify(want), `旧口径=${JSON.stringify(sortOld(items))}`);
}

// ---------- T2 已完成按【实际完成日期】排 ----------
{
  const items = [
    S('cs_002', 'NT检查（早期唐筛）', 11, '2026-03-25', { is_completed: true, completed_at: '2026-04-10' }),
    S('cs_004', '大排畸（系统超声）', 20, '2026-05-20', { is_completed: true, completed_at: '2026-03-28' }),
  ];
  const got = sortNew(items);
  const want = ['大排畸（系统超声）', 'NT检查（早期唐筛）'];
  check('T2 两项都已完成时，按各自实际完成日期先后排（大排畸3/28 先于 NT4/10）',
    JSON.stringify(got) === JSON.stringify(want), `期望=${JSON.stringify(want)} 实际=${JSON.stringify(got)}`);
  check('T2b 对照：旧口径是按孕周排（NT 11周 先于 大排畸 20周）',
    JSON.stringify(sortOld(items)) !== JSON.stringify(want), `旧口径=${JSON.stringify(sortOld(items))}`);
}

// ---------- T3 用户手填的完成日期优先于后端推导值 ----------
{
  const a = S('cs_004', '大排畸', 20, '2026-05-20', { is_completed: true, completed_at: '2026-03-28' });
  check('T3 无手填时用后端推导的 completed_at', sortDateOf(a, {}) === '2026-03-28', `key=${sortDateOf(a, {})}`);
  check('T3b 有手填时手填值覆盖后端推导值',
    sortDateOf(a, { cs_004: '2026-05-05' }) === '2026-05-05', `key=${sortDateOf(a, { cs_004: '2026-05-05' })}`);
}

// ---------- T4 已完成/未完成混排：各自用自己的日期，同处一条时间线 ----------
{
  const items = [
    S('cs_010', '足周初检', 37, '2026-09-10', { is_completed: false }),
    S('cs_004', '大排畸', 20, '2026-05-20', { is_completed: true, completed_at: '2026-04-02' }),
    S('cs_002', 'NT检查', 11, '2026-03-25', { is_completed: false }),
  ];
  const got = sortNew(items);
  const want = ['NT检查', '大排畸', '足周初检'];
  check('T4 已完成项按实际完成日期、未完成项按计划日期，混排成一条时间线',
    JSON.stringify(got) === JSON.stringify(want), `期望=${JSON.stringify(want)} 实际=${JSON.stringify(got)}`);
}

// ---------- T5 推不出日期的条目沉底 ----------
{
  const items = [
    S('cs_015', '过期妊娠处理', 42, undefined),
    S('cs_001', '早孕检查', 6, '2026-02-01'),
  ];
  const got = sortNew(items);
  check('T5 没有可用日期的条目排到最后',
    JSON.stringify(got) === JSON.stringify(['早孕检查', '过期妊娠处理']), `实际=${JSON.stringify(got)}`);
}

// ---------- T6 未设置孕期：退回原有按孕周顺序（行为不变） ----------
{
  const items = [
    C('c2', '建档立卡', '2026-05-01', { week_start: 11 }),
    S('cs_002', 'NT检查', 11, undefined),
  ];
  const got = sortNew(items, false);
  check('T6 未设置孕期时退回按孕周排（同日标准条目优先）',
    JSON.stringify(got) === JSON.stringify(['NT检查', '建档立卡']), `实际=${JSON.stringify(got)}`);
  check('T6b 未设置孕期时与旧口径结果一致',
    JSON.stringify(got) === JSON.stringify(sortOld(items)), `旧口径=${JSON.stringify(sortOld(items))}`);
}

// ---------- T7 同一日期：退回原有次序链（孕周 → 类型 → 约定日期），与旧版完全一致 ----------
{
  const items = [
    C('c1', '自定义同日', '2026-04-10', { week_start: 10 }),
    S('cs_003', '标准同日', 15, '2026-04-10'),
  ];
  const got = sortNew(items);
  check('T7 同一日期时不引入新行为，与旧口径结果一致（保持稳定/可预期）',
    JSON.stringify(got) === JSON.stringify(sortOld(items)), `新=${JSON.stringify(got)} 旧=${JSON.stringify(sortOld(items))}`);
}

const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log('\n================ 结果 ================');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  || ${r.detail}`);
console.log(`\n通过 ${pass} / ${results.length}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
