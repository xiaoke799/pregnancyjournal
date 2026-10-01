#!/usr/bin/env node
/**
 * 主题令牌「幽灵引用」+「硬写亮色残留」体检
 *
 * 背景（两次真事故）：
 *  ① 幽灵令牌：代码里写 var(--bg-secondary, ...) 但这个令牌**从未在 variables.css 定义**
 *     ⇒ var() 恒取兜底亮色 ⇒ 深色模式下出现白条，而"这个变量有没有定义"肉眼极难发现。
 *  ② 硬写亮色：页面直接写 background:#f8fafc / white / #fff，深色模式同样亮成白条。
 *
 * 本脚本把这两类做成机器检查，进 run_all_suites 常驻回归。
 *
 * 判定口径：
 *  - 令牌定义集 = 全 frontend/src（含组件内局部定义）里出现的所有 `--x:` 声明；
 *    Naive UI 运行时注入的 `--n-*` 前缀豁免。
 *  - 幽灵引用 = var(--x) 里的 x 不在定义集里。
 *  - 硬写色风险 = <style> 段内
 *      · 背景/描边/阴影 类属性上的色值相对亮度 L > 0.80（深色底必白）
 *      · 文字色 类属性上的色值 L < 0.20（深色底看不见）
 *    跳过 html.dark / [data-theme=dark] 作用域内的（那本来就是给深色用的），单独记为豁免。
 *
 * 用法：node tools/verify/probe_theme_tokens.js
 *   --list-ghosts  只跑幽灵令牌
 *   --list-hard    只跑硬写色
 *   --all          连被豁免的行也列出来
 *   --warn-only    只诊断，退出码恒 0（跑在"有历史债尚未清完"的阶段）
 *   CK_ROOT=<dir>  扫描根指到别处（反例验证用）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const env = require('./_env');
const ROOT = process.env.CK_ROOT || path.join(env.REPO, 'frontend', 'src');
const warnOnly = process.argv.includes('--warn-only');
const onlyGhost = process.argv.includes('--list-ghosts');
const onlyHard = process.argv.includes('--list-hard');
const showAll = process.argv.includes('--all');
const showFreq = process.argv.includes('--freq');
const doFix = process.argv.includes('--fix');

/* ---------- 收集源文件 ---------- */
function walk(dir, acc = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc); }
    else if (/\.(vue|css|scss)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const FILES = walk(ROOT);

/* ---------- ① 幽灵令牌 ---------- */
const DEF_RE = /(--[A-Za-z0-9_-]+)\s*:/g;
const USE_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
// 动态注入也算有定义源：`<div :style="{ '--preview-color': item.color }">`
// （这种写法在 css 里搜不到 `--x:` 声明，但不是幽灵令牌）
const INJECT_RE = /['"`](--[A-Za-z0-9_-]+)['"`]\s*:/g;

const definedWhere = new Map();              // 令牌 -> 定义所在文件
const uses = [];                              // {name, file, n}
for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(src))) {
    if (!definedWhere.has(m[1])) definedWhere.set(m[1], path.relative(ROOT, f));
  }
  INJECT_RE.lastIndex = 0;
  while ((m = INJECT_RE.exec(src))) {
    if (!definedWhere.has(m[1])) definedWhere.set(m[1], path.relative(ROOT, f) + ' (动态注入)');
  }
  USE_RE.lastIndex = 0;
  const per = new Map();
  while ((m = USE_RE.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    if (!per.has(m[1])) per.set(m[1], { name: m[1], file: path.relative(ROOT, f), lines: [], n: 0 });
    const rec = per.get(m[1]);
    rec.n++; rec.lines.push(line);
  }
  for (const rec of per.values()) uses.push(rec);
}
const ghosts = uses.filter(u => !u.name.startsWith('--n-') && !definedWhere.has(u.name))
                  .sort((a, b) => a.name.localeCompare(b.name));

