/**
 * 模板变量引用核查
 *
 * 【为什么需要它】
 * Vue 模板里引用一个**不存在**的变量，`vite build` 一声不吭 ——
 * 它不做模板作用域分析。只有运行时渲染到那个组件才会炸：
 *   TypeError: Cannot read properties of undefined (reading 'length')
 * 然后被 App.vue 的错误边界接住，整个页面变成"这个页面出错了"。
 *
 * 2026-09-28 真实事故：相册页写成了 `photos.length`，而实际变量叫 `allPhotos`
 * —— 构建通过、静态检查通过、打包验证通过，用户装上才发现相册打不开。
 * 本脚本就是为堵住这一类问题而写。
 *
 * 做法：把 <template> 里所有表达式中的**根标识符**抠出来，
 * 逐个确认它在 <script setup> 里出现过（script setup 的顶层绑定都会暴露给模板）。
 *
 * ⚠️ 故意保守：只在"script 里完全找不到这个名字"时才报错，
 *    宁可漏报也不误报 —— 一个有假阳性的检查脚本没人会用。
 *
 * 用法：node tools/verify/verify_template_vars.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'frontend/src');

/**
 * 判断某个名字在 script 里是否**作为绑定被定义**。
 *
 * ⚠️ 为什么不去"剥注释后全文查找"：用正则剥 JS 注释是不可靠的 ——
 * 字符串或正则字面量里的 /* // 会被当成注释起点，
 * 实测在 SettingsView.vue 上把 23786 字符的 script 删成了 12277（砍掉一半代码），
 * 于是里面明明定义好的变量全被判成"未定义"，满屏假阳性。
 *
 * 改成只认「定义形态」：const/let/var、function、class、import、以及解构。
 * 代价是注释里如果恰好写了 `const photos` 会漏报 —— 漏报可以接受，误报不行。
 */
function isDefined(id, script) {
  const w = `\\b${id}\\b`;
  // ⚠️ 只认**顶层**声明：模板只能访问 <script setup> 的顶层绑定，
  //    函数体内的局部变量（缩进 ≥4 空格）模板根本看不到。
  //    这一点是踩出来的：AlbumView 的 loadPhotos() 里有 `const photos = res.data`，
  //    不限定缩进就会把模板里那个错误的 `photos` 判成"已定义"，直接漏报。
  // 顶层声明的两种形态：行首（缩进 ≤2）或紧跟在分号后（同一行写多句，
  // 例如 DietView 的 `const a=ref(false);const b=ref('')`）。
  // 函数体内的语句缩进 ≥4 且逐行分开，不会被误判成顶层。
  const TOP = '(?:^[ \\t]{0,2}|;[ \\t]*)';
  return (
    new RegExp(`${TOP}(?:const|let|var)\\s+${w}`, 'm').test(script) ||
    // ⚠️ 必须容忍 `async function`：项目里大量 handler 写成 async function xxx()，
    //    漏掉这个前缀会把一整批真实存在的函数判成"未定义"（RecordView/SettingsView 各几十个）。
    new RegExp(`${TOP}(?:async\\s+)?function\\s+${w}`, 'm').test(script) ||
    new RegExp(`${TOP}class\\s+${w}`, 'm').test(script) ||
    // import 常写成多行，[\\s\\S] 允许跨行（但不能限制在同一行，否则跨行导入会漏判）
    new RegExp(`^[ \\t]*import\\b[\\s\\S]{0,800}?\\b${w}\\b`, 'm').test(script) ||
    // 顶层解构：const { a, b } = ...  /  const [a, b] = ...  /  const { a: b } = ...
    new RegExp(`${TOP}(?:const|let|var)\\s*[\\[{][\\s\\S]{0,400}?\\b${w}\\b[\\s\\S]{0,400}?[\\]}]\\s*[=;]`, 'm').test(script)
  );
}

/**
 * 收集 defineProps 声明的字段名。
 *
 * ⚠️ 关键：Vue 3 里 props 在模板中**可以直接使用**，不必写 `props.` 前缀：
 *      const props = defineProps({ title: {...} })
 *      <template>{{ title }}</template>        ← 合法
 * 不把这些字段算作"已定义"，会把所有用这种写法的组件判成错误（MetricCard 等一批）。
 */
