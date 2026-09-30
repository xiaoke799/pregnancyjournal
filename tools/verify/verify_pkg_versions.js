/**
 * package.json / package-lock.json 的版本号必须与 manifest 同步（发版闸门）
 *
 * 【为什么需要它】
 * 发版要同步的版本号一共 **8 处**，其中 5 处已被 `build.ps1` Step1 强制：
 *   manifest(version + sub_version + changelog)、config.js 的 APP_VERSION、build.ps1 的 `$Version`、
 *   CHANGELOG.md、README.md（徽章 + 下载文件名）。
 * 剩下 **3 处「无人管」**（闸门没查、也没有回归）：
 *   ① `frontend/package.json` ② `app/server/node/package.json`
 *   ③ `app/server/node/package-lock.json` —— 它自己就有 **两处**自指版本（顶层 `version` 与 `packages[""].version`）
 * v0.0.31 之前是靠一次性脚本 `vercheck.js` **人工**跑的 ⇒ 人一忘就漏，且没有回归护栏。
 * 这三处对开源使用者直接可见（npm 包的 version、lock 里的自指版本），漏同步就是「新号旧货」的另一面。
 *
 * 【口径】
 * - **`manifest` 是唯一真源**，本脚本只读它，不读 build.ps1 的 `$Version`（那是副本，由 PS 侧自己校验）。
 * - 判定逻辑放在 node 而不是 PowerShell：本机 PowerShell 无法执行脚本（工具输出恒空、
 *   bash 调 powershell.exe 被安全策略拦），写进 build.ps1 的断言**没法验证**；
 *   放 node 里既可被 build.ps1 直接调用，也能作为回归套件天天跑。
 * - 🔴 **fail-closed**：文件缺失 / JSON 解析失败 / lock 里没有 `packages[""]` 一律**判红**，
 *   不报「跳过」。核验不到 ≠ 没问题。
 *
 * 【反例自检】
 * 末尾会把 4 个文件复制到临时目录、故意把其中一处的版本改错，再跑同一个判定函数，
 * 要求它**必须变红**。否则本套件就是"永远绿"的假护栏（铁律 #11）。
 *
 * 用法：
 *   node tools/verify/verify_pkg_versions.js            # 校验仓库（回归用）
 *   PJ_PKG_ROOT=<dir> node tools/verify/verify_pkg_versions.js   # 校验别的根（build.ps1 用）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = process.env.PJ_PKG_ROOT
  ? path.resolve(process.env.PJ_PKG_ROOT)
  : path.resolve(__dirname, '..', '..');

/** 要从 manifest 里取的两个字段（唯一真源） */
function readManifest(root) {
  const p = path.join(root, 'manifest');
  if (!fs.existsSync(p)) return { error: `缺少 manifest（${p}）` };
  const txt = fs.readFileSync(p, 'utf-8');
  const pick = (k) => {
    const m = txt.match(new RegExp(`^\\s*${k}\\s*=\\s*([0-9][0-9.]*)\\s*$`, 'm'));
    return m ? m[1] : '';
  };
  return { version: pick('version'), subVersion: pick('sub_version') };
}

/** 读一个 JSON 文件里的某个版本字段；解析失败抛错（由调用方转成判红） */
function jsonVersion(root, rel, pick) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) throw new Error(`缺少 ${rel}`);
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    throw new Error(`${rel} 不是合法 JSON：${e.message}`);
  }
  const v = pick(obj);
  if (v === undefined || v === null || v === '') throw new Error(`${rel} 里取不到版本号`);
  return String(v);
}

/**
 * 纯函数：给定一个仓库根，返回逐项判定结果。
 * 抽成函数是为了**反例自检**能复用同一份判定（避免"验的是另一套逻辑"）。
 */
function checkVersionSync(root) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const man = readManifest(root);
  if (man.error) {
    add('manifest 可读', false, man.error);
    return { checks, version: '' };
  }
  add('manifest 可读', true, `version=${man.version} sub_version=${man.subVersion}`);
  if (!man.version) return { checks, version: '' };

  // sub_version 必须 3 段式（上架无效的坑：v0.0.30 首发包写成 4 段式）
  add('manifest sub_version 是 3 段式', (man.subVersion || '').split('.').length === 3,
    `sub_version=${man.subVersion}`);
  // 本脚本只对这三个文件负责；manifest 自身的一致性由 build.ps1 把关
  const expect = man.version;

  // ① frontend/package.json
  try {
    const v = jsonVersion(root, 'frontend/package.json', (o) => o.version);
    add('frontend/package.json version', v === expect, `实际 ${v} / 期望 ${expect}`);
  } catch (e) { add('frontend/package.json version', false, e.message); }

  // ② app/server/node/package.json
  try {
    const v = jsonVersion(root, 'app/server/node/package.json', (o) => o.version);
    add('app/server/node/package.json version', v === expect, `实际 ${v} / 期望 ${expect}`);
  } catch (e) { add('app/server/node/package.json version', false, e.message); }

  // ③ package-lock.json 的**两处**自指版本
  //    ⚠️ 两处都要查：npm 生成 lock 时两处一起写，但手改/漏装时可能只漂一处。
  try {
    const v = jsonVersion(root, 'app/server/node/package-lock.json', (o) => o.version);
    add('package-lock.json 顶层 version', v === expect, `实际 ${v} / 期望 ${expect}`);
  } catch (e) { add('package-lock.json 顶层 version', false, e.message); }
  try {
    const v = jsonVersion(root, 'app/server/node/package-lock.json', (o) => {
      const pkgs = o.packages;
      // packages 是对象；自指条目的键是空串
      if (!pkgs || typeof pkgs !== 'object') return undefined;
      const self = pkgs[''];
      return self ? self.version : undefined;
    });
    add('package-lock.json packages[""].version', v === expect, `实际 ${v} / 期望 ${expect}`);
  } catch (e) { add('package-lock.json packages[""].version', false, e.message); }

  return { checks, version: expect };
}

