/**
 * 从 .vue / .ts 源码里抽出真实函数源码并在 node 中执行的小工具。
 * 目的：验证「前端纯函数」时，跑的是源码原文，而不是重新实现一遍（避免自欺欺人）。
 */
const fs = require('fs');

/** 抽出 `function <name>(...) { ... }` 的完整源码（按花括号配平） */
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) {
    // 兜底：容错 `function name (` 这种写法
    const j = src.indexOf('function ' + name);
    if (j < 0) return null;
    return braceSlice(src, j);
  }
  return braceSlice(src, i);
}

function braceSlice(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(from, k + 1); }
  }
  return null;
}

/**
 * 剥掉 TS 类型标注，使其可在 node 里直接跑。
 * ⚠️ 只在【参数表位置】（前面是 `(` 或 `,`）和【返回值位置】（前面是 `)`）剥，
 *    绝不能裸匹配 `: Type` —— 三元运算符的冒号（a ? b : c.name）会被误伤成语法错。
 * 支持：可选参数 `x?`、联合类型 `A | B`、数组 `T[]`、泛型 `Record<string, string>`。
 */
function stripTs(s) {
  const T = '[A-Za-z_$][\\w$]*(?:<[^<>]*>)?(?:\\[\\])*';
  return String(s)
    .replace(new RegExp('([(,])\\s*([A-Za-z_$][\\w$]*)\\??\\s*:\\s*' + T + '(?:\\s*\\|\\s*' + T + ')*', 'g'), '$1 $2')
    .replace(new RegExp('\\)\\s*:\\s*' + T + '(?:\\s*\\|\\s*' + T + ')*\\s*\\{', 'g'), ') {');
}

/**
 * 把若干函数抽出来、剥类型、装进一个可以直接调用的对象。
 * @param {string} vuePath .vue/.ts 源文件
 * @param {string[]} names  要抽的函数名（按依赖顺序，被依赖的放前面）
 * @param {Record<string,Function>} stubs 需要注入的外部依赖（如 getItemReports）
 * @param {string[]} exportNames 要返回的函数名
 */
function buildFunctions(vuePath, names, stubs = {}, exportNames = names) {
  const src = fs.readFileSync(vuePath, 'utf-8');
  const missing = [];
  const parts = [];
  for (const n of names) {
    const f = extractFn(src, n);
    if (!f) { missing.push(n); continue; }
    parts.push(stripTs(f));
  }
  if (missing.length) {
    return { ok: false, missing, api: null, generated: null };
  }
  const generated = Object.keys(stubs).map(k => `const ${k} = arguments[0]['${k}'];`).join('\n')
    + '\n' + parts.join('\n')
    + `\nreturn { ${exportNames.join(', ')} };`;
  let api;
  try {
    api = new Function(generated)(stubs);
  } catch (e) {
    return { ok: false, missing: [], error: e, api: null, generated };
  }
  return { ok: true, missing: [], api, generated };
}

module.exports = { extractFn, stripTs, buildFunctions };
