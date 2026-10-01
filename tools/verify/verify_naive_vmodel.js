/**
 * naive-ui 组件「裸 v-model」误用体检（静态，秒级）。
 *
 * 【为什么需要】
 * naive-ui 的组件**没有** `modelValue` 这一套约定，它们各自用**具名** prop：
 *   `n-radio-group` / `n-input` / `n-select` → `value`
 *   `n-modal` / `n-drawer`                   → `show`
 *   `n-checkbox`                             → `checked`
 *   `n-date-picker`                          → `value`（+ `formatted-value`，见铁律 #1）
 * ⇒ 写成裸 `v-model="x"` 时，Vue 会编译成 `modelValue` + `onUpdate:modelValue`，
 *   **组件一个都不认**：外部状态永远不更新、选中态也不会变。
 *
 * 【真实事故（2026-10-01 用户反馈）】
 * 「饮食 → 催奶食谱大全：只有『猪蹄系列』能显示，其他鱼类、禽肉点不开」
 * 根因就是 `DietView.vue` 里 `<n-radio-group v-model="boostCat">` 写成了裸 `v-model`：
 *   `boostCat` 初值 'pig' ⇒ 永远停在猪蹄系列；点其它分类只 emit `update:value`（没人听）。
 * 全项目 128 处 `v-model:value` 都对，唯独这一处错了 —— 靠人眼 review 基本抓不到。
 *
 * 【判据】`<n-xxx ... v-model="…">`（`v-model` 后紧跟 `=`，即**没有** `:value` / `:show`
 *   这类具名修饰）即判红。原生元素（`<input>` / `<select>` / `<textarea>`）的 `v-model`
 *   是**正确**用法，不在扫描范围。
 *
 * 用法：node tools/verify/verify_naive_vmodel.js
 */
const fs = require('fs');
const path = require('path');

const env = require('./_env');
const SRC = path.join(env.REPO, 'frontend', 'src');

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

/** 把字符串字面量挖空，避免属性值里的 `>`（箭头函数、泛型）把标签切断 */
function maskStrings(src) {
  return src.replace(/"[^"]*"/g, '"@"').replace(/'[^']*'/g, "'@'");
}

/**
 * 扫一段模板源码，返回「裸 v-model 用在 naive-ui 组件上」的位置列表。
 * ⚠️ 只匹配 `v-model` 后紧跟 `=` 的写法 —— `v-model:value="x"` 的 `v-model` 后面是 `:`，
 *    不会被 `\bv-model\s*=` 命中（正则要求 `=` 紧跟在 v-model 之后，允许空白）。
 */
function findBareVModel(src) {
  const masked = maskStrings(src);
  const hits = [];
  const tagRe = /<(n-[a-z0-9-]+)\b([^>]*)>/gs;
  let m;
  while ((m = tagRe.exec(masked)) !== null) {
    const tag = m[1];
    const attrs = m[2];
    if (/\bv-model\s*=/.test(attrs)) {
      const line = masked.slice(0, m.index).split('\n').length;
      hits.push({ tag, line });
    }
  }
  return hits;
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.vue')) acc.push(p);
  }
  return acc;
}

// ==========================================================================
console.log('\n########## A. 契约断言：naive-ui 组件确实没有 modelValue ##########');
// ==========================================================================
const rgDts = path.join(env.REPO, 'frontend', 'node_modules', 'naive-ui', 'es', 'radio', 'src', 'RadioGroup.d.ts');
if (!fs.existsSync(rgDts)) {
  check('frontend/node_modules 里能找到 naive-ui（缺了按失败处理，fail-closed）', false, rgDts);
} else {
  const t = fs.readFileSync(rgDts, 'utf8');
  check('naive-ui RadioGroup 暴露的是 value prop', /readonly value:\s*PropType/.test(t));
  check('naive-ui RadioGroup 暴露的是 onUpdate:value 事件', /onUpdate:value/.test(t));
  check('naive-ui RadioGroup **没有** modelValue（所以裸 v-model 必然失效）', !/modelValue/.test(t));
}

// ==========================================================================
console.log('\n########## B. 扫描 frontend/src 下的 .vue ##########');
// ==========================================================================
const files = walk(SRC, []);
const offenders = [];
for (const f of files) {
  for (const h of findBareVModel(fs.readFileSync(f, 'utf8'))) {
    offenders.push({ file: path.relative(env.REPO, f), ...h });
  }
}
check(
  `frontend/src 下 ${files.length} 个 .vue 里没有「裸 v-model 用在 naive-ui 组件上」`,
  offenders.length === 0,
  offenders.map((o) => `${o.file}:${o.line} <${o.tag}>`).join('; ')
);

// ==========================================================================
console.log('\n########## C. 反例自检（护栏必须有区分度）##########');
// ==========================================================================
const bad = '<n-radio-group v-model="boostCat" size="small">';
check('[反例] 裸 v-model 的 n-radio-group 能被抓到', findBareVModel(bad).length === 1);
const good = '<n-radio-group v-model:value="boostCat" size="small">';
check('[正例] v-model:value 不误报', findBareVModel(good).length === 0);
const native = '<input v-model="form.dueDate" class="x" />';
check('[正例] 原生 input 的 v-model 不误报', findBareVModel(native).length === 0);
const multiline = '<n-select\n  v-model="meal.type"\n  :options="a.map(x => x.b)"\n/>';
check('[反例] 跨行标签同样能抓到（且不被属性里的 > 切断）', findBareVModel(multiline).length === 1);

