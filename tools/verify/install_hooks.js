#!/usr/bin/env node
/**
 * tools/verify/install_hooks.js —— 装本地 git 钩子（可选）
 *
 * 装两个：
 *   pre-commit  → 敏感信息扫描（暂存区）+ 闸门（按改动选套件）
 *   pre-push    → 敏感信息扫描（远端还没有的提交）← **这道才是防"上云"的关键**
 *
 * 为什么 pre-push 才是关键：
 *   pre-commit 只保证"不写进本地提交"，而真正的暴露发生在 push 那一下。
 *   有人 --no-verify 提交、改了历史、或者直接 push --no-verify，pre-commit 都拦不住；
 *   pre-push 拦的是"离开这台机器之前的最后一刻"。
 *
 * 【为什么默认不装】
 *   这个仓库多会话并行是常态。钩子一旦装上，另一个会话正常提交也会被拦，
 *   容易让人以为是"钩子坏了"，进而 --no-verify 变成肌肉记忆 —— 那比不装更糟。
 *   所以：**你自己决定装不装**。
 *
 * 用法：
 *   node tools/verify/install_hooks.js              # 装 pre-commit + pre-push
 *   node tools/verify/install_hooks.js --push-only  # 只装 pre-push（最省事）
 *   node tools/verify/install_hooks.js --uninstall
 *   node tools/verify/install_hooks.js --show
 *
 * 跳过：`git commit --no-verify` / `git push --no-verify`（跳过时请按 docs/review-protocol.md 写 not-run 理由）
 */
const fs = require('fs');
const path = require('path');
const ENV = require('./_env');

const HOOKS_DIR = path.join(ENV.REPO, '.git', 'hooks');
const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);

const MARK = '# 由 tools/verify/install_hooks.js 生成';

const NODE_GUARD = `if ! command -v node >/dev/null 2>&1; then
  echo "" >&2
  echo "  [hook] 找不到 node —— 无法做敏感信息扫描，拒绝继续。" >&2
  echo "         临时跳过：加上 --no-verify（并请在提交信息/PR 里写明原因）" >&2
  exit 1
fi`;

const PRE_COMMIT = `#!/bin/sh
${MARK}（2026-11-10）
# 敏感信息扫描（暂存区）+ 按改动选套件。
# 跳过：git commit --no-verify
cd "$(git rev-parse --show-toplevel)" || exit 1
${NODE_GUARD}
node tools/verify/scan_secrets.js --staged || {
  echo "" >&2
  echo "  [pre-commit] 暂存区里有敏感信息，已拦下。" >&2
  echo "  确属误报就在那一行加 pj-secret-ok 注释（写明理由）。" >&2
  exit 1
}
exec node tools/verify/gate.js --staged
`;

const PRE_PUSH = `#!/bin/sh
${MARK}（2026-11-10）
# 🔴 防"密钥上云"的最后一道：扫远端还没有的提交。
# 跳过：git push --no-verify
cd "$(git rev-parse --show-toplevel)" || exit 1
${NODE_GUARD}
exec node tools/verify/scan_secrets.js --push
`;

const HOOKS = { 'pre-commit': PRE_COMMIT, 'pre-push': PRE_PUSH };

function show() {
  let any = false;
  for (const name of Object.keys(HOOKS)) {
    const p = path.join(HOOKS_DIR, name);
    if (!fs.existsSync(p)) continue;
    any = true;
    const body = fs.readFileSync(p, 'utf8');
    console.log(`\n── ${name}（${body.includes(MARK) ? '本工具装的' : '⚠️ 外部/手工安装'}）`);
    console.log(body);
  }
  if (!any) console.log('当前未安装任何钩子。');
}

if (has('show')) { show(); process.exit(0); }

if (!fs.existsSync(HOOKS_DIR)) {
  console.error(`✗ 找不到 ${HOOKS_DIR}`);
  process.exit(2);
}

const targets = has('push-only') ? ['pre-push'] : Object.keys(HOOKS);

if (has('uninstall')) {
  for (const name of Object.keys(HOOKS)) {
    const p = path.join(HOOKS_DIR, name);
    const bak = p + '.bak';
    if (!fs.existsSync(p)) continue;
    if (!fs.readFileSync(p, 'utf8').includes(MARK)) {
      console.log(`  跳过 ${name}（不是本工具装的，未动）`);
      continue;
    }
    fs.unlinkSync(p);
    console.log(`  已删除 ${name}`);
    if (fs.existsSync(bak)) { fs.renameSync(bak, p); console.log(`  已还原 ${name}.bak`); }
  }
  process.exit(0);
}

for (const name of targets) {
  const p = path.join(HOOKS_DIR, name);
  if (fs.existsSync(p)) {
    const old = fs.readFileSync(p, 'utf8');
    if (old.includes(MARK)) {
      fs.writeFileSync(p, HOOKS[name], { mode: 0o755 });
      console.log(`  ↻ 已更新 ${name}`);
      continue;
    }
    fs.copyFileSync(p, p + '.bak');
    console.log(`  原有 ${name} 已备份为 ${name}.bak`);
  }
  fs.writeFileSync(p, HOOKS[name], { mode: 0o755 });
  try { fs.chmodSync(p, 0o755); } catch (e) { /* Windows 上无效但无害 */ }
  console.log(`  ✓ 已安装 ${name}`);
}

console.log(`
装的钩子：
  pre-commit → 敏感信息扫描（暂存区）+ 闸门
  pre-push   → 敏感信息扫描（远端还没有的提交）← 防上云的关键

跳过用 --no-verify，但跳过时请写明理由（docs/review-protocol.md §五）。
卸载：node tools/verify/install_hooks.js --uninstall
`);
