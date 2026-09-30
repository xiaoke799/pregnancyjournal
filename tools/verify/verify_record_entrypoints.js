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
  /** 记录页「快捷小弹窗」抽出的共享实现（胎动 / 宫缩）。
   *  ⚠️ 2026-09-30 起这两类的表单/取值域/备注标签从 RecordView 搬到这里
   *  （首页也要用同一份，写得两遍必长歪）。**断言要连这个文件一起看**，
   *  只盯 RecordView 会得出「字段没了」的假红。 */
  quick: `${ROOT}/frontend/src/components/record/QuickLogDialog.vue`,
  /** 全项目「多处必须一致的字面量」的唯一真源（心情/睡眠质量/…）——铁律 #34 */
  fmt: `${ROOT}/frontend/src/utils/format.ts`,
  /** 统计卡片已抽成共享组件：记录页「统计」标签 与 独立「统计」页 都用它。
   *  ⚠️ 三围/胎心/宫缩这些统计卡现在断言这个文件，别再回 RecordView 里找（会假红）。 */
  panel: `${ROOT}/frontend/src/views/StatsView/StatsPanel.vue`,
  statsPage: `${ROOT}/frontend/src/views/StatsView.vue`,
  types: `${ROOT}/frontend/src/types/index.ts`,
  db: `${ROOT}/app/server/node/db.js`,
  api: `${ROOT}/app/server/node/routes/daily-record.js`,
  /** 首页看板。它与记录页是**两个入口**，同一个类别的名字/口径必须对得上 ——
   *  以前只断言「记录页内部自洽」，首页悄悄漏掉一整类没人发现过（饮水/运动/…15 类
   *  在首页一个字都不提）。2026-09-30 起首页必须对这些类别"报到"。 */
  dash: `${ROOT}/frontend/src/views/DashboardView.vue`,
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
/**
 * ⚠️ 匹配源码做断言前**必须先剥注释**（铁律 #33）：说明性注释里常会原样写出
 * 被禁用的写法（例如「不要写 `dayjs(x,'YYYY-MM-DD',true)`」），不剥就会把自己绊成恒红。
 */
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'); }

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

// ============ 运动（统计可视化 + 强度感受落库）============
// 【背景】运动数据一直有（类型 + 时长），但统计页 12 张卡里**从来没有运动**；
// 同时记录页小弹窗的「强度感受」收了值却从不提交（库里连列都没有）—— 用户选了等于白选。
out.push('');
out.push('【运动：统计可视化 + 强度感受落库】');
check('统计面板有「运动时长」卡（主曲线 exercise_duration）',
  has('panel', 'title="运动时长"') && has('panel', "hasData('exercise')") && has('panel', "chartValues('exercise_duration')"));
check('统计面板 hasData 认 exercise（时长/类型/强度任一有值）',
  has('panel', "case 'exercise': return any((r) => r.exercise_duration != null"));
check('统计面板运动卡带「运动类型」补充列',
  has('panel', "extra: 'exercise_type'") && has('panel', "extraLabel: '运动类型'"));
check('统计面板运动表有自定义 filter（只填类型没填时长也进表格，不出现「卡片在、表 0 条」）',
  has('panel', 'filter: (r: any) => r.exercise_duration != null'));
check('统计面板运动表展示强度感受', has('panel', "noteField: 'exercise_intensity'"));
check('运动卡排位：饮水之后、胎心之前',
  src.panel.indexOf("hasData('exercise')") > src.panel.indexOf("hasData('water')")
  && src.panel.indexOf("hasData('exercise')") < src.panel.indexOf("hasData('fhr')"));

// 强度取值域必须只有一处出处（铁律 #34）：两个录入入口都不许再各写一份
check('强度取值域唯一真源在 utils/format.ts',
  has('fmt', "EXERCISE_INTENSITY_VALUES = ['轻松', '中等', '较累']"));
check('记录页小弹窗不再硬写强度选项', !has('view', 'value="轻松"') && has('view', 'exerciseIntensityOptions'));
check('大弹窗也不再硬写强度选项', !has('dialog', 'value="轻松"') && has('dialog', 'exerciseIntensityOptions'));
check('大弹窗运动块补齐强度（模板 + formData + 回填 + 保存 + 重置）',
  has('dialog', 'formData.exerciseIntensity') && has('dialog', 'data.exercise_intensity = formData.value.exerciseIntensity')
  && has('dialog', "formData.value.exerciseIntensity = (r.exercise_intensity || '')")
  && has('dialog', "exerciseIntensity: ''"));
check('记录页小弹窗 saveExercise 真的提交 exercise_intensity',
  has('view', 'exercise_intensity: exerciseForm.value.intensity || undefined'));
check('记录页小弹窗强度不预选（不替用户"顺手"记一个「轻松」）',
  has('view', "intensity: '' as '' | ExerciseIntensity"));
check('记录列表预览显示强度', has('list', 'r.exercise_intensity'));
check('记录列表 hasDataForType 认 exercise_intensity',
  has('list', '(r.exercise_type || r.exercise_duration || r.exercise_intensity)'));

out.push('');
out.push('【后端字段（exercise_intensity）】');
check('db.js 建表含 exercise_intensity', has('db', 'exercise_intensity TEXT,'));
check('db.js migrateDb 会补 exercise_intensity 列（老库升级）', has('db', 'exercise_intensity: null,'));
check('daily-record.js 更新字段含 exercise_intensity（POST + PUT 各 1）',
  count('api', /'exercise_duration', 'exercise_intensity'/g) >= 2,
  '出现 ' + count('api', /'exercise_duration', 'exercise_intensity'/g) + ' 次');
