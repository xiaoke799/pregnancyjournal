/**
 * 深色模式回归闸门
 *
 * 【为什么需要它】
 * 深色模式历史上是「半成品」（铁律 #18）：store 里有 currentTheme、CSS 里有 html.dark
 * 调色板，但**两边都没接到 DOM** ⇒ 页面恒亮色，开关看着能用其实没用。
 * 修好之后如果没有闸门，很容易再退回去，而且这种退化**构建不会报错、测试不会红**，
 * 只能靠肉眼在深色下看 —— 所以必须静态钉死这几处接线。
 *
 * 【钉死什么】
 * ① store 真的算出 effectiveDark（含系统偏好）
 * ② App.vue 把 Naive 的 theme 绑到 effectiveDark（不是只传 theme-overrides）
 * ③ App.vue 真把 dark 类落到 <html>（激活 variables.css 那套变量）
 * ④ variables.css 有 html.dark 块且声明 color-scheme: dark（否则安卓 WebView 会强制反色）
 * ⑤ 图表（canvas 不吃 CSS 变量）走 chartPalette，不再硬编码亮色文字色
 *
 * 【反例自检】（铁律 #11：核查脚本会假绿）
 * 拿一段「历史错误写法」喂给同一个检测函数，必须判红；否则说明本闸门是恒绿空壳。
 *
 * 用法：node tools/verify/verify_dark_mode.js
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'frontend', 'src');

function read(rel) {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

/** ② 的关键判定：模板里 theme 必须绑到 effectiveDark（抽出来给反例复用） */
function themeBoundToEffectiveDark(src) {
  return /:theme="[^"]*effectiveDark[^"]*"/.test(src);
}

let pass = 0;
let fail = 0;
function add(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}（${detail}）`); }
  else { fail++; console.log(`  ✘ ${name} —— ${detail}`); }
}

const store = read('stores/app.ts') || '';
const app = read('App.vue') || '';
const vars = read('styles/variables.css') || '';
const metric = read('views/StatsView/MetricCard.vue') || '';
const dash = read('views/DashboardView.vue') || '';
const chartTheme = read('utils/chart-theme.ts') || '';

// ① store 算出 effectiveDark
add('store 定义了 effectiveDark', /const\s+effectiveDark\s*=\s*computed\(/.test(store),
  store ? 'stores/app.ts' : 'stores/app.ts 不存在');
add('store 导出了 effectiveDark', /effectiveDark,/.test(store) || /effectiveDark\b[\s\S]{0,80}return/.test(store),
  '需在 return 里暴露，供图表读取');
add('store 监听系统深色偏好', /prefers-color-scheme:\s*dark/.test(store),
  '「跟随系统」模式依赖它');

// ② theme 绑到 effectiveDark
add('App.vue 把 theme 绑到 effectiveDark', themeBoundToEffectiveDark(app),
  '只传 theme-overrides 不传 theme 是历史 bug');
add('App.vue 同时传了 theme-overrides', /:theme-overrides="[^"]*effectiveDark[^"]*"/.test(app),
  '深浅两套品牌色都要给');

// ③ dark 类落到 DOM
add('App.vue toggle html.dark 类', /classList\.toggle\(\s*['"]dark['"]/.test(app),
  '不落类则 variables.css 的 html.dark 变量不生效');

// ④ variables.css 的 dark 块
const darkBlock = vars.match(/html\.dark\s*\{([\s\S]*?)\}/);
add('variables.css 有 html.dark 块', !!darkBlock, '深色调色板真源');
add('html.dark 声明 color-scheme: dark', !!darkBlock && /color-scheme:\s*dark/.test(darkBlock[1]),
  '缺它会被安卓 WebView 强制反色，导航栏透明');

// ⑤ 图表走 chartPalette
add('存在图表配色工具', /export function chartPalette/.test(chartTheme), 'utils/chart-theme.ts');
const darkPal = chartTheme.match(/const DARK[\s\S]*?\n\}/);
const lightPal = chartTheme.match(/const LIGHT[\s\S]*?\n\}/);
add('深浅两套图表配色确实不同',
  !!darkPal && !!lightPal && darkPal[0] !== lightPal[0] &&
  /axisLabel:\s*'#8a83a0'/.test(darkPal[0]) && /axisLabel:\s*'#94a3b8'/.test(lightPal[0]),
  '两套一样等于没做深色');
add('MetricCard 图表走主题配色', /chartPalette\(/.test(metric) && !/color:\s*'#1e293b'/.test(metric),
  'canvas 不吃 CSS 变量，必须显式取色');
add('DashboardView 图表走主题配色', /chartPalette\(/.test(dash) && !/color:\s*'#888'/.test(dash),
  '同上');

// ── 反例自检 ──────────────────────────────────────────────────────────
// 历史错误写法：只传 theme-overrides、没有 theme —— 检测函数必须判红
const legacySnippet = `
<n-config-provider
  :theme-overrides="themeOverrides"
  :locale="zhCN"
>
</n-config-provider>
`;
if (themeBoundToEffectiveDark(legacySnippet)) {
  fail++;
  console.log('  ✘ 反例自检失败：旧写法（只传 theme-overrides）被误判为「已绑 theme」—— 本闸门是假护栏');
} else {
  pass++;
  console.log('  ✔ 反例自检：旧写法（只传 theme-overrides、无 theme）确实判红');
}

console.log('\n' + '='.repeat(50));
console.log(`深色模式核查：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
