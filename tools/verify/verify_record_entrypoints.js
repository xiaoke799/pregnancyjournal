/**
 * 记录类「全入口」静态核查
 *
 * 背景：记录类新增一个类型，至少要接上 6 个入口（历史上漏一处就会出现
 * 「用户说这个功能没有」）。本脚本把每个类型在每个入口的存在性逐一断言。
 *
 * 用法：node verify_record_entrypoints.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = require('./_env').REPO;
const F = {
  dialog: `${ROOT}/frontend/src/components/record/AddRecordDialog.vue`,
  list: `${ROOT}/frontend/src/components/record/RecordList.vue`,
  view: `${ROOT}/frontend/src/views/RecordView.vue`,
  /** 统计卡片已抽成共享组件：记录页「统计」标签 与 独立「统计」页 都用它。
   *  ⚠️ 三围/胎心/宫缩这些统计卡现在断言这个文件，别再回 RecordView 里找（会假红）。 */
  panel: `${ROOT}/frontend/src/views/StatsView/StatsPanel.vue`,
  statsPage: `${ROOT}/frontend/src/views/StatsView.vue`,
  types: `${ROOT}/frontend/src/types/index.ts`,
  db: `${ROOT}/app/server/node/db.js`,
  api: `${ROOT}/app/server/node/routes/daily-record.js`,
};
const src = {};
for (const [k, p] of Object.entries(F)) src[k] = fs.readFileSync(p, 'utf-8');

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}
const has = (k, s) => src[k].includes(s);
const count = (k, re) => (src[k].match(re) || []).length;

// ============ 三围（类型键 waist，含新增的 bust / hip）============
out.push('【三围：胸围 / 腰围 / 臀围】');
check('AddRecordDialog 类型清单里有「三围」', has('dialog', "{ value: 'waist', icon: '📏', label: '三围' }"));
check('AddRecordDialog 有 waist 表单块', has('dialog', "selectedType === 'waist'"));
check('AddRecordDialog 表单里有胸围/腰围/臀围三个输入', has('dialog', 'formData.bust') && has('dialog', 'formData.waist') && has('dialog', 'formData.hip'));
check('AddRecordDialog formData 有 bust/hip', has('dialog', 'bust: null as number | null') && has('dialog', 'hip: null as number | null'));
check('AddRecordDialog 回填含 bust/hip', has('dialog', 'formData.value.bust = r.bust'));
check('AddRecordDialog 保存含 bust/hip', has('dialog', 'data.bust = formData.value.bust') && has('dialog', 'data.hip = formData.value.hip'));
check('AddRecordDialog 保存校验「至少填一项」', has('dialog', '请至少填写胸围 / 腰围 / 臀围中的一项'));
check('AddRecordDialog 重置含 bust/hip', has('dialog', 'hip: null,'));
check('RecordList 类别清单里有「三围」', has('list', "{ type: 'waist', icon: '📏', label: '三围'"));
check('RecordList hasDataForType 认 bust/hip', has('list', 'r.bust != null') && has('list', 'r.hip != null'));
check('RecordList getPreview 显示三围', has('list', "parts.push('胸 ' + r.bust)") && has('list', "parts.push('臀 ' + r.hip)"));
check('RecordView quickTypes 有「三围」', has('view', "{ value: 'waist', icon: '📏', label: '三围' }"));
check('RecordView 快捷弹窗是三围（含胸/臀输入）', has('view', 'waistForm.bust') && has('view', 'waistForm.hip'));
check('RecordView saveWaist 提交 bust/hip', has('view', 'payload.bust = bust') && has('view', 'payload.hip = hip'));
check('RecordView 预览卡显示三围', has('view', "parts.push('胸' + r.bust)"));
check('统计面板三围卡有胸/腰/臀三条曲线', has('panel', "hasData('girth')") && has('panel', "chartValues('bust')") && has('panel', "chartValues('waist')") && has('panel', "chartValues('hip')") && has('panel', ":legend=\"['胸围', '腰围', '臀围']\""));
check('统计面板 hasData 认 bust/waist/hip', has('panel', "case 'girth': return any((r) => r.bust != null || r.waist != null || r.hip != null)"));
// 断言「记录页统计确实指向这份共享实现」——否则卡片搬到别处就没人接上了
check('RecordView 统计标签用共享 StatsPanel', has('view', "import StatsPanel from './StatsView/StatsPanel.vue'") && has('view', '<StatsPanel v-if="activeSubTab === \'stats\'" />'));
check('独立统计页也用同一份 StatsPanel', has('statsPage', "import StatsPanel from './StatsView/StatsPanel.vue'") && has('statsPage', '<StatsPanel size="page" />'));

