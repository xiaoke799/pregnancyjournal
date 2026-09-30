/**
 * 前端类型体检：把 `vue-tsc --noEmit` 收进回归。
 *
 * 【为什么必须有它】
 * 清理前仓库里**常驻 15 个 vue-tsc 错误**（axios 响应拦截器把 AxiosResponse 换成
 * ApiResponse，与 axios 自带类型冲突），根因是 client.ts 没有对外暴露「解包后」的
 * 调用签名。常驻错误的真正代价不是「有 15 个红」，而是**新增的真错误会淹没在噪音里，
 * 没人再看这一栏** —— 等于类型检查事实上失效。
 * 那次清零之后，如果没有套件守住，下一次改前端又会悄悄攒回来。
 * 「类型检查是绿的」必须是一条**可回归的断言**，而不是某个人的一次性动作。
 *
 * 【判定口径】
 *  - 通过 = `vue-tsc --noEmit` 退出码 0 **且** 输出里 `error TS####` 行数为 0（二者都必须成立）。
 *  - **失败关闭（fail-closed）**：若前端没 `npm install`（找不到 vue-tsc 入口）、
 *    进程起不来、或超时，一律判**失败**并写明原因。工具链缺失 ≠「类型没问题」，
 *    这种情况下报"通过"就是假绿（铁律 #11：一个从不失败的检查 = 安慰剂）。
 *  - 汇总行固定为 1 项（`合计: 1 通过 / 0 失败`）。这样运行器的「套数 / 项数」是**确定的**，
 *    不会因为 TS 错误条数变化而让文档绊线上下乱跳（错误明细打在汇总行之前）。
 *
 * 【本机坑】沙箱下 `spawnSync(<任意 exe>)` 恒 EBUSY ⇒ 必须用异步 spawn（同运行器的注释）。
 *
 * 用法：node tools/verify/verify_frontend_types.js
 * 覆盖入口：PJ_VUE_TSC=<vue-tsc 的 .js 入口>（换机器 / 入口路径变动 / 做反例验证时用）
 * 退出码：0 = 类型干净；1 = 有错误 或 工具链不可用。
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ENV = require('./_env');

const FRONTEND = path.join(ENV.REPO, 'frontend');

/**
 * vue-tsc 入口。可用 PJ_VUE_TSC 覆盖（换机器 / 入口变动 / 做反例验证）。
 * ⚠️ 相对路径必须**锚定到仓库根**：本脚本可能被运行器以 cwd=app/server/node 启动，
 *    而子进程的 cwd 又被设成 frontend/ —— 依赖 cwd 解析会指向 frontend/tools/verify/...
 *    表现为 `MODULE_NOT_FOUND`（红是红了，但红在错误的原因上，反例等于没验成）。
 */
function resolveTsc() {
  const raw = process.env.PJ_VUE_TSC;
  if (!raw) return path.join(FRONTEND, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js');
  if (path.isAbsolute(raw)) return raw;
  const fromRepo = path.resolve(ENV.REPO, raw);
  if (fs.existsSync(fromRepo)) return fromRepo;
  return path.resolve(process.cwd(), raw);
}
const TSC = resolveTsc();
const TIMEOUT_MS = 240000;
const RE_ERR = /error TS\d+/;

function verdict(pass, lines) {
  console.log(lines.join('\n'));
  console.log('==================================================');
  console.log(`前端类型检查：${pass ? '干净（0 处 error TS）' : '不通过'}`);
  console.log(`合计: ${pass ? 1 : 0} 通过 / ${pass ? 0 : 1} 失败`);
  console.log('==================================================');
  process.exit(pass ? 0 : 1);
}

function fail(reason, extra) {
  const lines = [`🔴 前端类型检查无法完成：${reason}`];
  if (extra) for (const l of extra) lines.push('   ' + l);
  lines.push('');
  lines.push('排查建议：');
  lines.push('  1) 前端依赖是否装好：cd frontend && npm install（vue-tsc 在 devDependencies）');
  lines.push('  2) 手工复跑看原始输出：cd frontend && npx vue-tsc --noEmit');
  lines.push('  3) 入口路径被改动时用 PJ_VUE_TSC=<vue-tsc 的 .js 入口> 覆盖');
  verdict(false, lines);
}

if (!fs.existsSync(FRONTEND)) fail(`仓库里找不到 frontend/ 目录（${FRONTEND}）`);
if (!fs.existsSync(path.join(FRONTEND, 'tsconfig.json'))) fail('frontend/tsconfig.json 不存在');
if (!fs.existsSync(TSC)) fail(`找不到 vue-tsc 入口（${TSC}）`);

const env = { ...process.env };
delete env.NODE_OPTIONS; // 与运行器一致：外部注入的 NODE_OPTIONS 会干扰子进程
const t0 = Date.now();
const child = spawn(ENV.NODE, [TSC, '--noEmit', '--pretty', 'false'], {
  cwd: FRONTEND, env, stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch (e) { /* ignore */ } }, TIMEOUT_MS);
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
child.on('error', (e) => {
  clearTimeout(timer);
  fail(`无法启动 vue-tsc（${e.message}）`);
});
child.on('close', (code) => {
  clearTimeout(timer);
  if (timedOut) fail(`vue-tsc 超时（> ${TIMEOUT_MS / 1000}s）`);

  const secs = Math.round((Date.now() - t0) / 1000);
  const errLines = out.split('\n').filter((l) => RE_ERR.test(l));
  const lines = [
    `vue-tsc --noEmit  ·  ${FRONTEND}`,
    `耗时 ${secs}s，退出码 ${code}，error TS 行数 ${errLines.length}`,
  ];

  if (code === 0 && errLines.length === 0) {
    // 反例口径：往 src 里塞一行 `const n: number = 'x'` 必须让本套件变红（见 README「反例」）。
    lines.push('✅ 全项目类型干净（.ts / .vue 模板 / .d.ts 全部通过）');
    return verdict(true, lines);
  }

  lines.push('');
  lines.push(`🔴 前端类型有 ${errLines.length} 处错误（最多列 15 行，完整输出见 regress-out/verify_frontend_types.log）：`);
  if (errLines.length) {
    for (const l of errLines.slice(0, 15)) lines.push('   ' + l.trim());
    if (errLines.length > 15) lines.push(`   … 共 ${errLines.length} 处`);
  } else {
    lines.push('   （退出码非 0 但没识别到 error TS 行，原始输出尾部如下）');
    for (const l of out.split('\n').filter((x) => x.trim()).slice(-8)) lines.push('   ' + l.trim());
  }
  verdict(false, lines);
});
