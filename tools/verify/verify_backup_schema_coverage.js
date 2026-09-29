/**
 * 备份 / 导出「有没有跟上表结构」的静态全覆盖核对
 *
 * 【背景】用户问：「所有记录和前几天新增的记录，进去备份没有？」
 *   - **一键备份**是**整库文件复制**（copyFileSync(dbPath)）⇒ 数据库里有什么就备份什么，不会漏；
 *   - 但**导出到 JSON / CSV / 一键导出到指定目录**是按 `ALL_TABLES` + `TABLE_COLUMNS`
 *     逐表逐列来写的 ⇒ 只要**表清单漏一张、字段清单漏一列**，那部分数据就悄悄不在导出里。
 *     铁律 #14：加字段必须同时登记 TABLE_COLUMNS 与 ALL_TABLES。
 *
 * 本脚本做的就是把这三份东西对起来：
 *   ① db.js 的实际建表语句（真相）→ 表 → 列
 *   ② export.js 的 ALL_TABLES            → 有没有漏表
 *   ③ export.js 的 TABLE_COLUMNS         → 有没有漏列 / 多列（存量表结构变了没同步）
 * 另核对「用户在界面上填写、存在 DATA_DIR 的配置文件」是否登记进 WRITABLE_CONFIG_FILES
 *   —— 漏登记的表现是：恢复时被当成内置资源写到安装目录，**升级即丢**（铁律 #21）。
 *
 * 用法：node verify_backup_schema_coverage.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = require('./_env').REPO;
const DB_JS = path.join(ROOT, 'app/server/node/db.js');
const EXPORT_JS = path.join(ROOT, 'app/server/node/routes/export.js');

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

const dbSrc = fs.readFileSync(DB_JS, 'utf-8');
const expSrc = fs.readFileSync(EXPORT_JS, 'utf-8');

// ── ① 解析 db.js 的建表语句：表 → 列 ─────────────────────────────────────────
// 形如：CREATE TABLE IF NOT EXISTS daily_record (\n  id TEXT PRIMARY KEY,\n  weight REAL,\n ...
const schema = {};
for (const m of dbSrc.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\s*\)/g)) {
  const table = m[1];
  if (table.endsWith('__rebuild')) continue; // 重建用的临时表，不是数据表
  const cols = [];
  for (const line of m[2].split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('--')) continue;
    // 跳过表级约束
    if (/^(FOREIGN|PRIMARY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(t)) continue;
    const cm = t.match(/^([a-z_][a-z0-9_]*)\s+/i);
    if (cm) cols.push(cm[1]);
  }
  schema[table] = cols;
}
const schemaTables = Object.keys(schema).sort();

// ── ② 解析 export.js 的 ALL_TABLES ──────────────────────────────────────────
const allTablesBlock = expSrc.match(/const ALL_TABLES = \[([\s\S]*?)\];/);
check('能解析出 export.js 的 ALL_TABLES', !!allTablesBlock);
const ALL_TABLES = [...(allTablesBlock ? allTablesBlock[1] : '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check(`ALL_TABLES 解析到预期数量（数据库 ${schemaTables.length} 张表，导出 ${ALL_TABLES.length} 张）`,
  ALL_TABLES.length === schemaTables.length);
const missingTables = schemaTables.filter((t) => !ALL_TABLES.includes(t));
const extraTables = ALL_TABLES.filter((t) => !schemaTables.includes(t));
check('没有「数据库里有、导出表清单里没有」的表', missingTables.length === 0,
  '漏了: ' + missingTables.join('、'));
check('没有「导出表清单里有、数据库里已不存在」的表', extraTables.length === 0,
  '多余: ' + extraTables.join('、'));

// ── ③ 解析 TABLE_COLUMNS 并与建表列对比 ─────────────────────────────────────
// 形如：  daily_record: ['id','pregnancy_id',...],
const tableColumns = {};
for (const m of expSrc.matchAll(/^\s{2}([a-z_]+):\s*\[([\s\S]*?)\],/gm)) {
  const cols = [...m[2].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
  if (cols.length) tableColumns[m[1]] = cols;
}
const colTables = Object.keys(tableColumns);
check(`能解析出 TABLE_COLUMNS（${colTables.length} 张表）`, colTables.length >= 15);

out.push('');
out.push('【逐表逐列核对：TABLE_COLUMNS 是否覆盖建表列】');
let colProblems = 0;
for (const table of schemaTables) {
  const actual = schema[table];
  const listed = tableColumns[table];
  if (!listed) {
    colProblems++;
    out.push(`  ✘ ${table}: TABLE_COLUMNS 里没有这张表（导出会整表缺失）`);
    continue;
  }
  const missed = actual.filter((c) => !listed.includes(c));
  const surplus = listed.filter((c) => !actual.includes(c));
  if (missed.length || surplus.length) {
    colProblems++;
    out.push(`  ✘ ${table}: ${missed.length ? '漏列 ' + missed.join('、') : ''}` +
      `${surplus.length ? (missed.length ? '；' : '') + '多余列 ' + surplus.join('、') : ''}`);
  } else {
    out.push(`  ✔ ${table}: ${actual.length} 列全部登记`);
  }
}
check('每张表的列都被 TABLE_COLUMNS 完整覆盖（无漏列/无多余列）', colProblems === 0,
  colProblems + ' 张表有问题');

// ── ④ 用户填写的配置文件是否登记（漏了 ⇒ 恢复时落错目录，升级即丢）────────────
// WRITABLE_CONFIG_FILES 是「可写状态文件」白名单，其余会被当成内置只读资源。
const wcBlock = expSrc.match(/const WRITABLE_CONFIG_FILES = new Set\(\[([\s\S]*?)\]\)/);
check('能解析出 WRITABLE_CONFIG_FILES', !!wcBlock);
const WRITABLE = [...(wcBlock ? wcBlock[1] : '').matchAll(/'([^']+\.json)'/g)].map((m) => m[1]);
// 从后端源码里找出所有被写入 DATA_DIR 的 json 配置文件
const serverSrc = [];
for (const f of ['routes/push-channel-router.js', 'routes/push.js', 'routes/export.js',
  'routes/settings.js', 'services/push-engine.js', 'config.js', 'routes/reminder.js']) {
  const p = path.join(ROOT, 'app/server/node', f);
  if (fs.existsSync(p)) serverSrc.push({ f, s: fs.readFileSync(p, 'utf-8') });
}
const written = new Set();
for (const { s } of serverSrc) {
  for (const m of s.matchAll(/['"]([a-z_]+\.json)['"]/g)) written.add(m[1]);
}
// 不需登记的两类：
//  ① 内置只读知识库（随包发布、随升级更新，不是用户数据）；
//  ② `data.json` —— 导出/备份时**程序自己写出去**的数据文件（exportData 序列化），
//     属输出产物而非「用户在界面上填写的配置」。（第一版脚本把它当输入配置，误报了一条。）
const BUILTIN = new Set(['recipes.json', 'food_safety_v3.json', 'checkup_schedule.json',
  'checkup_subitem_aliases.json', 'default_checklist_zh.json', 'default_checklist_en.json',
  'package.json', 'data.json']);
const shouldRegister = [...written].filter((f) => !BUILTIN.has(f) && !f.startsWith('default_checklist'));
const notRegistered = shouldRegister.filter((f) => !WRITABLE.includes(f));
check('用户填写的配置文件都登记进 WRITABLE_CONFIG_FILES', notRegistered.length === 0,
  '漏登记: ' + notRegistered.join('、'));
out.push('');
out.push('【用户填写的配置文件（存 DATA_DIR）】');
out.push('  已登记: ' + (WRITABLE.join('、') || '(无)'));
out.push('  源码里出现但未登记: ' + (notRegistered.join('、') || '无'));

console.log(out.join('\n'));
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