function collectProps(script) {
  const names = new Set();
  // 对象形式：defineProps({ title: {...}, color: {...} }) —— 取顶层键
  const obj = script.match(/defineProps\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/);
  if (obj) {
    for (const m of obj[1].matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*:/g)) names.add(m[1]);
  }
  // 类型式：defineProps<{ title: string; color?: string }>()
  const typ = script.match(/defineProps\s*<([\s\S]*?)>\s*\(/);
  if (typ) {
    for (const m of typ[1].matchAll(/(?:^|[,{;\n])\s*([A-Za-z_$][\w$]*)\s*\??\s*:/g)) names.add(m[1]);
  }
  // 数组形式：defineProps(['title', 'color'])
  const arr = script.match(/defineProps\s*\(\s*\[([^\]]*)\]/);
  if (arr) {
    for (const m of arr[1].matchAll(/['"]([A-Za-z_$][\w$]*)['"]/g)) names.add(m[1]);
  }
  return names;
}

/** 模板表达式里允许出现、但不需要在 script 中定义的名字 */
const BUILTIN = new Set([
  // 字面量与关键字
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'in', 'of', 'new', 'typeof', 'instanceof', 'void', 'delete', 'return', 'if', 'else',
  // 全局对象/函数
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'RegExp',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'console', 'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Promise',
  // Vue 模板内建
  '$event', '$refs', '$attrs', '$slots', '$props', '$emit', '$el', '$options',
  '$router', '$route', '$pinia', '$store',
]);

/** 递归收集 .vue 文件 */
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.vue')) out.push(p);
  }
  return out;
}

const problems = [];
let checkedFiles = 0;
let checkedExprs = 0;
let skipped = 0;

for (const file of walk(SRC)) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const tplMatch = raw.match(/<template>([\s\S]*)<\/template>/);
  if (!tplMatch) continue;

  // ⚠️ 必须精确取 **script setup** 那一块，不能用 /<script[^>]*>([\s\S]*?)<\/script>/。
  // 后者是「第一个 script 块」，组件里若同时有普通 <script>（放 name 之类）和
  // <script setup>，非贪婪匹配会取到前者 ⇒ 拿到的绑定列表是空的 ⇒ 满屏假阳性。
  const scriptSetupMatch = raw.match(/<script[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptSetupMatch) { skipped++; continue; }

  const tpl = tplMatch[1];
  const scriptRaw = scriptSetupMatch[1];

  checkedFiles++;

  // ---- 1. 收集模板引入的局部变量（v-for 的迭代变量、v-slot 的解构） ----
  const locals = new Set();
  for (const m of tpl.matchAll(/v-for\s*=\s*"\s*\(?([^")]+?)\)?\s+in\s+([^"]+)"/g)) {
    m[1].split(',').forEach((s) => locals.add(s.trim()));
  }
  for (const m of tpl.matchAll(/v-slot\s*=\s*"\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((s) => locals.add(s.trim().split(':').pop().trim()));
  }
  for (const m of tpl.matchAll(/#\w+\s*=\s*"\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((s) => locals.add(s.trim().split(':').pop().trim()));
  }
  // v-for 的源表达式也要检查（"in" 后面的那部分）
  const exprs = [];
  for (const m of tpl.matchAll(/v-for\s*=\s*"\s*\(?[^")]+?\)?\s+in\s+([^"]+)"/g)) exprs.push(m[1]);

  // ---- 2. 收集其余表达式 ----
  for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1]);
  // 带值的绑定：:prop / v-bind: / @event / v-if / v-show / v-model ...
  for (const m of tpl.matchAll(/(?:\s|^)(?::|v-bind:|@|v-on:|v-if|v-else-if|v-show|v-html|v-text|v-model(?:\.\w+)*)[\w:.-]*\s*=\s*"([^"]*)"/g)) {
    exprs.push(m[1]);
  }

  // ---- 3. 从表达式抠出根标识符 ----
  const ids = new Set();
  for (const expr of exprs) {
    if (!expr) continue;
    checkedExprs++;
    // 去掉字符串字面量（里面的词不是变量名）
    let e = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
    // 去掉 TypeScript 类型断言：模板里写 `(e.target as HTMLInputElement)` 时，
    // as / HTMLInputElement / Event 这些都不是变量（@change="..." 里很常见）
    e = e.replace(/\s+as\s+[A-Za-z_$][\w$.<>[\]]*/g, '');
    // 去掉箭头函数参数上的 TS 类型标注：`@update:value="(v: boolean) => fn(v)"` 里的
    // boolean 是类型不是变量，不剥掉会被当成"未定义"报出来（2026-09-29 DosePlanView 实测假红）。
    // ⚠️ 只处理「后面紧跟 =>」的那一对括号，避免误伤普通函数调用里的实参。
    e = e.replace(/\(([^()]*)\)\s*=>/g, (_f, params) =>
      `(${params.split(',').map((s) => s.split(':')[0]).join(',')}) =>`,
    );
    // 去掉属性访问（item.name → item），避免把属性名当成变量
    e = e.replace(/\??\.[A-Za-z_$][\w$]*/g, '');
    // ⚠️ 去掉对象字面量的**键名**：:class="{ active: cond }"、:style="{ padding: x }"
    //    里的 active / padding 是键，不是变量。不剥掉会满屏假阳性。
    //    只认紧跟 { 或 , 之后、"名字 + 冒号"的形态，所以不会误伤三元里的 `a : b`。
    e = e.replace(/([,{]\s*)[A-Za-z_$][\w$]*(\s*:)/g, '$1$2');
    // 箭头函数的参数也是模板里的局部变量：@click="e => ..." / @change="(a, b) => ..."
    // ⚠️ 参数列表必须排除内层括号：`tableData('bp', 'x', { format: (r: any) => ... })`
    //    用 [^)]* 会贪婪跨过内层括号，把整段 " 'x', { format: (r: any" 当成参数列表，
    //    结果真正的 r 没被收集，被误报成"未定义"。
    for (const m of e.matchAll(/\(([^()]*)\)\s*=>/g)) {
      m[1].split(',').forEach((s) => {
        // 参数可能带 TS 类型标注或默认值：(r: any) => / (v = 1) =>
        // 不剥掉的话 locals 里存的是 "r: any"，真正的 r 仍会被当成"未定义"
        const n = s.trim().replace(/^\.\.\./, '').split('=')[0].split(':')[0].trim();
        if (n) locals.add(n);
      });
    }
    for (const m of e.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) locals.add(m[1]);
    for (const m of e.matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(m[0]);
  }

  // ---- 4. 逐个确认在 script 里被定义 ----
  // 不剥注释：正则剥 JS 注释会把字符串/正则里的 /* // 误当注释，砍掉大片代码（见 isDefined 注释）
  const script = scriptRaw;
  // props 字段在模板里可直接用，等价于局部变量
  for (const n of collectProps(script)) locals.add(n);
  const missing = [];
  for (const id of ids) {
    if (!id || BUILTIN.has(id) || locals.has(id)) continue;
    // 只检查小写/下划线开头的名字。以大写开头的基本是组件名或 TS 类型
    // （AppIcon、HTMLInputElement、Event…），它们在模板里合法出现却未必有 const 定义，
    // 全查会引入大量假阳性。变量名惯例上都是小写开头，这样筛不会漏掉真变量。
    if (/^[A-Z]/.test(id)) continue;
    if (!isDefined(id, script)) missing.push(id);
  }
  if (missing.length) {
    problems.push({ file: rel, missing: [...new Set(missing)].sort() });
  }
}

console.log(`已检查 ${checkedFiles} 个 <script setup> 组件（${checkedExprs} 条模板表达式）`);
if (skipped) console.log(`跳过 ${skipped} 个非 setup 组件（Options API 暴露规则不同）`);
console.log('');

if (problems.length === 0) {
  console.log('✅ 模板里没有引用不存在的变量');
  process.exit(0);
}

console.log('❌ 以下模板引用的名字在 <script setup> 里找不到 —— 运行到该组件会直接抛错：\n');
for (const p of problems) {
  console.log(`  ${p.file}`);
  console.log(`      未定义: ${p.missing.join(', ')}`);
}
console.log(`\n共 ${problems.length} 个文件有问题`);
process.exit(1);
