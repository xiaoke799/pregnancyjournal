/**
 * 构建后自动隔离「孤儿产物」—— 让 verify_ui_orphans 不再长期挂红灯。
 *
 * 【为什么要它】前端构建配置是 `emptyOutDir: false`（防止误清 app/ui 下手写的文件），
 * 副作用是每改一次代码、旧 hash 的 chunk/css 就**永久留在 assets/ 里**：
 * 不被加载、白白占体积、还会随 fpk 一起发出去。历史上堆过 245 个 / 27 MB。
 * ⇒ 每次手动清显然记不住，所以挂在 `npm run build` 末尾自动做。
 *
 * 【判据与 verify_ui_orphans.js 完全一致】从 `app/ui/index.html` 出发走引用链 BFS
 * （js/css 内部互相引用也算），assets/ 里不可达的即孤儿。
 * ⚠️ **只从 index.html 出发**：从 app/ui 下所有 html 出发的话，任何残留的调试 html
 *    （探针写的 _tmp_*.html）都会引用旧 hash，把孤儿全变成"可达"、检查静默失效。
 *
 * 【安全设计（fail-closed）】
 *  ① 移动前**反向验证**：待移文件的名字若出现在任何「保留文件」的内容里 ⇒ 直接中止并报错，
 *     不做任何移动。宁可让构建报错，也不能移走一个仍被引用的 chunk（那会白屏）。
 *  ② 只**移入隔离目录**（.trash/ui-assets-<时间戳>/），从不删除 —— 可随时还原。
 *  ③ 任何异常都不影响构建结果：把错误打出来，但不让构建失败（产物本身已生成好了）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const UI = path.join(ROOT, 'app', 'ui')
const ASSETS = path.join(UI, 'assets')

if (!fs.existsSync(ASSETS)) {
  console.log('[prune-ui] 没有 app/ui/assets，跳过')
  process.exit(0)
}

const indexHtml = path.join(UI, 'index.html')
if (!fs.existsSync(indexHtml)) {
  console.log('[prune-ui] 没有 app/ui/index.html，跳过（未构建？）')
  process.exit(0)
}

// ---------- 1) 从 index.html 出发走引用链 ----------
const REF_RE = /[A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2?)/g
const reachable = new Set()
const queue = ['index.html']
const contents = new Map() // 文件名 → 内容（供反向验证用）

while (queue.length) {
  const rel = queue.pop()
  if (reachable.has(rel)) continue
  const full = rel === 'index.html' ? indexHtml : path.join(ASSETS, rel)
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue
  reachable.add(rel)
  const text = fs.readFileSync(full, 'utf8')
  contents.set(rel, text)
  for (const m of text.matchAll(REF_RE)) {
    const cand = m[0]
    if (!reachable.has(cand) && fs.existsSync(path.join(ASSETS, cand))) queue.push(cand)
  }
}

// ---------- 2) 算孤儿 ----------
const all = fs.readdirSync(ASSETS).filter((f) => fs.statSync(path.join(ASSETS, f)).isFile())
const orphans = all.filter((f) => !reachable.has(f))
if (!orphans.length) {
  console.log(`[prune-ui] ✅ ${all.length} 个产物全部可达，无孤儿`)
  process.exit(0)
}

// ---------- 3) fail-closed 反向验证：待移文件不允许被任何保留文件引用 ----------
const keptText = [...contents.values()].join('\n')
const dangerous = orphans.filter((f) => keptText.includes(f))
if (dangerous.length) {
  console.error('[prune-ui] ❌ 中止：以下文件被判为孤儿，但仍被「保留文件」引用：')
  for (const f of dangerous) console.error('    ' + f)
  console.error('  这说明引用链遍历有问题，**不要**用强制手段绕过；请检查本脚本的正则与 index.html。')
  process.exit(1)
}

// ---------- 4) 移入隔离目录 ----------
const d = new Date()
const p2 = (n) => String(n).padStart(2, '0')
// 本地时间戳（与项目其它地方一致：不要用 toISOString，那是 UTC，凌晨会落到前一天）
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
const trashDir = path.join(ROOT, '.trash', `ui-assets-${stamp}`)
fs.mkdirSync(trashDir, { recursive: true })

let bytes = 0
const moved = []
for (const f of orphans) {
  const from = path.join(ASSETS, f)
  bytes += fs.statSync(from).size
  fs.renameSync(from, path.join(trashDir, f))
  moved.push(f)
}

console.log(`[prune-ui] 🧹 移出 ${moved.length} 个孤儿产物（${(bytes / 1024).toFixed(0)} KB）`)
console.log(`           隔离目录：.trash/ui-assets-${stamp}/（可还原；确认无用后再自行清空）`)
console.log(`           保留 ${all.length - moved.length} 个可达产物`)