/* ---------- ② 硬写亮色 ---------- */
const NAMED = { white: [255, 255, 255], black: [0, 0, 0], whitesmoke: [245, 245, 245], silver: [192, 192, 192] };
function parseColor(tok) {
  tok = tok.trim().toLowerCase();
  if (NAMED[tok]) return NAMED[tok];
  let m = /^#([0-9a-f]{3})$/.exec(tok);
  if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
  m = /^#([0-9a-f]{6})$/.exec(tok) || /^#([0-9a-f]{8})$/.exec(tok);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(tok);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}
function lum(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// 注意： rgb/rgba 必须先于裸 hex 匹配，写成 alternation 本身已保证顺序无关（各自有前缀区分）
const COLOR_TOKEN_RE = /(#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b|\bwhitesmoke\b|\bsilver\b)/g;
const BG_PROPS = /^(background|background-color|background-image|border|border-color|border-(top|right|bottom|left)(-[a-z]+)?|outline|outline-color|box-shadow|fill|caret-color)$/;
const FG_PROPS = /^(color|text-decoration-color|-webkit-text-fill-color)$/;
const CHECKED = /(^(background|border|outline|box-shadow|fill|caret|color|-webkit-text-fill|text-decoration))|^color$/;
const NONEISH = /^(transparent|currentColor|inherit|initial|unset|none)$/;

/** 抽 style 段：<style>...</style> 或整个 .css 文件 */
function styleBlocks(src, rel) {
  const out = [];
  if (/\.css$/.test(rel)) { out.push({ rel, css: src, base: src }); return out; }
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(src))) out.push({ rel, css: m[1], base: src });
  return out;
}
/** 逐字符配平大括号切顶层规则块（避免 @media 嵌套被 find('}') 截断） */
function topBlocks(css) {
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    const sel = css.indexOf('{', i);
    if (sel < 0) break;
    let d = 0, j = sel;
    for (; j < css.length; j++) {
      if (css[j] === '{') d++;
      else if (css[j] === '}') { d--; if (d === 0) break; }
    }
    blocks.push({ head: css.slice(i, sel), body: css.slice(sel + 1, j) });
    i = j + 1;
  }
  return blocks;
}

const hard = [];
const exempt = [];
for (const f of FILES) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  for (const blk of styleBlocks(src, rel)) {
    for (const tb of topBlocks(blk.css)) {
      const isDarkScope = /html\.dark|\.dark\b|\[data-theme\s*=\s*["']?dark/.test(tb.head);
      for (const dRaw of tb.body.split(';')) {
        const d = dRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
        const ci = d.indexOf(':');
        if (ci < 0) continue;
        const prop = d.slice(0, ci).trim();
        const val = d.slice(ci + 1).trim();
        if (!CHECKED.test(prop)) continue;
        // ⚠️ var(--x, #e2e8f0) 兜底里的色值**不是**硬写残留 —— 它是令牌生效时的备份值，
        //    令牌无效才会落到它。不 mask 掉会把"已令牌化"的行误报成硬写色（假阳性）。
        let naked = val, prevv;
        do { prevv = naked; naked = naked.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' '); } while (naked !== prevv);
        COLOR_TOKEN_RE.lastIndex = 0;
        let cm;
        const push = (it) => (isDarkScope ? exempt : hard).push(it);
        while ((cm = COLOR_TOKEN_RE.exec(naked))) {
          const tok = cm[0];
          if (NONEISH.test(tok)) continue;
          const rgb = parseColor(tok);
          if (!rgb) continue;
          const L = lum(rgb);
          let risk = null;
          if (BG_PROPS.test(prop) && L > 0.80) risk = 'bg-bright';
          else if (FG_PROPS.test(prop) && L < 0.20) risk = 'fg-dark';
          if (!risk) continue;
          const line = blk.base.slice(0, blk.base.indexOf(d) >= 0 ? blk.base.indexOf(d) : 0).split('\n').length;
          push({ file: rel, prop, val: val.length > 58 ? val.slice(0, 55) + '…' : val, color: tok, L: +L.toFixed(3), risk, line });
        }
      }
    }
  }
}