// ============ 后端字段 ============
out.push('');
out.push('【后端字段（bust / hip）】');
check('db.js 建表含 bust/hip', /bust REAL,[\s\S]{0,40}waist REAL,[\s\S]{0,20}hip REAL,/.test(src.db));
check('db.js migrateDb 会补 bust/hip 列', has('db', 'bust: null,') && has('db', 'hip: null,'));
check('daily-record.js POST 更新字段含 bust/hip', count('api', /'bust', 'waist', 'hip'/g) >= 2, '出现 ' + count('api', /'bust', 'waist', 'hip'/g) + ' 次（应为 POST+PUT 各 1）');
check('daily-record.js INSERT 列含 bust/waist/hip', has('api', "'weight', 'fetal_heart_rate', 'body_temperature', 'bust', 'waist', 'hip',"));
check('daily-record.js INSERT 参数含 bust/hip', has('api', 'req.body.bust ?? null, req.body.waist ?? null, req.body.hip ?? null,'));
check('types/index.ts 有 bust/waist/hip', has('types', 'bust: number | null') && has('types', 'hip: number | null'));

// ============ 四个「表里有、界面原本没入口」的新类型 ============
const NEW_TYPES = [
  { type: 'edema', label: '水肿', col: 'edema_level', form: 'edemaLevel' },
  { type: 'discharge', label: '分泌物', col: 'vaginal_discharge', form: 'vaginalDischarge' },
  { type: 'skin', label: '皮肤状况', col: 'skin_condition', form: 'skinCondition' },
  { type: 'urination', label: '排尿情况', col: 'urination_frequency', form: 'urinationFrequency' },
];
out.push('');
out.push('【新增记录类型（水肿 / 分泌物 / 皮肤状况 / 排尿情况）】');
for (const t of NEW_TYPES) {
  const errs = [];
  if (!has('dialog', `{ value: '${t.type}'`)) errs.push('弹窗类型清单');
  if (!has('dialog', `selectedType === '${t.type}'`)) errs.push('弹窗表单块');
  if (!has('dialog', `formData.${t.form}`)) errs.push('弹窗表单字段');
  if (!has('dialog', `case '${t.type}':`)) errs.push('弹窗回填/保存 case');
  if (!has('dialog', `data.${t.col} =`)) errs.push('保存到 DB 列 ' + t.col);
  if (!has('list', `{ type: '${t.type}'`)) errs.push('记录列表类别');
  if (!has('list', `case '${t.type}':`)) errs.push('列表 hasData/preview');
  if (!has('view', `{ value: '${t.type}'`)) errs.push('快捷菜单');
  if (!has('view', `r.${t.col}`)) errs.push('预览卡读取 ' + t.col);
  check(`${t.label}：9 个入口全部接上`, errs.length === 0, errs.join('、'));
}
// 快捷菜单点下去必须能真的打开界面（默认分支不能再只弹警告）
check('尚无专属弹窗的类型会打开通用大弹窗（不再只弹「未知类型」警告）',
  !has('view', "message.warning('未知类型: ' + type)") && has('view', 'addDialogType.value = type'));

// ============ 弹窗每个类型都要有保存分支 ============
out.push('');
out.push('【一致性：类别清单里的每个类型都要能在弹窗里保存】');
const dialogTypes = [...src.dialog.matchAll(/\{ value: '([A-Za-z0-9_]+)', icon: '[^']*', label: '[^']*' \}/g)].map(m => m[1]);
const saveCases = new Set([...src.dialog.matchAll(/case '([A-Za-z0-9_]+)':/g)].map(m => m[1]));
const missingSave = dialogTypes.filter(t => !saveCases.has(t));
check(`弹窗类型 ${dialogTypes.length} 个，全部有 case 分支`, missingSave.length === 0, '缺: ' + missingSave.join('、'));

