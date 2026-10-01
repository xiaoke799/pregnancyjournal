/** 检查 app/ui 构建产物里的孤儿文件（只报告，不删除）。
 *
 * 【为什么必须有它】
 * 前端构建配置 emptyOutDir:false（防误清 app/ui 下手工文件），副作用是
 * 改动后旧 hash 的 chunk/css 会**永久残留**在 assets/ 里——不被加载、
 * 纯占体积，打包时还会被带上（2026-09-29 实测堆积 245 个 / 27.4MB，
 * 且含已废弃文案，复查违禁词时险些漏网）。
 *
 * 做法：从 index.html 出发 BFS 引用链（js/css 内部互相引用也算），
 * assets/ 里不可达的文件即孤儿。
 *
 * ⚠️ **只能从 index.html 出发**（2026-09-30 修）：以前是「从 app/ui 下所有 *.html 出发」，
 *    调试脚本往 app/ui 里写的临时 html（如探针的 `_tmp_dashcover_*.html`）会**引用旧 hash 的
 *    chunk** ⇒ 那些本该是孤儿的文件全被算成"可达"，检查静默失效、还把它们当正常产物。
 *    ⇒ 现在：① 只从 index.html 走；② app/ui 里出现 index.html 之外的 html 一律判红
 *    （它们会随 fpk 一起发出去）。
 *
 * 用法：node tools/verify/verify_ui_orphans.js
 * 退出码：有孤儿 = 1（提醒清理），无孤儿 = 0。
 * 清理方式：移入隔离目录（如 .trash/ 下），不要直接删。
 */
const fs = require('fs');
const path = require('path');

const UI = path.resolve(__dirname, '../../app/ui');
const ASSETS = path.join(UI, 'assets');

const assets = new Set(fs.readdirSync(ASSETS));
const reachable = new Set();
// 只认 index.html；其余根级 html 视为**不该存在的调试产物**
const rootHtml = fs.readdirSync(UI).filter((f) => f.endsWith('.html'));
const strays = rootHtml.filter((f) => f !== 'index.html');
const queue = rootHtml.filter((f) => f === 'index.html');

while (queue.length) {
  const f = queue.pop();
  if (reachable.has(f)) continue;
  const full = path.join(UI, f);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
  reachable.add(f);
  const content = fs.readFileSync(full, 'utf8');
  for (const name of content.matchAll(/[A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2?)/g)) {
    const cand = path.join('assets', name[0]);
    if (fs.existsSync(path.join(UI, cand)) && !reachable.has(cand)) queue.push(cand);
  }
}

const orphans = [...assets].filter((a) => !reachable.has(path.join('assets', a)));
const reachableCount = assets.size - orphans.length;
const fails = orphans.length + strays.length;
if (strays.length) {
  console.log(`⚠️ app/ui 根目录有 ${strays.length} 个「index.html 之外」的 html（调试产物，会随包发出）：`);
  for (const s of strays) console.log('  ' + s);
  if (!orphans.length) console.log('  ⚠️ 注意：这些文件会让"孤儿"判定失真 —— 它们引用的旧 chunk 会被当成可达。');
}
if (fails === 0) {
  console.log(`✅ ${reachableCount} 个产物文件全部可达（无孤儿）`);
  console.log('==================================================');
  console.log(`结果：${reachableCount} 通过 / 0 失败`);
  console.log('==================================================');
  process.exit(0);
}

if (orphans.length) {
  const kb = orphans.reduce((s, a) => s + fs.statSync(path.join(ASSETS, a)).size, 0) / 1024;
  console.log(`⚠️ UI 产物有 ${orphans.length} 个孤儿文件，共 ${kb.toFixed(0)} KB（不被加载但会随包发出）：`);
  for (const a of orphans.slice(0, 20)) console.log('  ' + a);
  if (orphans.length > 20) console.log(`  … 共 ${orphans.length} 个`);
}
console.log('清理方式：移入隔离目录（如 .trash/ 下），跑回归确认后再清空');
console.log('==================================================');
console.log(`结果：${reachableCount} 通过 / ${fails} 失败`);
console.log('==================================================');
process.exit(1);