/* ---------- 显式映射表（无猜测：逐条来自 --freq 频率表 + variables.css 亮色值核对）----------
   判据：① 令牌的亮色值 == 原值 ⇒ 亮色模式零视觉变化（标注 等价）
        ② 令牌的亮色值 != 原值 ⇒ 属"设计令牌收口"，且必须两者对白底都 ≥ 4.5:1（见 IVV）
   ⚠️ 饱和高apurple / 深玫红等没有对应 ink 令牌的**不入表**，留 --fix 后人工处理。            */
const MAP_FG = {
  // —— 等价（令牌亮色值就是它）——
  '#1f1730': '--text-color', '#5c5275': '--text-secondary', '#c44680': '--primary-color',
  '#17709b': '--info-ink', '#b32d2d': '--error-ink', '#7d4f0d': '--warning-ink',
  // —— 收口（换后更浅，但对白底仍 ≥4.5:1）——
  '#64748b': '--text-secondary', '#475569': '--text-secondary',
  '#334155': '--text-color', '#1e293b': '--text-color', '#333': '--text-color',
  'black': '--text-color',
  '#92400e': '--warning-ink', '#166534': '--success-ink', '#991b1b': '--error-ink',
  '#dc2626': '--error-ink',
  '#0369a1': '--info-ink', '#0277bd': '--info-ink', '#0284c7': '--info-ink', '#1e40af': '--info-ink',
  '#4b5563': '--text-secondary',
  '#7c3aed': '--lilac-ink', '#7c5cbf': '--lilac-ink',
  '#9d174d': '--rose-ink', '#ad1457': '--rose-ink', '#be123c': '--rose-ink',
  '#4f46e5': '--indigo-ink', '#6366f1': '--indigo-ink',
  '#854d0e': '--warning-ink', '#9a3412': '--warning-ink', '#0e7490': '--info-ink',
};
const MAP_BG = {
  // —— 等价 ——
  '#ffffff': '--bg-card', '#fff': '--bg-card', 'white': '--bg-card',
  '#f4f8ff': '--bg-tint-blue', '#f1faf4': '--bg-tint-mint', '#fdf2f2': '--bg-tint-danger',
  '#fff9ec': '--bg-tint-cream', '#fff5fa': '--bg-tint-pink',
  '#f1ebf2': '--divider-color', '#efe7ef': '--border-color', '#e1d5e3': '--border-color-strong',
  '#fff5e8': '--stage-early-bg', '#e8f5fc': '--stage-mid-bg', '#fde7ed': '--stage-late-bg',
  '#f4f6fa': '--stage-preparing-bg', '#ebf7ed': '--stage-nursing-bg',
  // —— 收口 ——
  '#f8fafc': '--bg-color-2', '#f1f5f9': '--bg-color-2', '#f5f5f5': '--bg-color-2', '#f8f9fa': '--bg-color-2',
  '#e2e8f0': '--border-color', '#cbd5e1': '--border-color-strong',
  '#eff6ff': '--bg-tint-blue', '#f0f9ff': '--bg-tint-blue', '#eef2ff': '--bg-tint-blue', '#dbeafe': '--bg-tint-blue',
  '#f0fdf4': '--bg-tint-mint', '#dcfce7': '--bg-tint-mint', '#f6ffed': '--bg-tint-mint',
  '#fef3c7': '--bg-tint-cream', '#fffbe6': '--bg-tint-cream', '#fff7e6': '--bg-tint-cream',
  '#fffbeb': '--bg-tint-cream', '#fff3e0': '--bg-tint-cream', '#fef3f0': '--bg-tint-cream',
  '#fff2f0': '--bg-tint-danger', '#fef2f2': '--bg-tint-danger', '#fee2e2': '--bg-tint-danger',
  '#fdf4ff': '--bg-tint-pink', '#ede9fe': '--bg-tint-pink', '#faf5ff': '--bg-tint-pink', '#fdf1f5': '--bg-tint-pink',
  // —— 一次性色调（同样来自 --freq 表，逐个比对后归类到最接近的 tint）——
  '#d9f7be': '--bg-tint-mint', '#e0f5f1': '--bg-tint-mint',
  '#fff1b8': '--bg-tint-cream', '#ffe7ba': '--bg-tint-cream',
  '#e0e7ff': '--bg-tint-blue', '#e8f2fb': '--bg-tint-blue',
  '#ffe4e6': '--bg-tint-danger',
  '#fff8fb': '--bg-tint-pink', '#ffe8f0': '--bg-tint-pink', '#fce7f3': '--bg-tint-pink',
  '#ece7ff': '--bg-tint-pink', '#f5e8ff': '--bg-tint-pink', '#f3e8ff': '--bg-tint-pink',
  '#f0ebfb': '--bg-tint-pink', '#f2f0fd': '--bg-tint-pink',
  '#f3e8f0': '--border-color', '#fff7ed': '--bg-tint-cream', '#bbf7d0': '--bg-tint-mint',
  '#fdf2f8': '--bg-tint-pink', '#f5f3ff': '--bg-tint-pink',
  // ⚠️ 带 alpha 的浅底**一律不自动替换**：var(--x, rgba(...)) 在令牌生效时会丢掉半透明，
  //    亮色模式下就会出现肉眼可见的差异。这类留给截图验证后人工定夺。
};
function tokenFor(prop, tok) {
  const k = tok.trim().toLowerCase();
  if (BG_PROPS.test(prop)) return MAP_BG[k] || null;
  if (FG_PROPS.test(prop)) return MAP_FG[k] || null;
  return null;
}
/** 先把 var(...) / 已令牌化的片段保护起来，避免二次包裹成 var(x, var(x, #fff))
 *
 * ⚠️ 踩过的坑（2026-10-01）：嵌套 var( 必须**迭代还原**。
 *    `var(--a, var(--b, #fff))` 会先被 mask 成 `\0 1\0`（外层持有含 `\0 0\0` 的文本），
 *    只做一次 replace 时，外层的 `\0 0\0` 位于**已扫过的位置**，不会被还原 ⇒ 文件里留下
 *    真实的 NUL 字节，vue 直接变"二进制文件"。还原必须 do-while 到稳定。        */