const listTypes = [...src.list.matchAll(/\{ type: '([A-Za-z0-9_]+)', icon:/g)].map(m => m[1]);
const listCases = new Set([...src.list.matchAll(/case '([A-Za-z0-9_]+)':/g)].map(m => m[1]));
const missingList = listTypes.filter(t => !listCases.has(t));
check(`记录列表类别 ${listTypes.length} 个，全部有 hasData/preview 分支`, missingList.length === 0, '缺: ' + missingList.join('、'));

const quickValues = [...src.view.matchAll(/\{ value: '([A-Za-z0-9_]+)', icon: '[^']*', label: '[^']*' \}/g)].map(m => m[1]);
const quickMissing = quickValues.filter(t => !listTypes.includes(t));
check(`快捷菜单 ${quickValues.length} 个类型都在记录列表里有对应条目`, quickMissing.length === 0, '缺: ' + quickMissing.join('、'));

// ============ 导出/恢复的字段覆盖度（数据完整性）============
// 恢复走 TABLE_COLUMNS 白名单：/restore-latest 先 DELETE FROM 表 再按白名单插入，
// 白名单里没有的列会被永久丢掉（备份里有也白搭）。所以「白名单 ⊇ 建表字段」是不变量。
out.push('');
out.push('【导出/恢复字段覆盖度】');
const exp = fs.readFileSync(`${ROOT}/app/server/node/routes/export.js`, 'utf-8');

const schemaCols = {};
for (const m of src.db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
  schemaCols[m[1]] = m[2].split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('--'))
    .map(l => l.split(/\s+/)[0])
    .filter(c => /^[A-Za-z0-9_]+$/.test(c) && !['primary', 'foreign', 'unique'].includes(c.toLowerCase()));
}
const allTables = [...exp.match(/const ALL_TABLES = \[([\s\S]*?)\];/)[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
const wlBlock = exp.match(/const TABLE_COLUMNS = \{([\s\S]*?)\n\};/)[1];
const whitelist = {};
for (const m of wlBlock.matchAll(/(\w+): \[([^\]]*)\]/g)) {
  whitelist[m[1]] = [...m[2].matchAll(/'([A-Za-z0-9_]+)'/g)].map(x => x[1]);
}

const notExported = Object.keys(schemaCols).filter(t => !allTables.includes(t));
out.push(`  · 建表 ${Object.keys(schemaCols).length} 张表，备份覆盖 ${allTables.length} 张；未纳入备份: ${notExported.join('、') || '无'}`);

let coverBad = [];
for (const t of allTables) {
  const cols = schemaCols[t];
  if (!cols) continue;
  const miss = cols.filter(c => !(whitelist[t] || []).includes(c));
  if (miss.length) coverBad.push(`${t}(缺 ${miss.join('/')})`);
}
check('备份覆盖的每张表，白名单都包含其全部字段（否则恢复时会被丢/置空）',
  coverBad.length === 0, coverBad.join('；'));

const csvKeys = [...exp.match(/const CSV_FIELDS = \[([\s\S]*?)\n\];/)[1].matchAll(/key: '([A-Za-z0-9_]+)'/g)].map(m => m[1]);
check('CSV 健康记录导出含三围（bust/waist/hip）',
  ['bust', 'waist', 'hip'].every(k => csvKeys.includes(k)), '实际含: ' + ['bust', 'waist', 'hip'].filter(k => csvKeys.includes(k)).join('/'));

// 反向断言：白名单里不该出现建表里没有的列名（拼错时会静默失效）
const ghost = [];
for (const [t, cols] of Object.entries(whitelist)) {
  if (!schemaCols[t]) continue;
  const bad = cols.filter(c => !schemaCols[t].includes(c));
  if (bad.length) ghost.push(`${t}(${bad.join('/')})`);
}
check('白名单里没有不存在的列（防拼写错误导致静默失效）', ghost.length === 0, ghost.join('；'));

// ============ 「死字段」检查：建表里有、但整个应用都写不到 ============
// 背景：edema_level / vaginal_discharge / skin_condition / urination_frequency 这 4 列
// 曾经只在 types/index.ts 里出现 —— 表里有列、类型里有字段，但**没有任何界面能录**，
// 属于做了一半的功能（用户根本发现不了，只有做差集才能看出来）。
out.push('');
out.push('【死字段检查：daily_record 的每个用户列都得有「写入方」】');
{
  const drCols = (src.db.match(/CREATE TABLE IF NOT EXISTS daily_record \(([\s\S]*?)\n\);/)[1] || '')
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('--'))
    .map(l => l.split(/\s+/)[0])
    .filter(c => /^[A-Za-z0-9_]+$/.test(c) && !['primary', 'foreign', 'unique'].includes(c.toLowerCase()));
  const INTERNAL = ['id', 'pregnancy_id', 'record_date', 'created_at', 'updated_at'];

  // ⚠️ 只看「后端有没有这个字段」是不够的 —— 后端 INSERT 列表里本来就有全部列名，
  // 所以那样写永远查不出问题（实测：把前端引用全删掉，检查照样通过 = 假绿）。
  // 真正要问的是「**界面能不能把这个值提交上去**」，因此只在**前端**里找写入表达式。
  const feFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // ⚠️ 路径分隔符：Windows 下 path.join 给的是反斜杠，
      // 直接 endsWith('types/index.ts') 会匹配不到 ⇒ 类型定义文件没被排除 ⇒ 检查永远为真（假绿）。
      else if (/\.(vue|ts)$/.test(e.name) && !p.replace(/\\/g, '/').endsWith('types/index.ts')) feFiles.push(p);
    }
  })(`${ROOT}/frontend/src`);
  const feText = feFiles.map(p => fs.readFileSync(p, 'utf-8')).join('\n');

  // 视为「有写入方」的三种写法：
  //   ① data.<col> = / payload.<col> =   （弹窗与快捷弹窗的提交载荷）
  //   ② <col>:                            （对象字面量 key，如 doUpsert({ waist: ... })）
  //   ③ <col> =                           （直接赋值）
  const hasWriter = (col) => [
    new RegExp(`(?:data|payload|body)\\.${col}\\b`),
    new RegExp(`\\b${col}\\s*:`),
    new RegExp(`\\b${col}\\s*=(?!=)`),
  ].some((p) => p.test(feText));

  // 已知未使用：曾经有 5 个（contraction_record / fetal_movement_record / sleep_record /
  // diet_record / exercise_record），2026-09-25 已从建表语句、INSERT 列表、导出白名单、
  // CSV 表头、类型定义里全部清理（对照 v0.0.27 源码确认从未被任何版本写过）。
  // 保留这个机制是为了将来出现「确实要预留但暂时没人写」的列时有地方登记。
  const KNOWN_UNUSED = [];

  const dead = drCols.filter((c) => !INTERNAL.includes(c) && !KNOWN_UNUSED.includes(c) && !hasWriter(c));
  check(`daily_record 的 ${drCols.length} 列中，没有「谁也写不到」的死字段`,
    dead.length === 0, dead.length ? '死字段: ' + dead.join('、') : '');
}