/** 把仓库里本脚本负责的 4 个文件复制成一个假根，供反例使用 */
function makeFixtureRoot(dst) {
  fs.mkdirSync(path.join(dst, 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(dst, 'app/server/node'), { recursive: true });
  const pairs = [
    ['manifest', 'manifest'],
    ['frontend/package.json', 'frontend/package.json'],
    ['app/server/node/package.json', 'app/server/node/package.json'],
    ['app/server/node/package-lock.json', 'app/server/node/package-lock.json'],
  ];
  for (const [from, to] of pairs) {
    fs.copyFileSync(path.join(REPO, from), path.join(dst, to));
  }
}

function main() {
  let pass = 0;
  let fail = 0;
  console.log(`校验根目录：${REPO}`);
  const res = checkVersionSync(REPO);
  for (const c of res.checks) {
    if (c.ok) { pass++; console.log(`  ✔ ${c.name}（${c.detail}）`); }
    else { fail++; console.log(`  ✘ ${c.name} —— ${c.detail}`); }
  }
  if (res.version) console.log(`真源 manifest version = ${res.version}`);

  // ── 反例自检 ──────────────────────────────────────────────────────────
  // 造一个"只把 frontend/package.json 改错"的假根，判定必须变红。
  // 否则本套件可能是恒绿的空壳（铁律 #11：核查脚本会假绿）。
  //
  // ⚠️ 仅在**实校全绿**时做自检：假根是从当前仓库复制出来的，实校已经红说明仓库本身没同步，
  //    这时"改成 9.9.9 却没红"可能只是因为基线本来就是 9.9.9 —— 报「假护栏」会把排查带偏。
  //    实校已红时直接跳过自检（退出码已经由实校决定，不存在"因为跳过而假绿"）。
  if (fail > 0) {
    console.log('\n⚠️ 实校已有失败项 ⇒ 跳过反例自检（基线不可信，自检结论会误导；退出码已由实校决定）');
    console.log('\n' + '='.repeat(50));
    console.log(`版本号同步核查：${pass} 通过 / ${fail} 失败`);
    console.log('='.repeat(50));
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-pkgver-'));
  try {
    makeFixtureRoot(tmp);
    const badFile = path.join(tmp, 'frontend/package.json');
    const orig = JSON.parse(fs.readFileSync(badFile, 'utf-8'));
    const good = orig.version;
    orig.version = '9.9.9';
    fs.writeFileSync(badFile, JSON.stringify(orig, null, 2), 'utf-8');

    const bad = checkVersionSync(tmp);
    const hit = bad.checks.find((c) => c.name === 'frontend/package.json version');
    if (hit && !hit.ok) {
      pass++;
      console.log(`  ✔ 反例自检：把 frontend 版本改成 9.9.9 后确实变红（原 ${good}）`);
    } else {
      fail++;
      console.log(`  ✘ 反例自检失败：版本被改错成 9.9.9 却没判红 —— 本套件的断言是假护栏`);
    }

    // 第二个反例：JSON 解析不了也必须判红（不能静默跳过）
    fs.writeFileSync(badFile, '{ "version": ', 'utf-8');
    const broken = checkVersionSync(tmp);
    const hit2 = broken.checks.find((c) => c.name === 'frontend/package.json version');
    if (hit2 && !hit2.ok) {
      pass++;
      console.log('  ✔ 反例自检：frontend/package.json 截断成非法 JSON 后确实变红（不静默跳过）');
    } else {
      fail++;
      console.log('  ✘ 反例自检失败：非法 JSON 没判红 —— 解析失败被静默当成"通过"');
    }

    // 第三个反例：lock 缺少 packages[""] 也必须判红（fail-closed）
    const lockFile = path.join(tmp, 'app/server/node/package-lock.json');
    fs.copyFileSync(path.join(REPO, 'app/server/node/package-lock.json'), lockFile);
    const lockObj = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    delete lockObj.packages[''];
    fs.writeFileSync(lockFile, JSON.stringify(lockObj, null, 2), 'utf-8');
    const noSelf = checkVersionSync(tmp);
    const hit3 = noSelf.checks.find((c) => c.name === 'package-lock.json packages[""].version');
    if (hit3 && !hit3.ok) {
      pass++;
      console.log('  ✔ 反例自检：lock 缺 packages[""] 后确实变红（核验不到 ≠ 没问题）');
    } else {
      fail++;
      console.log('  ✘ 反例自检失败：lock 缺 packages[""] 却没判红');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 残留无妨 */ }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`版本号同步核查：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(50));
  process.exit(fail ? 1 : 0);
}

if (require.main === module) main();
module.exports = { checkVersionSync, readManifest };