const NULCH = String.fromCharCode(0);
function fixVal(prop, val) {
  const held = [];
  let x = val, prev;
  do {
    prev = x;
    x = x.replace(/var\((?:[^()]|\([^()]*\))*\)/g, (m) => { held.push(m); return NULCH + String(held.length - 1) + NULCH; });
  } while (x !== prev);
  x = x.replace(COLOR_TOKEN_RE, (m) => {
    const t = tokenFor(prop, m);
    return t ? `var(${t}, ${m})` : m;
  });
  let prev2;
  do {
    prev2 = x;
    x = x.replace(new RegExp(NULCH + '(\\d+)' + NULCH, 'g'), (m, i) => held[+i]);
  } while (x !== prev2);
  return x;
}
/** 写闸门：产出里绝不允许出现 NUL（出现过就是 mask 没还原干净，宁可中止也不落盘） */
function assertClean(out, rel) {
  if (!out.includes(NULCH)) return true;
  const at = out.indexOf(NULCH);
  console.error(`🔴 中止写入 ${rel}：检测到未还原的占位符 @${at}\n   ${JSON.stringify(out.slice(at - 70, at + 70))}`);
  return false;
}
function fixBody(body) {
  return body.replace(/([a-zA-Z-]+)(\s*:\s*)([^;{}]+)/g, (m0, prop, sep, val) => {
    if (prop.startsWith('--') || !CHECKED.test(prop)) return m0;
    const nv = fixVal(prop, val);
    return nv === val ? m0 : prop + sep + nv;
  });
}
/** 带索引版本的顶层块切分（配平大括号） */
function blocksIdx(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const s = css.indexOf('{', i);
    if (s < 0) break;
    let d = 0, j = s;
    for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (!d) break; } }
    out.push({ head: css.slice(i, s), open: s, close: j });
    i = j + 1;
  }
  return out;
}
function fixCss(css) {
  const bs = blocksIdx(css);
  if (!bs.length) return { css, n: 0 };
  let out = '', prev = 0, n = 0;
  for (const b of bs) {
    const head = b.head;
    const isDark = /html\.dark|\.dark\b|\[data-theme\s*=\s*["']?dark/.test(head);
    const body = css.slice(b.open + 1, b.close);
    const nb = isDark ? body : fixBody(body);
    if (nb !== body) n += (body.match(/;/g) || []).length ? 1 : 0;
    out += css.slice(prev, b.open + 1) + nb;
    prev = b.close;
  }
  out += css.slice(prev);
  return { css: out, n };
}

/* ---------- --fix：按映射表改写源文件（改完请再跑一次本脚本验证归零）---------- */
if (doFix) {
  let files = 0, decls = 0;
  const touched = [];
  for (const f of FILES) {
    const rel = path.relative(ROOT, f);
    const src = fs.readFileSync(f, 'utf8');
    let out, changed;
    if (/\.css$/.test(f)) {
      const r = fixCss(src);
      out = r.css; changed = r.css !== src;
    } else {
      changed = false;
      out = src.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (m0, attrs, css) => {
        const r = fixCss(css);
        if (r.css !== css) changed = true;
        return `<style${attrs}>${r.css}</style>`;
      });
    }
    if (!changed || out === src) continue;
    if (!assertClean(out, rel)) { process.exitCode = 2; break; }   // 有残留占位符 ⇒ 一个文件都不该落盘
    const before = (src.match(/var\(\s*--/g) || []).length;
    const after = (out.match(/var\(\s*--/g) || []).length;
    fs.writeFileSync(f, out);
    files++; decls += (after - before);
    touched.push(`${rel}  +${after - before}`);
  }
  console.log(`--fix 完成：改写 ${files} 个文件，新增 ${decls} 处 var() 令牌`);
  for (const t of touched) console.log('  ' + t);
  console.log('注：未命中映射表的饱和色（如 #7c3aed / #9d174d）保持原样，改完跑 --freq 复核剩余。');
  process.exit(0);
}

/* 白名单：已人工核定「深色模式下无害」的硬写色。**带额度**——额度用完就会重新变红，
   防止后来人继续往同一个文件里堆新的硬写色而没人发现。
   核定依据（2026-10-01 逐个读上下文确认）：
   - DashboardView(8)：全部叠在**品牌渐变卡片**上的玻璃高光 / 玻璃描边（radial-gradient 光斑、
     内投影、1px border）。渐变本身在深色下不变 ⇒ 高光观感一致，不会露白块。
   - global.css(2)：`.glass` 类，已有 `html.dark .glass` 深色覆盖，且 @supports 兜底也有 dark 分支。
   - MainLayout(1)：`inset 0 1px 0` 顶部 1px 内高光，面积可忽略。
   - AlbumView(1)：视频缩略图上的播放按钮白圆底，**刻意保留**（YouTube 式），图标色已令牌化。
   - ChecklistView(1)：进度条底槽，叠在渐变进度条之上，同 DashboardView 理由。
   - CheckupScheduleView(1)：激活 tab 的计数徽标，叠在激活态实色底之上。      */
const ALLOW = {
  'views\\DashboardView.vue': 8,
  'styles\\global.css': 2,
  'layouts\\MainLayout.vue': 1,
  'views\\AlbumView.vue': 1,
  'views\\ChecklistView.vue': 1,
  'views\\CheckupScheduleView.vue': 1,
};

/* ---------- 输出 ---------- */
let bad = 0;
const fail = (m) => { console.log('  🔴 ' + m); bad++; };
const ok = (m) => console.log('  ✅ ' + m);

console.log('=== 主题令牌体检 ===');
console.log(`扫描根: ${ROOT}`);
console.log(`样式源文件 ${FILES.length} 个（vue/css）｜令牌定义 ${definedWhere.size} 个｜var() 引用 ${uses.length} 组`);

const noFilter = !onlyGhost && !onlyHard;
if (onlyGhost || noFilter) {
  console.log('\n【① 幽灵令牌】var() 引用了从未定义过的令牌');
  if (!ghosts.length) ok('0 个幽灵令牌');
  else {
    for (const g of ghosts) fail(`${g.name}  ${g.file}:${g.lines.slice(0, 3).join(',')}  ×${g.n}`);
    console.log(`  ⇒ ${ghosts.length} 处`);
  }
}

if (onlyHard || noFilter) {
  console.log('\n【② 硬写亮色残留】深色模式下会白条 / 看不见的硬写色');
  const bgs = hard.filter(x => x.risk === 'bg-bright');
  const fgs = hard.filter(x => x.risk === 'fg-dark');
  console.log(`  背景/描边/阴影 L>0.80 ：${bgs.length} 处`);
  console.log(`  文字色        L<0.20 ：${fgs.length} 处`);
  console.log(`  深色作用域内豁免      ：${exempt.length} 处${showAll ? '（下方一并列出）' : '（--all 查看）'}`);
  const view = showAll ? [...hard, ...exempt.map(e => ({ ...e, file: e.file + ' [豁免]' }))] : hard;
  if (showFreq) {
    // 按色值聚合，供人工写「显式映射表」用（禁止凭色相猜测，一律查表）
    const agg = new Map();
    for (const it of hard) {
      const k = it.risk + '|' + it.color.toLowerCase();
      if (!agg.has(k)) agg.set(k, { risk: it.risk, color: it.color.toLowerCase(), n: 0, files: new Set(), props: new Set() });
      const a = agg.get(k);
      a.n++; a.files.add(it.file); a.props.add(it.prop);
    }
    console.log('\n  —— 色值频率表（risk|色值 次数 文件数 属性）——');
    for (const a of [...agg.values()].sort((x, y) => y.n - x.n)) {
      console.log(`  ${a.risk}|${a.color.padEnd(24)} ${String(a.n).padStart(3)}  ${String(a.files.size).padStart(3)}f  ${[...a.props].join(',')}`);
    }
    console.log(`  ⇒ ${agg.size} 个不同色值`);
    return;
  }
  const byFile = new Map();
  for (const it of view) {
    if (!byFile.has(it.file)) byFile.set(it.file, []);
    byFile.get(it.file).push(it);
  }
  for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${items.length})`);
    for (const it of items.slice(0, 10)) console.log(`     L${String(it.L).padEnd(5)} ${it.prop}: ${it.color}`);
    if (items.length > 10) console.log(`     … 另 ${items.length - 10} 处`);
  }
  // 扣掉白名单额度（按文件），超出部分仍视为不通过
  let allowUsed = 0;
  for (const [file, quota] of Object.entries(ALLOW)) {
    const cnt = hard.filter(x => x.file === file).length;
    if (cnt > quota) fail(`${file} 硬写色 ${cnt} 处，超出白名单额度 ${quota}`);
    else if (cnt) allowUsed += cnt;
  }
  const unresolved = hard.filter(x => !(x.file in ALLOW));
  const changedFiles = [...new Set(hard.map(x => x.file))];
  console.log(`  白名单内核定无害：${allowUsed} 处（${Object.keys(ALLOW).length} 个文件）`);
  for (const [file, quota] of Object.entries(ALLOW)) {
    const cnt = hard.filter(x => x.file === file).length;
    console.log(`     ✔ ${file}  ${cnt}/${quota}`);
  }
  if (unresolved.length) fail(`硬写高危色 ${unresolved.length} 处未核定（涉及 ${[...new Set(unresolved.map(x => x.file))].length} 个文件）`);
  else ok(`无未核定的硬写高危色（白名单内 ${allowUsed} 处 / ${changedFiles.length} 个文件）`);
}

console.log(`\n=== ${bad} 项不通过（共 ${ghosts.length + hard.length} 处待处理） ===`);
process.exit(warnOnly ? 0 : bad > 0 ? 1 : 0);