check('daily-record.js INSERT 列含 exercise_intensity',
  has('api', "'exercise_type', 'exercise_duration', 'exercise_intensity',"));
check('daily-record.js INSERT 参数含 exercise_intensity',
  has('api', 'req.body.exercise_intensity || null,'));
check('export.js CSV 导出字段含运动强度',
  fs.readFileSync(`${ROOT}/app/server/node/routes/export.js`, 'utf-8').includes("key: 'exercise_intensity'"));
// ⚠️ 「备份白名单是否登记了本列」**故意不在这里手写断言**：本脚本下方有一条**从建表语句自动派生**的
//    覆盖检查（「备份覆盖的每张表，白名单都包含其全部字段」）。手写版在反例验证时被 CSV 标签行
//    `key: 'exercise_intensity'` 误命中而恒绿（假绿），已删；交给那条自动派生的检查更可靠。
check('types/index.ts 有 exercise_intensity', has('types', 'exercise_intensity: string | null'));

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
// ⚠️ 这四类还额外要求「记录页有专属小弹窗」：2026-09-28 之前它们没有小弹窗，
//    点快捷菜单会掉进 26 个类型的选择器大弹窗，与其它 21 个类型的交互完全不同
//    （用户反馈「风格不统一」的根因）。qf = 小弹窗表单变量，modal = 小弹窗开关，
//    submit = 提交载荷里那一行字面量。
const NEW_TYPES = [
  { type: 'edema', label: '水肿', col: 'edema_level', form: 'edemaLevel',
    qf: 'edemaForm', modal: 'showEdemaModal', modalTitle: '记录水肿',
    submit: 'edema_level: edemaForm.value.level' },
  { type: 'discharge', label: '分泌物', col: 'vaginal_discharge', form: 'vaginalDischarge',
    qf: 'dischargeForm', modal: 'showDischargeModal', modalTitle: '记录分泌物',
    submit: 'vaginal_discharge: dischargeForm.value.value' },
  { type: 'skin', label: '皮肤状况', col: 'skin_condition', form: 'skinCondition',
    qf: 'skinForm', modal: 'showSkinModal', modalTitle: '记录皮肤状况',
    submit: 'skin_condition: skinForm.value.value' },
  { type: 'urination', label: '排尿情况', col: 'urination_frequency', form: 'urinationFrequency',
    qf: 'urinationForm', modal: 'showUrinationModal', modalTitle: '记录排尿情况',
    submit: 'urination_frequency: urinationForm.value.value' },
];

