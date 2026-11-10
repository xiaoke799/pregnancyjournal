#!/usr/bin/env node
/**
 * tools/verify/install_hooks.js —— 把「提交前闸门」装进 .git/hooks（可选）
 *
 * 【为什么默认不装】
 *   这个仓库多会话并行是常态。pre-commit 一旦装上，另一个会话正常提交也会被拦，
 *   容易让人以为是"钩子坏了"，进而 `--no-verify` 变成肌肉记忆 —— 那比不装更糟。
 *   所以：**你自己决定装不装**，装了就在本机有物理闸门，不装就靠 `node tools/verify/gate.js` 手动跑。
 *
 * 用法：
 *   node tools/verify/install_hooks.js            # 安装 pre-commit
 *   node tools/verify/install_hooks.js --uninstall
 *   node tools/verify/install_hooks.js --show     # 只看现在装的是什么
 *
 * 跳过：`git commit --no-verify`（跳过时请按 docs/review-protocol.md 写 not-run 理由）
 */
const fs = require('fs');
const path = require('path');
const ENV = require('./_env');

const HOOK = path.join(ENV.REPO, '.git', 'hooks', 'pre-commit');
const BACKUP = HOOK + '.bak';
const argv = process.argv.slice(2);

const SCRIPT = `#!/bin/sh
# 由 tools/verify/install_hooks.js 生成（2026-11-10）
# 只跑与本次暂存改动相关的套件；红则拦下提交。
# 跳过：git commit --no-verify —— 跳过时请在提交信息里写真名 not-run 理由。
cd "$(git rev-parse --show-toplevel)" || exit 1
exec node tools/verify/gate.js --staged
`;

function show() {
  if (!fs.existsSync(HOOK)) {
    console.log('当前未安装 pre-commit 钩子。');
    return;
  }
  console.log(`已安装：${path.relative(ENV.REPO, HOOK)}\n`);
  console.log(fs.readFileSync(HOOK, 'utf8'));
}

if (argv.includes('--show')) {
  show();
  process.exit(0);
}

if (argv.includes('--uninstall')) {
  if (!fs.existsSync(HOOK)) {
    console.log('本来就没装。');
    process.exit(0);
  }
  fs.unlinkSync(HOOK);
  console.log('已删除 pre-commit 钩子。');
  if (fs.existsSync(BACKUP)) {
    fs.renameSync(BACKUP, HOOK);
    console.log('已把备份的旧钩子还原回来。');
  }
  process.exit(0);
}

if (!fs.existsSync(path.dirname(HOOK))) {
  console.error(`✗ 找不到 .git/hooks 目录：${path.dirname(HOOK)}`);
  process.exit(2);
}

if (fs.existsSync(HOOK)) {
  const old = fs.readFileSync(HOOK, 'utf8');
  if (old.includes('tools/verify/gate.js')) {
    console.log('已经装过了（内容一致），不重复写。');
    process.exit(0);
  }
  fs.copyFileSync(HOOK, BACKUP);
  console.log(`原有钩子已备份到 ${path.relative(ENV.REPO, BACKUP)}`);
}

fs.writeFileSync(HOOK, SCRIPT, { mode: 0o755 });
try { fs.chmodSync(HOOK, 0o755); } catch (e) { /* Windows 上无效但无害 */ }
console.log(`✅ 已安装 ${path.relative(ENV.REPO, HOOK)}`);
console.log('   提交时会自动跑与改动相关的套件。跳过用 --no-verify（记得写 not-run 理由）。');
console.log('   卸载：node tools/verify/install_hooks.js --uninstall');