// ============ INSERT 列 ↔ 参数「逐位对应」（历史上出过生产事故）============
// 曾经：手写的 50 个 `?` 配 51 个列名 ⇒ "50 values for 51 columns" ⇒ 所有日常记录都写不进去，
// 接口却仍然返回 HTTP 200 只带业务码 1001。事后加了「数量自检」抛错。
// 但**只比数量不够**：删/加字段时若两个列表各动了不同的项，数量仍相等、位置却错开，
// 会静默把 A 的值写进 B 的列。所以这里逐位比对。
out.push('');
out.push('【INSERT 列与参数逐位对应】');
{
  const api = fs.readFileSync(`${ROOT}/app/server/node/routes/daily-record.js`, 'utf-8');
  const colBlock = api.match(/const INSERT_COLUMNS = \[([\s\S]*?)\n    \];/);
  const paramBlock = api.match(/const insertParams = \[([\s\S]*?)\n    \];/);
  if (!colBlock || !paramBlock) {
    check('能解析出 INSERT_COLUMNS 与 insertParams', false, '正则未匹配到（脚本需更新）');
  } else {
    const cols = [...colBlock[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
    // 前三个位置是字面量变量：id, pregnancy_id, record_date
    const params = ['id', 'pregnancy_id', 'record_date',
      ...[...paramBlock[1].matchAll(/req\.body\.([A-Za-z0-9_]+)/g)].map((m) => m[1])];
    const bad = cols.length === params.length
      ? cols.map((c, i) => (c === params[i] ? null : `${i}:${c}≠${params[i]}`)).filter(Boolean)
      : ['长度不等'];
    check(`INSERT 的 ${cols.length} 列与参数逐位一一对应（不是只比数量）`,
      bad.length === 0, bad.slice(0, 5).join(' | '));
  }
}

console.log(out.join('\n'));
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
