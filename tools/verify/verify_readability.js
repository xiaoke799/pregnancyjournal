/**
 * 可读性收口核查（v0.0.31）
 *
 * 守的是「重复收敛」这件事有没有做干净，以及最致命的一类问题：
 * **用了某个共享符号却没导入它** —— 这个在 .vue 模板里不会构建报错，
 * 只有运行时渲染该组件才会炸（表现为整块白/控制台报 xxx is not defined）。
 *
 * 覆盖：
 *   A. 心情 emoji 映射全仓只有一处定义（utils/format.ts）
 *   B. 所有用到它的文件都确实 import 了
 *   C. 心情选项数组不再有多份重复定义
 *   D. 后端 MIME 映射全仓只有一处定义（services/media-types.js）
 *   E. photo.js / checkup.js 都正确 require 了它
 *
 * 用法：node tools/verify/verify_readability.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../frontend/src');
const NODE_DIR = path.resolve(__dirname, '../../app/server/node');

let pass = 0;
let fail = 0;
function ok(n, e) { pass++; console.log(`  ✅ ${n}${e ? '  ' + e : ''}`); }
function ng(n, e) { fail++; console.log(`  ❌ ${n}${e ? '  ' + e : ''}`); }
function assert(c, n, e) { c ? ok(n, e) : ng(n, e); }

/** 递归收集源码文件 */
function walk(dir, exts, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(path.resolve(__dirname, '../..'), p).replace(/\\/g, '/');

/**
 * 剥掉注释后再做文本断言。
 *
 * ⚠️ 这不是洁癖，是踩过三次的坑：注释里为了讲清「为什么不用 X」会写出 X 的名字，
 *    带着注释匹配就会命中注释里的字样，把正确的代码判成错误（假红）。
 *    凡是「读源码 + 匹配标识符」的核查脚本都必须先做这一步。
 */
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')   // .vue 模板注释
  .replace(/\/\*[\s\S]*?\*\//g, '')  // 块注释
  .replace(/\/\/[^\n]*/g, '');       // 行注释

// ============ A. emoji 映射唯一 ============
console.log('A. 心情 emoji 映射的唯一性');
const feFiles = walk(SRC, ['.vue', '.ts']);
const EMOJI_DEF = /['"]😢['"]\s*,\s*['"]😔['"]/;
const defs = feFiles.filter((f) => EMOJI_DEF.test(fs.readFileSync(f, 'utf8')));
assert(defs.length === 1, 'emoji 序列只在 1 个文件里定义', `(实际 ${defs.length}: ${defs.map(rel).join(', ') || '无'})`);
assert(defs.length === 1 && defs[0].endsWith('utils\\format.ts'), '这一处就是 utils/format.ts');

// ============ B. 用到的人都导入了 ============
console.log('\nB. 共享符号都被正确导入');
const FORMAT_SYMBOLS = ['moodEmojiOf', 'MOOD_EMOJIS', 'MOOD_OPTIONS', 'getMoodEmoji', 'moodOptions'];
const importProblems = [];
for (const f of feFiles) {
  // ⚠️ 先剥注释：注释里会写「不直接复用 MOOD_OPTIONS」这类说明，
  //    不剥的话会把注释里的字样当成真实引用（假红）。
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  if (f.endsWith('utils\\format.ts') || f.endsWith('utils/format.ts')) continue;
  // 取出该文件从 @/utils/format 导入的**具名列表**（形如 "getMoodEmoji as moodEmojiOf, MOOD_OPTIONS as moodOptions"）
  const m = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]@\/utils\/format['"]/);
  const spec = m ? m[1] : '';
  for (const name of FORMAT_SYMBOLS) {
    if (!new RegExp(`\\b${name}\\b`).test(src)) continue;            // 本文件没用到这个符号
    // 本文件自己定义的（同名本地函数/常量），不算缺导入
    if (new RegExp(`(function|const|let)\\s+${name}\\b`).test(src)) continue;
    if (!new RegExp(`\\b${name}\\b`).test(spec)) {
      importProblems.push(`${rel(f)} 用了 ${name} 但没导入`);
    }
  }
}
assert(importProblems.length === 0, '用到的每个共享符号都确实被导入（含别名）',
  importProblems.length ? `\n     ${importProblems.join('\n     ')}` : '');

// 逐个符号细查：把 MOOD_OPTIONS 当 moodOptions 用的文件，必须同时导入该别名
const aliasProblems = [];
for (const f of feFiles) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.includes('utils') && f.endsWith('format.ts')) continue;
  if (/\bmoodOptions\b/.test(src) && !/MOOD_OPTIONS\s+as\s+moodOptions/.test(src)) {
    // 也可能是本文件自己又定义了一份（那就是重复，第 C 条会抓）
    if (!/const\s+moodOptions\s*=/.test(src)) aliasProblems.push(rel(f));
  }
}
assert(aliasProblems.length === 0, '用 moodOptions 的地方要么导入了别名、要么自己定义',
  aliasProblems.length ? `(${aliasProblems.join(', ')})` : '');

// ============ C. 选项数组不再重复 ============
console.log('\nC. 心情选项数组不再重复定义');
// 「很差 + 不好 + 一般」三连是这套选项数组的指纹
const OPTION_FINGERPRINT = /label:\s*['"]很差['"][\s\S]{0,200}?label:\s*['"]不好['"]/;
const optDefs = feFiles.filter((f) => OPTION_FINGERPRINT.test(fs.readFileSync(f, 'utf8')));
assert(optDefs.length === 1, '「很差/不好/…」这套选项只定义 1 次',
  `(实际 ${optDefs.length}: ${optDefs.map(rel).join(', ') || '无'})`);
assert(optDefs.length === 1 && optDefs[0].endsWith('utils\\format.ts'), '这一处是 utils/format.ts');

// ============ D. 后端 MIME 映射唯一 ============
console.log('\nD. 后端 MIME 映射的唯一性');
const beFiles = walk(NODE_DIR, ['.js']).filter((f) => !f.includes('node_modules'));
const MIME_FINGERPRINT = /['"]\.mp4['"]\s*:\s*['"]video\/mp4['"]|['"]\.jpe['"]\s*:\s*['"]image\/jpeg['"]/;
const mimeDefs = beFiles.filter((f) => MIME_FINGERPRINT.test(fs.readFileSync(f, 'utf8')));
assert(mimeDefs.length === 1, 'MIME 映射只在一个文件里定义',
  `(实际 ${mimeDefs.length}: ${mimeDefs.map(rel).join(', ') || '无'})`);
assert(mimeDefs.length === 1 && mimeDefs[0].includes('media-types.js'), '这一处是 services/media-types.js');

// ============ E. 引用方都 require 了 ============
console.log('\nE. MIME 共享模块被正确引用');
const mimeUsers = [];
for (const f of beFiles) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.includes('media-types.js')) continue;
  if (/\bmimeOf\s*\(|\bMIME_BY_EXT\b/.test(src)) {
    const required = /require\(['"][^'"]*media-types['"]\)/.test(src);
    mimeUsers.push({ file: rel(f), required });
    // 顺带确认没有残留的内联 mimeMap
    if (/const\s+mimeMap\s*=\s*\{/.test(src)) {
      ng(`${rel(f)} 仍残留内联 mimeMap 定义`);
    }
  }
}
assert(mimeUsers.length >= 2, `有 ≥2 个文件使用了共享 MIME 模块`, `(${mimeUsers.map((m) => path.basename(m.file)).join(', ')})`);
for (const m of mimeUsers) {
  assert(m.required, `${m.file} 已 require media-types`);
}

// ============ F. 废弃文件已移走 ============
console.log('\nF. 废弃文件清理');
assert(!fs.existsSync(path.join(SRC, 'api/wecom.ts')), '已废弃的 api/wecom.ts 不在源码树里');

// ============ G. MIME 模块行为正确（合并后不能丢格式） ============
console.log('\nG. MIME 模块行为');
const { mimeOf, MIME_BY_EXT } = require(path.join(NODE_DIR, 'services/media-types.js'));
const cases = [
  ['a.jpg', 'image/jpeg'], ['a.JPEG', 'image/jpeg'], ['a.jpe', 'image/jpeg'], ['a.jfif', 'image/jpeg'],
  ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.heic', 'image/heic'], ['a.avif', 'image/avif'],
  ['a.tiff', 'image/tiff'], ['a.pdf', 'application/pdf'],
  ['a.mp4', 'video/mp4'], ['a.mov', 'video/quicktime'], ['a.mkv', 'video/x-matroska'],
  ['a.avi', 'video/x-msvideo'], ['a.rmvb', 'application/vnd.rn-realmedia-vbr'],
];
const bad = cases.filter(([file, want]) => mimeOf(file) !== want);
assert(bad.length === 0, `合并后的映射覆盖 ${cases.length} 种常见格式且大小写无关`,
  bad.length ? `(不符: ${bad.map((b) => `${b[0]}→${mimeOf(b[0])}`).join(', ')})` : '');
assert(mimeOf('a.unknownext') === null, '认不出的扩展名返回 null（由调用方决定兜底）');
assert(mimeOf('') === null && mimeOf(null) === null, '空值安全');
// 各接口的兜底值必须还在（合并映射时最容易把兜底一起弄丢）
const photoSrc = fs.readFileSync(path.join(NODE_DIR, 'routes/photo.js'), 'utf8');
assert(/'application\/octet-stream'/.test(photoSrc), 'photo.js 原图兜底仍是 octet-stream');
assert(/'image\/jpeg'/.test(photoSrc), 'photo.js 缩略图兜底仍是 image/jpeg');
const checkupSrc = fs.readFileSync(path.join(NODE_DIR, 'routes/checkup.js'), 'utf8');
assert(/'application\/octet-stream'/.test(checkupSrc), 'checkup.js 报告兜底仍是 octet-stream');
assert(MIME_BY_EXT['.pdf'] === 'application/pdf', 'checkup 依赖的 .pdf 映射还在');

console.log(`\n${'='.repeat(50)}`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
