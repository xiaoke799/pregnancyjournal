/**
 * 导航栏高亮判定核查
 *
 * 背景（用户报的问题）：点哪个页面哪个高亮，但**首页一直高亮**。
 * 根因：`<router-link active-class>` 是**前缀匹配**，而首页路径是 `/` ——
 * 任何路径都以 `/` 开头，所以首页永远命中。
 *
 * 本脚本做两件事：
 *  ① 断言模板不再使用 `active-class`（回退即报错）；
 *  ② 把组件里**真实的 isNavActive 函数源码**抽出来执行（不是另写一份逻辑），
 *     逐个路由断言「谁该高亮、谁不该高亮」——重点是 `/record` 时**首页不能亮**。
 *
 * 用法：node verify_navbar_highlight.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = require('./_env').REPO;
const FILE = path.join(ROOT, 'frontend/src/layouts/MainLayout.vue');
const src = fs.readFileSync(FILE, 'utf-8');

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

// ---------- ① 模板层面：不能再用 active-class ----------
out.push('【模板】');
const activeClassHits = [...src.matchAll(/active-class\s*=/g)].length;
check('不再使用 router-link 的 active-class（前缀匹配会让首页永远高亮）',
  activeClassHits === 0, `仍出现 ${activeClassHits} 处`);
check('侧边栏用 isNavActive 判定高亮', /:class="\{ active: isNavActive\(item\) \}"/.test(src));
check('手机端 tabbar 也用 isNavActive 判定高亮', /:class="\{ 'tabbar-active': isNavActive\(item\) \}"/.test(src));

// ---------- ② 抽出真实的 isNavActive 源码 ----------
out.push('');
out.push('【判定函数（用组件里的真实源码执行）】');
const fnMatch = src.match(/function isNavActive\([^)]*\)\s*:\s*boolean\s*\{([\s\S]*?)\n\}/);
check('能从组件里抽到 isNavActive 函数', !!fnMatch);
if (!fnMatch) {
  console.log(out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  process.exit(1);
}
const fnBody = fnMatch[1];
check('函数体引用了 route.path（说明确实按当前路径判定）', /route\.path/.test(fnBody));
check('函数体引用了 extraPaths（子页面映射）', /extraPaths/.test(fnBody));

// route 是 useRoute() 拿到的，这里用桩对象喂进去执行真实逻辑
const isNavActive = new Function('route', `return function isNavActive(item) {${fnBody}\n}`)({});

// ---------- ③ 抽出 navItems 定义 ----------
const navBlock = src.match(/const navItems = \[([\s\S]*?)\n\]\n/);
check('能从组件里抽到 navItems', !!navBlock);
if (!navBlock) {
  console.log(out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  process.exit(1);
}
// 每项形如 { path: '/xxx', label: '中文', extraPaths: [...], paths: [...] }
const items = [...navBlock[1].matchAll(/\{ path: '([^']+)', label: '([^']+)'(?:, extraPaths: \[([^\]]*)\])?, paths: \[/g)]
  .map((m) => ({
    path: m[1],
    label: m[2],
    extraPaths: m[3] ? [...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [],
  }));
out.push('');
out.push('【导航项解析】');
check(`解析出 ${items.length} 个导航项（期望 8）`, items.length === 8, `实际 ${items.length}`);
check('解析出的路径与预期一致',
  JSON.stringify(items.map((i) => i.path)) === JSON.stringify(['/', '/record', '/diary', '/album', '/checkup-schedule', '/diet', '/checklist', '/settings']),
  items.map((i) => i.path).join(','));

// ---------- ④ 逐路由断言 ----------
const activeFor = (routePath) => {
  const stub = { path: routePath };
  const fn = new Function('route', `return function isNavActive(item) {${fnBody}\n}`)(stub);
  return items.filter((i) => fn(i)).map((i) => i.path);
};

out.push('');
out.push('【逐个页面断言（期望高亮的导航项）】');
const cases = [
  ['/', ['/']],
  ['/record', ['/record']],
  ['/diary', ['/diary']],
  ['/album', ['/album']],
  ['/checkup-schedule', ['/checkup-schedule']],
  ['/diet', ['/diet']],
  ['/checklist', ['/checklist']],
  ['/settings', ['/settings']],
  ['/exercise-guide', ['/']],        // 从首页点进去的子页面：首页保持高亮
  ['/weekly-detail', ['/']],
  ['/dose-plan', ['/']],
  ['/stats', []],                    // 隐藏路由：不高亮任何一个
  ['/contraction-timer', []],        // 全屏页
];
for (const [p, expect] of cases) {
  const got = activeFor(p);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  const desc = expect.length === 0
    ? `${p} → 无高亮`
    : `${p} → 高亮 ${expect.map((x) => (x === '/' ? '首页' : items.find((i) => i.path === x).label)).join('、')}`;
  check(desc + (ok ? '' : `  (实际 ${JSON.stringify(got)})`), ok);
}

// ---------- ⑤ 核心回归：任何非首页路径都不能让首页高亮 ----------
out.push('');
out.push('【核心回归（用户报的问题）】');
const nonHome = ['/record', '/diary', '/album', '/checkup-schedule', '/diet', '/checklist', '/settings',
  '/stats', '/contraction-timer', '/fetal-movement-counter'];
const homeLeaks = nonHome.filter((p) => activeFor(p).includes('/'));
check('除「/」与首页子页面外，首页都不再高亮',
  homeLeaks.length === 0, `仍在这些页面高亮: ${homeLeaks.join(', ')}`);
const multi = cases.filter(([p]) => activeFor(p).length > 1);
check('每个页面最多只有一个导航项高亮', multi.length === 0,
  multi.map(([p]) => p).join(', '));

console.log(out.join('\n'));
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