console.log('\n########## D. 编译期：DietView 的 n-radio-group 真的绑到了 value ##########');
// ==========================================================================
// 文本扫描只能证明「源码写了 v-model:value」；这里再进一步 —— 用 Vue 自己的编译器
// 编译模板，看**生成代码里到底绑到哪个 prop**（这才是运行时会执行的东西）。
const sfcPath = path.join(env.REPO, 'frontend', 'node_modules', '@vue', 'compiler-sfc');
if (!fs.existsSync(sfcPath)) {
  check('能找到 @vue/compiler-sfc（缺了按失败处理，fail-closed）', false, sfcPath);
} else {
  const c = require(sfcPath);
  /** 编译一段模板，返回 n-radio-group 的 createVNode 绑定对象源码 */
  const bindOf = (tplSrc) => {
    const r = c.compileTemplate({ source: tplSrc, id: 'x', filename: 'x.vue' });
    const m = /_createVNode\(_component_n_radio_group\s*,\s*\{([\s\S]*?)\}\s*,/.exec(r.code);
    return m ? m[1] : null;
  };
  const dietSrc = fs.readFileSync(path.join(SRC, 'views', 'DietView.vue'), 'utf8');
  const tpl = c.parse(dietSrc).descriptor.template.content;
  const b = bindOf(tpl);
  check('DietView 的 n-radio-group 编译后能定位到绑定对象', !!b);
  if (b) {
    check('绑到 value（组件真正认的 prop）', /\bvalue\s*:/.test(b));
    check('绑到 onUpdate:value', /onUpdate:value/.test(b));
    check('**没有**绑到 modelValue（绑错则点击分类永远不生效）', !/modelValue/.test(b));
  }
  // 反例：把这一处换回裸 v-model，编译产物必然变成 modelValue
  const badTpl = tpl.replace('v-model:value="boostCat"', 'v-model="boostCat"');
  const bb = bindOf(badTpl);
  check('[反例] 裸 v-model 编译后确实绑到 modelValue（证明上面的断言有区分度）',
    !!bb && /modelValue/.test(bb), bb ? bb.slice(0, 80) : '未定位到绑定');
}

// ==========================================================================
console.log('\n########## E. 组件级运行时：naive-ui 只认 value（真实渲染，不是推测）##########');
// ==========================================================================
// 用 @vue/server-renderer 把**真实的 naive-ui 组件**渲染成 HTML，数一下有几项处于选中态：
//   传 value      → 恰 1 项 checked
//   传 modelValue  → 0 项 checked  ← 这就是裸 v-model 的实际后果：点了没反应、也没有选中态
// （这是 naive-ui 自己的代码在跑，不是我们对文档的转述。）
function finish() {
  console.log('\n' + out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

const vuePath = path.join(env.REPO, 'frontend', 'node_modules', 'vue');
const ssrPath = path.join(env.REPO, 'frontend', 'node_modules', '@vue', 'server-renderer');
const naivePath = path.join(env.REPO, 'frontend', 'node_modules', 'naive-ui');
if (![vuePath, ssrPath, naivePath].every((p) => fs.existsSync(p))) {
  check('vue / @vue/server-renderer / naive-ui 都可用（缺了按失败处理，fail-closed）', false);
  finish();
} else {
  try {
    const { createSSRApp, h, ref } = require(vuePath);
    const { renderToString } = require(ssrPath);
    const { NRadioGroup, NRadioButton } = require(naivePath);
    const mk = (key, evt) => {
      const app = createSSRApp({
        setup() {
          const v = ref('fish');
          return () => h(NRadioGroup, { [key]: v.value, [evt]: (x) => { v.value = x; }, size: 'small' }, {
            default: () => [
              h(NRadioButton, { value: 'pig' }, { default: () => '猪蹄系列' }),
              h(NRadioButton, { value: 'fish' }, { default: () => '鱼类系列' }),
            ],
          });
        },
      });
      return renderToString(app);
    };
    const checkedCount = (html) => (html.match(/n-radio-button--checked/g) || []).length;
    Promise.all([mk('value', 'onUpdate:value'), mk('modelValue', 'onUpdate:modelValue')])
      .then(([a, b]) => {
        check('传 value 时恰有 1 项选中（组件认 value）', checkedCount(a) === 1, `checked=${checkedCount(a)}`);
        check('传 modelValue 时 0 项选中（裸 v-model 的真实后果）', checkedCount(b) === 0, `checked=${checkedCount(b)}`);
        finish();
      })
      .catch((e) => { check('SSR 渲染不抛错', false, e && e.message); finish(); });
  } catch (e) {
    check('naive-ui 能以 CJS 方式加载', false, e && e.message);
    finish();
  }
}
