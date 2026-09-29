/**
 * tools/verify/_env.js —— 回归/核查脚本的**运行环境唯一出处**。
 *
 * 为什么要有这个文件：
 *   这套脚本原先散在一个本地私有工作目录里（不入库），且每个脚本顶部都硬编码了
 *   仓库根的绝对路径、node.exe 的绝对路径、某个特定 git-bash 的绝对路径 ——
 *   换机器 / 换目录 clone 下来一个都跑不起来，等于「验证能力只存在于作者本机」。
 *
 * 现在所有与本机相关的常量都从本文件取；脚本只 `require('./_env')`。
 * 需要临时覆盖时用环境变量：PJ_VERIFY_TMP / PJ_NODE / PJ_BASH / PJ_GIT。
 */
const path = require('path');
const fs = require('fs');

/** tools/verify 本身 */
const VERIFY_DIR = __dirname;
/** 仓库根 —— tools/verify 往上两级。不依赖 cwd，也不写死盘符。 */
const REPO = path.resolve(VERIFY_DIR, '..', '..');

/** 后端（被测对象） */
const SERVER_DIR = path.join(REPO, 'app/server/node');
const SERVER_ENTRY = path.join(SERVER_DIR, 'server.js');
const NODE_MODULES = path.join(SERVER_DIR, 'node_modules');
/** 前端构建产物（server 的 STATIC_DIR 指向它） */
const UI_DIR = path.join(REPO, 'app/ui');

/** 测试夹具（已随仓库入库，见 fixtures/README） */
const FIXTURES = path.join(VERIFY_DIR, 'fixtures');
const HEIC_DIR = path.join(FIXTURES, 'heic-test');

/** 运行期临时产物：默认落在 tools/verify/.tmp（已 gitignore，不进包） */
const TMP = process.env.PJ_VERIFY_TMP || path.join(VERIFY_DIR, '.tmp');

/** 跑子进程用的 node —— 默认用当前进程的可执行文件，**绝不硬编码本机路径** */
const NODE = process.env.PJ_NODE || process.execPath;

/** git —— 优先环境变量，其次 PATH 上的 git（交给 spawn 解析），最后常见安装位置 */
const GIT = process.env.PJ_GIT || 'git';

/** 按候选列表探测一个可用的可执行文件，找不到返回 null（调用方自行降级） */
function which(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (c === 'git' || c === 'bash') return c; // 裸命令名交给 spawn 走 PATH
      if (fs.existsSync(c)) return c;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * bash —— 供 t17 跑「假 curl」的片段用。
 *
 * ⚠️ 必须用 `usr/bin/bash.exe`，**不要用 `bin/bash.exe`**：
 *   Git for Windows 的 `bin/bash.exe` 是个启动器，PATH 挂载与 MSYS 路径转换行为不同，
 *   会导致片段里 prepend 的假 curl 目录找不到 —— 表现为 t17 直接掉成 7 通过 / 9 失败
 *   （而子进程本身能起来，所以不会报 spawn 错误，极易误判成"测试本身有问题"）。
 */
const BASH = which([
  process.env.PJ_BASH,
  'C:/Program Files/Git/usr/bin/bash.exe',
  'C:/Program Files (x86)/Git/usr/bin/bash.exe',
  '/usr/bin/bash',
  '/bin/bash',
  'bash',
]);

module.exports = {
  REPO,
  VERIFY_DIR,
  SERVER_DIR,
  SERVER_ENTRY,
  NODE_MODULES,
  UI_DIR,
  FIXTURES,
  HEIC_DIR,
  TMP,
  NODE,
  GIT,
  BASH,
  which,
};