/** 按 title 把 RecordView 里某个 <n-modal>…</n-modal> 的整块源码切出来 */
function modalBlock(title) {
  const i = src.view.indexOf(`title="${title}"`);
  if (i < 0) return '';
  const start = src.view.lastIndexOf('<n-modal', i);
  const end = src.view.indexOf('</n-modal>', i);
  if (start < 0 || end < 0 || end < start) return '';
  return src.view.slice(start, end);
}
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
  // —— 专属小弹窗（统一风格）七件套 ——
  if (!has('view', `case '${t.type}': reset`)) errs.push('快捷弹窗分支 openQuickAdd');
  if (!has('view', `const ${t.qf} = ref(`)) errs.push('快捷弹窗表单 ' + t.qf);
  if (!has('view', t.submit)) errs.push('快捷弹窗提交 ' + t.col);
  if (!has('view', `v-model:show="${t.modal}"`)) errs.push('快捷弹窗开关 ' + t.modal);
  if (!has('view', `const ${t.modal} = ref(false)`)) errs.push('快捷弹窗开关定义 ' + t.modal);
  if (!has('view', `v-model:value="${t.qf}.note"`)) errs.push('快捷弹窗备注 ' + t.qf + '.note');
  // 提示文案必须落在**这个小弹窗自己的块里**（不是全文件里随便有就算）——
  // 否则弹窗块被挪乱/合并时，日期和选项还在、就医提示却跑到别处去了。
  const blk = modalBlock(t.modalTitle);
  if (!blk) errs.push('找不到小弹窗块 title="' + t.modalTitle + '"');
  else if (!/class="form-hint-text"/.test(blk)) errs.push('小弹窗内缺就医提示文案');
  check(`${t.label}：16 个入口全部接上`, errs.length === 0, errs.join('、'));
}
// 快捷菜单点下去必须能真的打开界面（默认分支不能再只弹警告）
// 说明：现在快捷菜单里每个类型都有自己的小弹窗，default 分支只作为「将来新增类型漏接」的兜底。
check('通用大弹窗兜底分支仍在（不因为全部类型都有小弹窗就删掉 default）',
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

// ★ **反向**不变量：记录列表里的每个类型都要能在「＋」快捷菜单里点到。
//   反例（2026-09-30 实测）：`hcg` / `uric_acid` 把 openQuickAdd 分支、专属小弹窗、表单、
//   NOTE_FORMS 登记、记录列表条目**全都接上了**，唯独漏了 `quickTypes` 那一行
//   ⇒ 首页「今日记录」宫格显示得到它们的数值，记录页的 ＋ 里却找不到，只能碰运气点列表条目。
//   上面那条只查「菜单 ⊆ 列表」，抓不到这种"列表里有、菜单里没有"，所以要单独反向查一遍。
//   确实有意不进快捷菜单的类型写进下面的白名单，并写明理由（保持"零白名单"最好）。
const MENU_EXCLUDED = [];
const listMissingInMenu = listTypes.filter(t => !quickValues.includes(t) && !MENU_EXCLUDED.includes(t));
check(`记录列表 ${listTypes.length} 个类型都能在「＋」快捷菜单里点到（白名单 ${MENU_EXCLUDED.length} 个）`,
  listMissingInMenu.length === 0, '只差快捷菜单: ' + listMissingInMenu.join('、'));

// ★ **首页 ↔ 记录页**的类别对齐不变量。
//   背景（2026-09-30 实测）：首页「今日记录」板块只渲染 9 个健康指标 + 两张工具卡，
//   其余 15 类（饮水/运动/便便/症状/…）在首页**一个字都不提**；而板块的判据是
//   「today_record 有没有任意一列」，于是「只记了饮水」「只用过一次胎动计数器」
//   会渲染出一块 0px 高的空盒子（头部却写着「查看详情 →」）。修法见 DashboardView
//   的 healthCards / otherRecordedItems。
//   这条断言的作用：**记录页以后每新增一个类别，首页不跟上就红**，不再靠人眼发现。
//   确实已由首页别处呈现（宫格 / 工具卡 / 待办板块）的类别写进下面的白名单并注明理由。
// 宫格：左边是记录页的 type，右边是首页 healthCards 里的 `key:`（两套命名，体温不同名）
const DASH_GRID = [
  ['weight', 'weight'], ['mood', 'mood'], ['fetal_heart_rate', 'fetal_heart_rate'],
  ['sleep', 'sleep'], ['blood_pressure', 'blood_pressure'], ['temperature', 'body_temperature'],
  ['blood_glucose', 'blood_glucose'], ['uric_acid', 'uric_acid'], ['hcg', 'hcg'],
];
const DASH_TOOL_TYPES = ['fetal_movement', 'contraction'];    // → 首页两张「快捷记一笔」工具卡
// ⚠️ 胎动/宫缩**不**进白名单：它们既有工具卡、又写回当天记录，首页的「今天已记录」兜底
//    里也要按名字列出来（见 DashboardView 的 OTHER_RECORD_CATEGORIES）。只放白名单里
//    「首页别处已呈现、且不该在今日记录里重复出现」的类别。
const DASH_ELSEWHERE = [...DASH_GRID.map(p => p[0]), 'plan']; // plan → 首页「今日待办」板块

// 白名单必须**自证**：说「宫格已覆盖」的，就真要在 healthCards 里找到那张卡；
// 否则删掉一张卡也没人发现（白名单会变成静默放行）。
const gridMissing = DASH_GRID.filter(([, k]) => !src.dash.includes(`key: '${k}'`)).map(([t]) => t);
check(`首页宫格 ${DASH_GRID.length} 个健康指标卡片都真的在（healthCards）`,
  gridMissing.length === 0, '缺卡: ' + gridMissing.join('、'));
const toolMissing = DASH_TOOL_TYPES.filter(t => !new RegExp(`type="${t}"`).test(src.dash));
check(`首页 ${DASH_TOOL_TYPES.length} 张「快捷记一笔」工具卡都在`, toolMissing.length === 0, '缺卡: ' + toolMissing.join('、'));

// 记录页的 label 逐字出现在首页源码里 → 说明首页"报到"了
const listLabelOf = {};
for (const m of src.list.matchAll(/\{ type: '([A-Za-z0-9_]+)', icon: '[^']*', label: '([^']+)'/g)) listLabelOf[m[1]] = m[2];
const dashMustMention = listTypes.filter(t => !DASH_ELSEWHERE.includes(t));
const dashMissed = dashMustMention.filter(t => !src.dash.includes(`'${listLabelOf[t]}'`));
check(`记录列表 ${dashMustMention.length} 个「非宫格」类别都在首页被提到（白名单 ${DASH_ELSEWHERE.length} 个）`,
  dashMissed.length === 0, '首页完全没提: ' + dashMissed.map(t => listLabelOf[t]).join('、'));
check(`能解析出记录列表类型→label 映射（≥20，实得 ${Object.keys(listLabelOf).length}）`,
  Object.keys(listLabelOf).length >= 20, '首页↔记录页对齐断言可能空集恒真');

// ⚠️ 先断言「确实解析到了类型」再断言内容 —— 正则会因为格式微调而解析出 0 个，
//    那样下面的 ⊆ 断言会空集恒真（假绿）。这就是铁律 #27 说的「必须断言解析到预期数量」。
check(`能解析出快捷菜单类型（≥20，实得 ${quickValues.length}）`, quickValues.length >= 20);

// 快捷菜单里的每个类型都必须有**专属小弹窗**——有一个漏了就会掉进 26 个类型的
// 选择器大弹窗，这一类的交互体验跟别的不一样。**两种落地形态都算数**：
//   ① 内联：`case 'X': resetXForm(); showXModal.value = true`（21 个类型仍在 RecordView 里）
//   ② 抽出共享组件：`case 'X': showXModal.value = true`（只开开关，不 reset）+
//      模板 `<QuickLogDialog v-model:show="showXModal" type="X">` + 组件里有 `type === 'X'` 分支。
//      ⚠️ 少了组件里那条分支 ⇒ 弹窗打开是**空白**的（比"掉进大弹窗"更隐蔽），所以三条都要断言。
//   掉进 default 分支开通用大弹窗，仍然算漏。
const SHARED_MODAL_TYPES = ['fetal_movement', 'contraction'];
function sharedModalWired(t) {
  const m = src.view.match(new RegExp(`case '${t}': (show\\w+Modal)\\.value = true`));
  if (!m) return { ok: false, why: 'openQuickAdd 没开开关' };
  const varName = m[1];
  const tpl = new RegExp(`<QuickLogDialog[\\s\\S]{0,400}?v-model:show="${varName}"[\\s\\S]{0,400}?type="${t}"`).test(src.view);
  const inShared = new RegExp(`type === '${t}'`).test(src.quick);
  return { ok: tpl && inShared, why: `模板接线=${tpl} / 共享组件有该类型分支=${inShared}` };
}
// 只对「没内联 reset 分支」的类型走共享形态检查，避免把将来同时写两套的写法误判
const inlineCaseTypes = new Set([...src.view.matchAll(/case '([A-Za-z0-9_]+)': reset/g)].map(m => m[1]));
// ★ 不变量：共享组件**声明的每个类型都必须有模板分支**。
//   组件里曾用 `v-else` 兜宫缩 ⇒ 将来往 QuickLogType 加第三个类型且忘写分支时，
//   弹窗会"打开是空白"且运行时不报错（比掉进大弹窗更隐蔽）。故要求逐个显式 `type === 'X'`。
const quickUnion = [...(((src.quick.match(/type QuickLogType = ([^\n]+)/) || [, ''])[1]).matchAll(/'([^']+)'/g))]
  .map((m) => m[1]);
check(`共享小弹窗声明的每个类型都有模板分支（声明 ${quickUnion.length} 类：${quickUnion.join('/')}）`,
  quickUnion.length >= 2 && quickUnion.every((t) => new RegExp(`type === '${t}'`).test(src.quick)),
  '缺分支的：' + quickUnion.filter((t) => !new RegExp(`type === '${t}'`).test(src.quick)).join('、'));
const sharedOk = [];
const sharedBad = [];
for (const t of SHARED_MODAL_TYPES) {
  if (inlineCaseTypes.has(t)) continue; // 已内联，不用看共享形态
  const r = sharedModalWired(t);
  (r.ok ? sharedOk : sharedBad).push(t + (r.ok ? '' : `（${r.why}）`));
}
check(`快捷菜单类型都能解析出 openQuickAdd 分支（≥20，实得 ${inlineCaseTypes.size} 内联 + ${sharedOk.length} 共享）`,
  inlineCaseTypes.size + sharedOk.length >= 20);
const noQuickModal = quickValues.filter(t => !inlineCaseTypes.has(t) && !sharedOk.includes(t));
check(`快捷菜单 ${quickValues.length} 个类型都有专属小弹窗（内联或共享组件，统一风格）`,
  noQuickModal.length === 0 && sharedBad.length === 0,
  '只有大弹窗、没有小弹窗: ' + noQuickModal.join('、') + (sharedBad.length ? '；共享形态没接全: ' + sharedBad.join('、') : ''));

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
  //
  // intimacy_note（2026-09-29 登记）：爱爱的备注**统一改存 note**（与小弹窗一致，
  // 根因是把 intimacy_record 的 JSON 原文回填进备注框）。
  // 这一列从此不再写入，但**只承载历史数据** —— 读侧仍有回退链
  // （AddRecordDialog：`r.note || r.intimacy_note`；RecordList hasData：`r.intimacy_record || r.intimacy_note`），
  // 所以既不能删列，也不该被当成"死字段"。
  //
  // plan_text / plan_date（2026-09-30 登记）：计划改为存进「待办」（reminder 表）——
  // 当天记录**一天一条**，放不下同一天多个时间点的安排（写了 9 点产检就写不下下午散步）；
  // 待办一条一记录、支持任意多条，而且**本来就在推送链路里**（push-engine 扫 reminder 表），
  // 存进去就自动获得「到点提醒」，不必为计划再单做一套推送。
  // 这两列从此不再写入，但**只承载历史计划**：读侧仍有回退（RecordList 在当天没有待办计划时
  // 回退显示 `r.plan_text`）⇒ 既不能删列，也不该被当成"死字段"。
  const KNOWN_UNUSED = ['intimacy_note', 'plan_text', 'plan_date'];

  const dead = drCols.filter((c) => !INTERNAL.includes(c) && !KNOWN_UNUSED.includes(c) && !hasWriter(c));
  check(`daily_record 的 ${drCols.length} 列中，没有「谁也写不到」的死字段`,
    dead.length === 0, dead.length ? '死字段: ' + dead.join('、') : '');

  // 豁免必须站得住脚：登记成 KNOWN_UNUSED 的列，读侧得真的有人在读它 ——
  // 否则「豁免」就成了掩盖"真死字段"的借口。
  check('intimacy_note 的豁免成立：读侧仍保留回退链（老数据仍可见）',
    /r\.note \|\| r\.intimacy_note/.test(src.dialog) && /r\.intimacy_record \|\| r\.intimacy_note/.test(src.list),
    '读侧回退链被删了 ⇒ 应改为真删列，而不是继续豁免');
  check('plan_text 的豁免成立：读侧仍能显示历史计划',
    /r\.plan_text/.test(src.list),
    'RecordList 里读历史 plan_text 的回退被删了 ⇒ 应改为真删列，而不是继续豁免');
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

// ============ 取值域 / 文案 / 备注语义的「唯一真源」核查（2026-09-29 修复）============
// 背景：这几处曾经「同一个字段、多套口径」，且症状都是**静默**的 ——
//   · 睡眠质量：小弹窗写中文、大弹窗写英文 ⇒ 编辑一次就静默改域，同一列中英混排；
//   · 上架/统计/列表三处各抄一份映射，改了 A 忘改 B；
//   · 「当天备注」其实是**按天共享的一列**，各类型盲写覆盖 ⇒ 静默丢备注。
// 下面这些断言的作用是：**再分裂一次就会红**。
out.push('');
out.push('【取值域与文案的唯一真源】');

// —— 睡眠质量 ——
check('format.ts 定义规范取值域 SLEEP_QUALITY_VALUES', has('fmt', 'export const SLEEP_QUALITY_VALUES = [' ))
check('format.ts 导出 SLEEP_QUALITY_OPTIONS / normalizeSleepQuality / sleepQualityLabel',
  has('fmt', 'export const SLEEP_QUALITY_OPTIONS') && has('fmt', 'export function normalizeSleepQuality') && has('fmt', 'export function sleepQualityLabel'));
check('format.ts 里 SLEEP_QUALITY_OPTIONS 只定义一份',
  count('fmt', /export const SLEEP_QUALITY_OPTIONS/g) === 1, '出现 ' + count('fmt', /export const SLEEP_QUALITY_OPTIONS/g) + ' 次');
check('format.ts 的中文历史值映射覆盖 好/一般/差',
  /好: 'good'/.test(src.fmt) && /一般: 'fair'/.test(src.fmt) && /差: 'poor'/.test(src.fmt));

// 「好→good」这份映射在**全前端**只允许存在一处（format.ts）——这正是防再次分裂的断言
const dupSleepMap = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(vue|ts)$/.test(e.name)) continue;
    if (p.replace(/\\/g, '/').endsWith('utils/format.ts')) continue;
    const txt = fs.readFileSync(p, 'utf-8');
    if (/['"](?:好|一般|差)['"]\s*:\s*['"](?:good|fair|poor)['"]/.test(txt)) dupSleepMap.push(path.relative(ROOT, p));
  }
})(`${ROOT}/frontend/src`);
check('全前端只有 format.ts 一处「中文睡眠质量 → 英文」映射（防再次分裂）',
  dupSleepMap.length === 0, dupSleepMap.join('、'));

check('RecordView 睡眠质量选项取自共享真源', has('view', 'SLEEP_QUALITY_OPTIONS as sleepQualityOptions') && has('view', 'v-for="q in sleepQualityOptions"'));
check('RecordView 睡眠质量表单值用共享类型（不再是中文字面量）',
  has('view', "quality: 'fair' as SleepQuality") && has('view', "quality: 'fair',") && !/quality: '(?:好|一般|差)'/.test(src.view));
check('AddRecordDialog 无本地 sleepQualityOptions 数组（已收口到 format.ts）', !/const sleepQualityOptions = \[/.test(src.dialog));
check('AddRecordDialog 选项与归一同取自共享真源',
  has('dialog', 'SLEEP_QUALITY_OPTIONS as sleepQualityOptions') && has('dialog', 'normalizeSleepQuality(r.sleep_quality)'));
check('RecordList 展示走共享归一与中文标签（无本地映射表）',
  has('list', 'sleepQualityLabel(record.value.sleep_quality)') && has('list', 'normalizeSleepQuality(record.value.sleep_quality)') && !/sleepQualityMap|sqMap/.test(src.list));
check('统计面板「质量」列也走共享归一（否则老数据中文/新数据英文在同一张表里混排）',
  has('panel', 'extraFormat: (r: any) => sleepQualityLabel(r.sleep_quality)'));

// —— 取值域取「并集」：同一个字段在小弹窗与大弹窗必须同域 ——
// ⚠️ 取值域的真源在 utils/format（铁律 #34）：这里从那里解析出来再断言两处 UI，
//    免得又出现「脚本里抄一份数组、源码改了脚本还绿」的假绿。
const painVals = [...(src.fmt.match(/CONTRACTION_PAIN_VALUES = \[([^\]]*)\]/) || [, ''])[1]
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(`能从 utils/format 解析出宫缩疼痛取值域（预期 4，实得 ${painVals.length}）`, painVals.length === 4);
const PAIN = painVals.length === 4 ? painVals : ['无感', '轻微', '明显', '剧烈'];
// 宫缩小弹窗（宫缩疼痛的 4 个单选项所在处）2026-09-30 起在共享组件里。
// ⚠️ 要求这 4 个值**完整落在同一处**，不是"两边加起来凑够 4 个"——凑数会放过
//    「拆成两半分居两文件」这种同样会出问题的写法。
const painInView = PAIN.every((v) => has('view', `n-radio-button value="${v}"`));
const painInQuick = PAIN.every((v) => has('quick', `n-radio-button value="${v}"`));
check('记录页小弹窗（内联或共享组件）宫缩疼痛取值域 = 无感/轻微/明显/剧烈',
  painInView || painInQuick,
  `完整取值域必须落在同一处：内联=${painInView} 共享=${painInQuick}；取值域真源是 utils/format`);
check('AddRecordDialog 宫缩疼痛取值域 = 无感/轻微/明显/剧烈',
  PAIN.every((v) => has('dialog', `{ label: '${v}', value: '${v}' }`)) && !has('dialog', "{ label: '中度', value: '中度' }"));
check('AddRecordDialog 宫缩疼痛回填走共享归一（老数据「中度」不再显示成裸文本）',
  has('dialog', 'normalizeContractionPain(r.contraction_pain)'),
  '取值域改了，回填就必须归一，否则老记录在下拉框里显示成一串原文');
const UA = ['空腹', '餐后2小时', '随机'];
check('RecordView 尿酸时段取值域 = 空腹/餐后2小时/随机',
  UA.every((v) => has('view', `{ label: '${v}', value: '${v}' }`)));
check('AddRecordDialog 尿酸时段取值域 = 空腹/餐后2小时/随机',
  UA.every((v) => has('dialog', `{ label: '${v}', value: '${v}' }`)));
check('RecordView 不再有旧的「餐后」孤值（与弹窗不同域）', !has('view', "{ label: '餐后', value: '餐后' }"));

// —— 「用药」入口：历史上整个丢失，现在四处都要在 ——
out.push('');
out.push('【用药（medication）：入口四处齐全】');
check('RecordView 快捷菜单有「用药」', has('view', "{ value: 'medication', icon: '💊', label: '用药' }"));
check('RecordView openQuickAdd 有 medication 分支', has('view', "case 'medication': resetMedicationForm()"));
check('RecordView 有用药小弹窗（表单/开关/保存）',
  has('view', 'const medForm = ref(') && has('view', 'const showMedicationModal = ref(false)') && has('view', 'async function saveMedication()'));
check('RecordView 用药写入 medication 列（JSON 数组）', has('view', 'medication: JSON.stringify([{'));
check('AddRecordDialog 类型清单有「用药」', has('dialog', "{ value: 'medication'"));
check('RecordList 类别里有「用药」', has('list', "{ type: 'medication'"));
check('RecordList hasData/preview 都有 medication 分支',
  count('list', /case 'medication':/g) >= 2, '出现 ' + count('list', /case 'medication':/g) + ' 次');

// —— 「当天备注」是按天共享的一列：必须预填、必须可清空 ——
out.push('');
out.push('【「当天备注」语义（按天共享一列）】');
// 19 = RecordView 内联小弹窗 18 处 + 共享组件 QuickLogDialog 1 处。
// ⚠️ 原来写死 20，是因为胎动/宫缩各占 1 处；抽成共享组件后两份模板合并成 1 处 ⇒ 总数必然少 1。
//    这是**模板复用**带来的减少，不是「有弹窗缺了备注」——缺了会由下面 NOTE_FORMS/共享组件两条断言抓到。
const NOTE_LABELS = count('view', /当天备注（可选）/g) + count('quick', /当天备注（可选）/g);
check(`记录页小弹窗备注标签统一为「当天备注（可选）」共 19 处（内联 18 + 共享 1）`,
  NOTE_LABELS === 19, '实得 ' + NOTE_LABELS + '（RecordView ' + count('view', /当天备注（可选）/g) + ' + 共享 ' + count('quick', /当天备注（可选）/g) + '）');
check('RecordView 没有残留旧标签「备注（可选）」', !/<label>备注（可选）<\/label>/.test(src.view));
// 传 undefined 会被后端整列跳过 ⇒ 用户删掉备注保存后又"长回来"。必须显式传字符串（空串=清空）
check('RecordView 的 note 写入一律显式传字符串（可清空）',
  !/\.value\.note \|\| undefined/.test(src.view), '仍有 ' + count('view', /\.value\.note \|\| undefined/g) + ' 处');
check('打开弹窗时预填当天已有备注（防盲写覆盖）',
  has('view', 'const NOTE_FORMS') && has('view', 'nf.value.note = (currentRecords.value[0] && currentRecords.value[0].note)'));
check('心情备注单独预填（mood 用自己的 mood_note 列）',
  has('view', "moodForm.value.note = (currentRecords.value[0] && currentRecords.value[0].mood_note)"));
// ★ 不变量：模板里**每个带备注输入框的表单**都必须登记进 NOTE_FORMS，
//   否则那个弹窗打开时不预填 ⇒ 保存时把当天已有备注清掉（静默丢数据）。
{
  const tplForms = [...new Set([...src.view.matchAll(/v-model:value="(\w+)\.note"/g)].map((m) => m[1]))]
    .filter((f) => f !== 'moodForm'); // mood 由上面那条单独预填
  const nmBlock = src.view.match(/const NOTE_FORMS: Record<string, any> = \{([\s\S]*?)\n\}/);
  const nmText = nmBlock ? nmBlock[1] : '';
  const unregistered = tplForms.filter((f) => !new RegExp(`\\b${f}\\b`).test(nmText));
  // 下限 18 = 现有内联表单数（原 20 处里的胎动/宫缩已抽走）。⚠️ 只降到"刚好现在能过"会失去
  // 绊线意义，所以同时断言共享组件的两类也必须预填（下一条），两条合起来覆盖全部 20 个表单。
  check(`内联快捷表单 ${tplForms.length} 个（带备注输入框）全部登记进 NOTE_FORMS`,
    tplForms.length >= 18 && unregistered.length === 0,
    '未登记: ' + unregistered.join('、') + (nmBlock ? '' : '（没解析到 NOTE_FORMS 块）'));
  // 抽到共享组件的胎动/宫缩：备注改由 `:note` prop 预填。三处缺一不可——
  //   ① RecordView 算出当天备注 ② 两个调用点都传进去 ③ 组件打开时真的写进表单。
  const sharedNoteOk = has('view', 'const quickLogNote = computed(')
    && has('view', "(currentRecords.value[0] && currentRecords.value[0].note) || ''")
    && count('view', /:note="quickLogNote"/g) >= 2
    && has('quick', "form.value.note = props.note || ''");
  check('共享小弹窗的两类（胎动/宫缩）备注同样预填（走 :note prop）',
    sharedNoteOk,
    '缺：算当天备注=' + has('view', 'const quickLogNote = computed(')
      + ' / 两个调用点都传=' + (count('view', /:note="quickLogNote"/g) >= 2)
      + ' / 组件写进表单=' + has('quick', "form.value.note = props.note || ''"));
}

// —— 饮食备注格式统一为 JSON 数组（与「添加记录」大弹窗一致）——
out.push('');
out.push('【写入格式统一】');
check('RecordView saveDiet 写 JSON 数组（不再是纯文本，避免被大弹窗改写）',
  has('view', "diet_note: JSON.stringify([{ type: dietForm.value.meal"));
check('RecordView 非法日期报错中止（不再静默改成今天）',
  has('view', "message.error('日期无效，请重新选择日期')"));
check('AddRecordDialog 非法日期同样报错中止',
  has('dialog', "message.error('日期无效，请重新选择日期')"));
check('AddRecordDialog 心情备注显式写入（可清空）',
  has('dialog', 'data.mood_note = formData.value.moodNote ||'), '若为条件式写入则删不掉');

// —— 三处记录类型清单的「相对顺序」必须一致 ——
// 条目数本来不同（各自职责不同：菜单 24 / 列表 26 / 弹窗 27），
// 但**交集部分的顺序必须相同**，否则用户在三个界面看到三种排列 —— 就是「乱」的来源。
// 2026-09-30 按「功能分组 + 常用优先」统一过一次，这条断言防止再次分叉。
function typeKeys(text, declRe, keyRe) {
  const m = text.match(declRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = text.indexOf('\n]', start);
  if (end < 0) return null;
  return [...text.slice(start, end).matchAll(keyRe)].map((x) => x[1]);
}
const KEY_Q = typeKeys(src.view, /const quickTypes = \[/, /value: '([a-z_]+)'/g);
const KEY_C = typeKeys(src.list, /const allCategories[^=]*= \[/, /type: '([a-z_]+)'/g);
const KEY_T = typeKeys(src.dialog, /const recordTypes = \[/, /value: '([a-z_]+)'/g);
check(`能从三处解析出类型清单（菜单/列表/弹窗 = ${(KEY_Q || []).length}/${(KEY_C || []).length}/${(KEY_T || []).length}）`,
  (KEY_Q || []).length >= 20 && (KEY_C || []).length >= 20 && (KEY_T || []).length >= 20);
if (KEY_Q && KEY_C && KEY_T) {
  const common = KEY_Q.filter((k) => KEY_C.includes(k) && KEY_T.includes(k));
  const only = (arr) => arr.filter((k) => common.includes(k));
  const a = only(KEY_Q), b = only(KEY_C), c = only(KEY_T);
  check(`三处共有的 ${common.length} 个类型相对顺序一致`,
    JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c),
    `菜单[${a.slice(0, 6)}] 列表[${b.slice(0, 6)}] 弹窗[${c.slice(0, 6)}]`);
  // 「常用优先」：核心体征必须排在最前
  const HIGH = ['weight', 'blood_pressure', 'fetal_movement', 'contraction', 'fetal_heart_rate'];
  check('三处的前 5 项都是高频核心体征（体重/血压/胎动/宫缩/胎心）',
    JSON.stringify(a.slice(0, 5)) === JSON.stringify(HIGH) &&
    JSON.stringify(c.slice(0, 5)) === JSON.stringify(HIGH),
    `实际 菜单[${a.slice(0, 5)}] 弹窗[${c.slice(0, 5)}]`);
}

// —— 时间选择器的空值必须是 null，不能是空字符串 ——
// naive-ui 的 n-time-picker 绑 formatted-value，收到 '' 会把它当日期解析并抛
// `RangeError: Invalid time value` ⇒ 被 App.vue 错误边界接住 ⇒ 整页「这个页面出错了」。
// 触发条件很隐蔽：**备注里没有 HH:mm~HH:mm**（用记录页小弹窗记的宫缩，备注常为空）时，
// 回填不会给这两个字段赋值 ⇒ 保持默认值 ⇒ 一点「查看」必崩（2026-09-29 实测复现）。
const D_NOCOMMENT = stripComments(src.dialog);
check('宫缩开始/结束时间初值为 null（不是空字符串）',
  /contractionStart:\s*null as string \| null/.test(D_NOCOMMENT) &&
  /contractionEnd:\s*null as string \| null/.test(D_NOCOMMENT),
  "写成 '' 会让 n-time-picker 抛 Invalid time value");
check('宫缩回填前显式清成 null（避免残留空字符串）',
  /formData\.value\.contractionStart = null/.test(D_NOCOMMENT),
  '只在匹配到时间时才赋值，未匹配时应保持 null');
// 所有 n-time-picker 绑定的字段，初值都必须是 null（空字符串会让 naive-ui 抛
// `Invalid time value` ⇒ 整页崩）。新增 time-picker 时照此办理，不必再改本断言。
{
  const tpVars = [...D_NOCOMMENT.matchAll(/<n-time-picker[^>]*v-model:formatted-value="formData\.([a-zA-Z]+)"/g)]
    .map((m) => m[1]);
  const badTp = tpVars.filter((v) => !new RegExp(v + ':\\s*null as string \\| null').test(D_NOCOMMENT));
  check(`大弹窗 ${tpVars.length} 个 time-picker 绑定字段的初值都是 null`,
    tpVars.length >= 3 && badTp.length === 0,
    badTp.length ? '初值不是 null 的: ' + badTp.join('、') : '只解析到 ' + tpVars.length + ' 个（少于 3 说明绑定丢了）');
}
// n-date-picker 的 formatted-value 同样怕空字符串（抛 `Cannot read properties of undefined
// (reading 'peers')`）。大弹窗里绑它的字段只有 recordDate / planDate —— 两者都必须用 null。
check('计划日期初值为 null 且回填不留空字符串',
  /planDate:\s*null as string \| null/.test(D_NOCOMMENT) &&
  /formData\.value\.planDate = r\.plan_date \|\| null/.test(D_NOCOMMENT),
  "`planDate = r.plan_date || ''` 会让 n-date-picker 崩");
check('大弹窗里没有任何把空字符串喂给日期/时间选择器的地方',
  !/(planDate|recordDate|contractionStart|contractionEnd)\s*=[^;\n]*\|\|\s*''/.test(D_NOCOMMENT) &&
  !/recordDate:\s*''/.test(D_NOCOMMENT),
  '这些字段都绑 formatted-value，空字符串会崩，统一用 null');

// —— 日期校验：「静态 + 运行时反例」双保险 ——
// ⚠️ 只断言源码里写了 message.error('日期无效…') 会**假绿**（铁律 #11）。2026-09-29 实测：
//    `dayjs(x,'YYYY-MM-DD',true)` 因为全项目没有 dayjs.extend(customParseFormat) 而**完全不生效**，
//    越界日期被"溢出进位"成另一个日期照样放行（2026-13-45 → 2027-02-14、0000-00-00 → 1899-11-30）。
//    所以这里把 utils/format.ts 里那个**真函数**抠出来，拿真 dayjs 跑一组反例。
out.push('');
out.push('【日期校验：运行时反例】');
const fmtFn = (src.fmt.match(/export function isValidDateStr[\s\S]*?\n\}/) || [''])[0]
  .replace('export ', '')
  .replace(/\(\s*(\w+)[^)]*\)\s*:\s*\w+\s*\{/, '($1) {'); // 剥掉 TS 类型注解才能在 node 里跑
check('utils/format 导出 isValidDateStr（日期校验唯一真源）', fmtFn.includes('function isValidDateStr'));
// 两个调用点都必须走共享函数；再裸写严格模式 = 又一次纸糊校验。
// ⚠️ 必须先剥注释再匹配（铁律 #33）：说明注释里就写了 `dayjs(x,'YYYY-MM-DD',true)`
//    这几个字，不剥注释 ⇒ 注释把自己绊倒、两条断言恒红（已实测踩到）。
//    （stripComments 定义在文件上部，供全脚本共用。）
const RAW_STRICT = /dayjs\([^)]*,\s*'YYYY-MM-DD',\s*true\s*\)/;
check('RecordView 不再裸用 dayjs 严格模式（不生效的写法）', !RAW_STRICT.test(stripComments(src.view)));
check('AddRecordDialog 不再裸用 dayjs 严格模式（不生效的写法）', !RAW_STRICT.test(stripComments(src.dialog)));
let _dayjs = null;
try { _dayjs = require(path.join(ROOT, 'frontend', 'node_modules', 'dayjs')) } catch (_) { /* 缺依赖则不静默跳过 */ }
check('能加载 dayjs 以运行日期反例', !!_dayjs, '缺 frontend/node_modules/dayjs');
if (fmtFn.includes('function isValidDateStr') && _dayjs) {
  // ⚠️ 抠出来的函数体一旦含 TS 语法（如 `as any`、泛型），new Function 会抛而不是返回 false
  // ⇒ 必须兜住，让「提取不出来」变成一条**失败的断言**，而不是整个脚本崩掉（崩了就没人看见红）。
  let isValidDateStr = null, compileErr = '';
  try {
    isValidDateStr = new Function('dayjs', fmtFn + '; return isValidDateStr')(_dayjs);
  } catch (e) { compileErr = e.message; }
  check('isValidDateStr 能在 node 里直接执行（函数体是纯 JS，无 TS 语法）', !!isValidDateStr, compileErr);
  if (isValidDateStr) {
    const goodCases = ['2026-09-29', '2024-02-29', '2026-12-31'];
    const badCases = ['2026-13-45', '2026-02-30', '2026-12-32', '0000-00-00', '2026-9-9', 'abcdef', ''];
    const killed = goodCases.filter((c) => !isValidDateStr(c));
    const leaked = badCases.filter((c) => isValidDateStr(c));
    check(`合法日期全部通过（${goodCases.length} 个）`, killed.length === 0, '误杀: ' + killed.join('、'));
    check(`越界 / 畸形日期全部拦下（${badCases.length} 个）`, leaked.length === 0, '漏判: ' + leaked.join('、'));
    // 反例自检：证明「旧写法确实拦不住」。若哪天装上 customParseFormat 让旧写法也生效，
    // 这条会变红 ⇒ 提醒本段断言可以放宽，而不是让它默默失去意义。
    const oldLeaks = badCases.filter((c) => _dayjs(c, 'YYYY-MM-DD', true).isValid());
    check('反例自检：旧写法确实存在漏判（本段断言仍然有意义）', oldLeaks.length > 0,
      '旧写法已能拦住全部反例 ⇒ 插件可能已装上，请复核本段');
  }
}

console.log(out.join('\n'));
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
