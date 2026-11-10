/**
 * 时间显示「时区口径」核验（静态断言 + 真实函数运行时 + 反例自检）
 *
 * 【为什么需要它】
 * 后端 SQLite 用 `datetime('now')` 落库，存的是**无时区标记的 UTC** 字符串
 * （'2026-11-10 01:11:00'）。前端若直接 `dayjs(s)` / `new Date(s)`，浏览器按**本地时间**
 * 解析 ⇒ 东八区整体早 8 小时：9:11 写的日记显示成 1:11、相册凌晨跨月、
 * 推送记录「待推送」条目对不上、info.log 与系统时间差 8 小时。
 *
 * 这条 bug 返工过三次（社区 PR #4 关闭 / PR #5 提交后长期未合入 / v0.0.35 只修了宫缩一处），
 * 根因不是难改，而是**没有任何护栏**：构建通过、类型检查通过、原有 e2e 全绿，
 * 界面上就是错 8 小时。本套件把它钉死。
 *
 * 【口径】（唯一入口 `frontend/src/utils/format.ts` 的 parseServerTime）
 *   · 带时区标记（Z / ±HH:mm）  → 原样解析
 *   · 纯日期（YYYY-MM-DD）      → 原样解析（日期不参与时区换算）
 *   · 无标记的日期时间          → 补 Z 按 UTC 解析，format 时转浏览器本地时区
 *   ⚠️ 特例：`push_log.pushed_at` 是推送引擎 `localStamp()` 写的**本地**时间，
 *      不能用 parseServerTime；`created_at` 才是 UTC。两者必须分开解析。
 *
 * 【层次】A 静态断言 → B 真实函数运行时（TZ=Asia/Shanghai）→ C 反例自检（铁律 #11）
 *
 * 用法：node tools/verify/probe_timezone_display.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 时区必须在进程启动时确定（Node 会缓存），否则本机不在东八区时断言会假绿/假红。
if (process.env.TZ !== 'Asia/Shanghai') {
  const r = spawnSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'Asia/Shanghai' },
  });
  process.exit(r.status === null ? 1 : r.status);
}

const REPO = path.resolve(__dirname, '../..');
const dayjs = require(path.join(REPO, 'frontend/node_modules/dayjs'));
const { extractFn, stripTs } = require('./_vue_extract');

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8');
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ==========================================================================
console.log('\nA. 唯一入口 parseServerTime（静态）');
// ==========================================================================
const fmtSrc = stripComments(read('frontend/src/utils/format.ts'));
check('format.ts 导出 parseServerTime', /export function parseServerTime\s*\(/.test(fmtSrc));
check('三分支齐全：带时区标记原样解析', /\[zZ\]\$|\[\+-\]\\d\{2\}/.test(fmtSrc));
check('三分支齐全：纯日期不补 Z', /if \(!\/\[ T\]\\d\{2\}:\\d\{2\}\/\.test\(s\)\) return dayjs\(s\)/.test(fmtSrc));
check('三分支齐全：无标记日期时间补 Z 按 UTC', /s\.replace\(' ', 'T'\) \+ 'Z'/.test(fmtSrc));

// ==========================================================================
console.log('\nB. 真实函数运行时（TZ=Asia/Shanghai / UTC+8）');
// ==========================================================================
// ⚠️ 跑的是 format.ts / *.vue 的**源码原文**（_vue_extract 抽取），不是重新实现一遍。
//    parseServerTime 的返回类型是 `dayjs.Dayjs`（带点号），stripTs 的类型正则不认点号，
//    这里显式补一刀；若将来签名变了导致这一刀落空，下面的 eval 会直接抛错 ⇒ 红灯而非假绿。
const psRaw = extractFn(read('frontend/src/utils/format.ts'), 'parseServerTime');
check('能从 format.ts 抽出 parseServerTime 源码', !!psRaw);
let parseServerTime = null;
if (psRaw) {
  const body = stripTs(psRaw).replace(/\)\s*:\s*dayjs\.Dayjs\s*\{/, ') {');
  try {
    parseServerTime = new Function('dayjs', body + '\nreturn parseServerTime;')(dayjs);
    check('parseServerTime 源码可执行', typeof parseServerTime === 'function');
  } catch (e) {
    check('parseServerTime 源码可执行', false, e.message);
  }
}

if (parseServerTime) {
  const UTC_DT = '2026-11-10 01:11:00';   // 后端 datetime('now') 存的 UTC（本地实为 09:11）
  // ① epoch 与时区无关，是最硬的断言
  check('UTC 串按 UTC 解析（epoch 精确）',
    parseServerTime(UTC_DT).valueOf() === Date.UTC(2026, 10, 10, 1, 11, 0),
    `实际 ${parseServerTime(UTC_DT).valueOf()} vs ${Date.UTC(2026, 10, 10, 1, 11, 0)}`);
  // ② 东八区渲染 = 本地 09:11（原样 01:11 即 bug）
  check(`东八区渲染为 09:11（实际 ${parseServerTime(UTC_DT).format('HH:mm')}）`,
    parseServerTime(UTC_DT).format('HH:mm') === '09:11');
  // ③ 纯日期不参与换算
  check('纯日期 YYYY-MM-DD 不偏移',
    parseServerTime('2026-11-10').format('YYYY-MM-DD') === '2026-11-10');
  // ④ 已带 Z 的不重复补
  check('已带 Z 的时间串原样解析',
    parseServerTime('2026-11-10T01:11:00.000Z').format('HH:mm') === '09:11');
  // ⑤ 存量行：本地 11-01 03:00 写入的 UTC 值，月份分组必须落回 11 月（修复前是 10 月）
  check('存量 UTC 行不再跨月（2026-10-31 19:00 → 11 月）',
    parseServerTime('2026-10-31 19:00:00').format('YYYY-MM') === '2026-11',
    `实际 ${parseServerTime('2026-10-31 19:00:00').format('YYYY-MM')}`);
  // ⑥ 相册「改日期」历史值（旧写入侧 toISOString 产生的 UTC 午夜）
  check('相册改日期旧值（UTC 午夜）日期不变',
    parseServerTime('2026-11-05 00:00:00').format('YYYY-MM-DD') === '2026-11-05');
  // ⑦ 空值不抛
  check('空值返回无效对象而不是抛错', parseServerTime('').isValid() === false);

  // ⑦ DiaryView.formatTime —— 真实源码（同时注入 dayjs：回退成裸解析时能报出「01:11 ≠ 09:11」而不是「变量未定义」）
  const diaryTime = extractFn(read('frontend/src/views/DiaryView.vue'), 'formatTime');
  check('能从 DiaryView.vue 抽出 formatTime', !!diaryTime);
  if (diaryTime) {
    try {
      const fn = new Function('dayjs', 'parseServerTime', stripTs(diaryTime) + '\nreturn formatTime;')(dayjs, parseServerTime);
      check(`DiaryView.formatTime(UTC 串) = 09:11（实际 ${fn(UTC_DT)}）`, fn(UTC_DT) === '09:11');
      check('DiaryView.formatTime(空) = 空串', fn('') === '');
    } catch (e) { check('DiaryView.formatTime 可执行', false, e.message); }
  }

  // ⑧ AlbumView.formatDate —— 真实源码
  const albumDate = extractFn(read('frontend/src/views/AlbumView.vue'), 'formatDate');
  check('能从 AlbumView.vue 抽出 formatDate', !!albumDate);
  if (albumDate) {
    try {
      const fn = new Function('dayjs', 'parseServerTime', stripTs(albumDate) + '\nreturn formatDate;')(dayjs, parseServerTime);
      check(`AlbumView.formatDate(UTC 串) = 11/10（实际 ${fn(UTC_DT)}）`, fn(UTC_DT) === '11/10');
    } catch (e) { check('AlbumView.formatDate 可执行', false, e.message); }
  }

  // ⑨ SettingsView.formatLogTime —— 真实源码，两个字段口径必须分开
  //    ⚠️ extractFn 按花括号配平，参数类型 `log: { ... }` 里的 `}` 会被当成函数结束 ⇒ 必须先剥类型再抽。
  //    若签名将来变了，下面的 replace 落空 ⇒ 抽出的源码被截断 ⇒ eval 抛错 ⇒ 红灯（不会假绿）。
  const setViewSrc = read('frontend/src/views/SettingsView.vue');
  const setSrcForExtract = setViewSrc.replace(
    /log\s*:\s*\{\s*pushed_at\?:\s*string;\s*created_at\?:\s*string\s*\}/,
    'log'
  );
  check('formatLogTime 签名预处理生效（签名改了就同步改本探针）', setSrcForExtract !== setViewSrc);
  const logTimeRaw = extractFn(setSrcForExtract, 'formatLogTime');
  check('能从 SettingsView.vue 抽出 formatLogTime', !!logTimeRaw);
  if (logTimeRaw) {
    try {
      const fn = new Function('dayjs', 'parseServerTime', stripTs(logTimeRaw) + '\nreturn formatLogTime;')(dayjs, parseServerTime);
      // 待推送：只有 created_at（UTC 13:00 = 本地 21:00）
      check('推送「待推送」按 UTC 解析 created_at → 21:00',
        fn({ created_at: '2026-11-10 13:00:00', pushed_at: null }) === '11-10 21:00',
        `实际 ${fn({ created_at: '2026-11-10 13:00:00', pushed_at: null })}`);
      // 已推送：pushed_at 是本地时间，**不能**再按 UTC 转，否则会变成次日 05:00
      check('推送「已推送」按本地解析 pushed_at → 21:00',
        fn({ created_at: '2026-11-10 13:00:00', pushed_at: '2026-11-10 21:00:30' }) === '11-10 21:00',
        `实际 ${fn({ created_at: '2026-11-10 13:00:00', pushed_at: '2026-11-10 21:00:30' })}`);
    } catch (e) { check('SettingsView.formatLogTime 可执行', false, e.message); }
  }
}

// ==========================================================================
console.log('\nC. 调用点静态断言（谁用了裸解析）');
// ==========================================================================
const diarySrc = stripComments(read('frontend/src/views/DiaryView.vue'));
check('DiaryView.formatTime 走 parseServerTime', /return parseServerTime\(dateStr\)\.format\('HH:mm'\)/.test(diarySrc));

const albumSrc = stripComments(read('frontend/src/views/AlbumView.vue'));
check('AlbumView.formatDate 走 parseServerTime', /parseServerTime\(dateStr\)\.format\('MM\/DD'\)/.test(albumSrc));
check('AlbumView 月份分组走 parseServerTime', /const date = parseServerTime\(photo\.created_at\)/.test(albumSrc));
check('AlbumView 详情日期走 parseServerTime', /parseServerTime\(item\.created_at\)\.format\('YYYY年MM月DD日'\)/.test(albumSrc));
check('AlbumView 编辑回填走 parseServerTime', /editDate\.value = parseServerTime\(item\.created_at\)\.format\('YYYY-MM-DD'\)/.test(albumSrc));
const albumSorts = (albumSrc.match(/\.sort\(\(a, b\) => parseServerTime\(b\.created_at\)/g) || []).length;
check('AlbumView 两处排序均走 parseServerTime', albumSorts === 2, `实际 ${albumSorts} 处`);
check('AlbumView 不再有裸 dayjs(*.created_at)', !/dayjs\(\s*[a-zA-Z.]*created_at\s*\)/.test(albumSrc));

const setSrc = stripComments(read('frontend/src/views/SettingsView.vue'));
check('SettingsView.formatLogTime 分字段：created_at 走 parseServerTime',
  /parseServerTime\(log\.created_at\)/.test(setSrc));
check('SettingsView.formatLogTime 分字段：pushed_at 走本地 dayjs',
  /dayjs\(log\.pushed_at\)/.test(setSrc));
// 模板必须把整条 log 交给 formatLogTime，由函数内部按字段分别解析。
// ⚠️ 不能广搜 `log.pushed_at || log.created_at`：函数内部对「无法解析」的兜底
//    `String(log.pushed_at || log.created_at || '')` 是合法的，广搜会假红。
check('SettingsView 模板把整条 log 交给 formatLogTime',
  /formatLogTime\(log\)/.test(setSrc) && !/formatLogTime\(log\.pushed_at \|\| log\.created_at\)/.test(setSrc));

const loggerSrc = stripComments(read('app/server/node/logger.js'));
check('logger.js 使用 localTimestamp', /function localTimestamp\(/.test(loggerSrc) && /ts: localTimestamp\(\)/.test(loggerSrc));
check('logger.js 的 ts 不再用 toISOString()', !/ts:\s*new Date\(\)\.toISOString\(\)/.test(loggerSrc));

const photoSrc = stripComments(read('app/server/node/routes/photo.js'));
check('photo.js 改日期不再写 UTC 时间戳',
  !/params\.push\(d\.toISOString\(\)\.replace\('T', ' '\)\.slice\(0, 19\)\)/.test(photoSrc));
check('photo.js 改日期写纯日期（与上传路径同格式）', /params\.push\(pd\)/.test(photoSrc));

// ==========================================================================
console.log('\nD. 反例自检（证明上面的断言有区分度 —— 铁律 #11）');
// ==========================================================================
// D1 修复前的写法对同一输入必须得出错误结果，否则说明断言本身测不出问题
const oldDiaryFormatTime = (t) => (t ? dayjs(t).format('HH:mm') : '');
const oldResult = oldDiaryFormatTime('2026-11-10 01:11:00');
check(`[反例] 旧 formatTime 得 01:11（错），新实现得 09:11（对）`,
  oldResult === '01:11' && oldResult !== '09:11', `旧实现实际 ${oldResult}`);

// D2 检测器自检：正则必须能抓到已知的坏样本
const detectors = [
  [/dayjs\(\s*[a-zA-Z.]*created_at\s*\)/, 'const date = dayjs(photo.created_at)'],
  [/ts:\s*new Date\(\)\.toISOString\(\)/, 'const entry = { ts: new Date().toISOString() };'],
  [/log\.pushed_at \|\| log\.created_at/, '{{ formatLogTime(log.pushed_at || log.created_at) }}'],
];
for (const [re, bad] of detectors) {
  check(`[反例] 检测器能抓到坏样本：${bad.slice(0, 40)}`, re.test(bad));
}
// D3 反例必须计入失败数：把 parseServerTime 换成裸 dayjs 的「假实现」，断言必须转红
if (parseServerTime) {
  const fakeParse = (s) => dayjs(String(s ?? ''));
  const fakeResult = fakeParse('2026-11-10 01:11:00').format('HH:mm');
  check('[反例] 裸 dayjs 假实现无法通过 09:11 断言（说明断言有牙）', fakeResult !== '09:11', `假实现得 ${fakeResult}`);
}

// ==========================================================================
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
