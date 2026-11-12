#!/usr/bin/env node
/**
 * tools/verify/gate.js —— 本地闸门：按「改了什么」自动选「必须跑哪几套」
 *
 * 【为什么需要它】
 *   `tools/verify/README.md` 里那张「改什么 → 必跑什么」的表是**给人看的**。
 *   人一忙就会跳过，跳过就没有任何证据 —— 表写得再全也等于没有。
 *   本脚本把那张表变成代码：读 git 改动 → 命中规则 → 只跑受影响的套件 → 红就非零退出。
 *
 * 【为什么不直接跑全量】
 *   全量 81 套约 9–14 分钟。改一行文案也跑全量 ⇒ 人会开始找借口不跑。
 *   闸门的价值在于「快到你没有理由跳过」（通常 1~3 套）。
 *
 * 用法：
 *   node tools/verify/gate.js                    # 默认：对比 HEAD（含未跟踪文件）
 *   node tools/verify/gate.js --staged           # 只看暂存区（pre-commit 用）
 *   node tools/verify/gate.js --range=v0.0.33..HEAD
 *   node tools/verify/gate.js --dry-run          # 只打印会跑什么，不执行
 *   node tools/verify/gate.js --self             # 只改了 tools/verify 自身：做脚本自检
 *   node tools/verify/gate.js release --tag=v0.0.34   # 发版闸门（版本号/CHANGELOG 一致性）
 *
 * ⚠️ 子进程一律用**异步 spawn**：本机沙箱下 `spawnSync(<任意 exe>)` 恒 EBUSY（见 README 注意事项 1）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ENV = require('./_env');

const REPO = ENV.REPO;
const ENV_NAME = ENV.NODE;

// 规则表已迁至 ./rules.js —— 单一真源：闸门 / PR 审查 / 自动合并共用同一份。
// 在这里复制一份的后果是这个仓库最熟悉的那种：两个平行实现，改一处漏另一处。
const { RULES, pick, findHighRisk } = require('./rules');

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO, ...opts });
    let out = '', err = '';
    if (child.stdout) child.stdout.on('data', d => out += d);
    if (child.stderr) child.stderr.on('data', d => err += d);
    child.on('error', e => resolve({ code: -1, out: '', err: e.message }));
    child.on('close', code => resolve({ code, out, err }));
  });
}

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// 这些目录里的文件不算「本次改动」：
//   .git* / .trash / node_modules / 本目录的运行期产物
// ⚠️ `.git-rewrite/` 是 `git filter-branch` 的工作目录。它**未被 gitignore**，
//    会以未跟踪文件身份混进改动列表（2026-11-10 实测：24 个文件里 17 个是它）。
//    出现它说明本机正在/曾经重写历史 —— 不要删、不要去动，只是不参与闸门判定。
const IGNORED_PATH = /^(\.git\/|\.git-rewrite\/|\.trash\/|node_modules\/|tools\/verify\/(\.tmp|regress-out)\/)/;

async function changedFiles(argv) {
  const staged = argv.includes('--staged');
  const rangeArg = argv.find(a => a.startsWith('--range='));
  let args;
  let label;
  if (staged) {
    args = ['diff', '--cached', '--name-only', '--diff-filter=ACMR'];
    label = '暂存区（--staged）';
  } else if (rangeArg) {
    const range = rangeArg.slice('--range='.length);
    args = ['diff', '--name-only', '--diff-filter=ACMR', range];
    label = range;
  } else {
    args = ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'];
    label = 'HEAD 对比';
  }
  const r = await run(ENV.GIT, args);
  if (r.code !== 0) {
    console.error(C.red(`git ${args.join(' ')} 失败：`) + (r.err || r.out).trim());
    process.exit(2);
  }
  const files = r.out.split('\n').map(s => s.trim()).filter(Boolean);

  // 未跟踪文件不在 diff 里，但它们同样是需要验证的改动（新文件最容易漏）。
  if (!staged && !rangeArg) {
    const u = await run(ENV.GIT, ['ls-files', '--others', '--exclude-standard']);
    if (u.code === 0) {
      files.push(...u.out.split('\n').map(s => s.trim()).filter(Boolean));
    }
  }
  const cleaned = [...new Set(
    files.map(f => f.replace(/\\/g, '/')).filter(f => !IGNORED_PATH.test(f))
  )];
  return { files: cleaned, label };
}

// SELF_PATH / pick 已迁至 ./rules.js。这里保留一个同名转发，纯为不让下面几十处调用点全改。
const pickSuites = pick;

function printPlan(files, label, hits, suites, manual, scripts) {
  console.log(C.bold(`\n改动来源：${label}，共 ${files.length} 个文件`));
  for (const f of files.slice(0, 25)) console.log(C.dim('  · ' + f));
  if (files.length > 25) console.log(C.dim(`  …… 其余 ${files.length - 25} 个略`));

  if (!hits.length) {
    console.log(C.yellow('\n⚠️ 没有命中任何规则。'));
    console.log('   如果这是纯文案/注释改动 ⇒ 属正常，提交信息里写明「无需套件」的理由。');
    console.log('   如果你改了业务代码 ⇒ 说明规则表有洞，请往 gate.js 的 RULES 补一条。');
    return;
  }

  console.log(C.bold('\n命中规则 → 必跑套件：'));
  for (const { rule, matched } of hits) {
    console.log(`  ${C.bold('[' + rule.id + ']')} ${rule.why}`);
    console.log(C.dim('      因：' + matched.slice(0, 4).join(', ') + (matched.length > 4 ? ` 等 ${matched.length} 个` : '')));
    if (rule.suites.length) console.log(`      套件：${rule.suites.join('  ')}`);
    if (rule.scripts && rule.scripts.length) console.log(`      脚本：${rule.scripts.join('  ')}`);
  }
  if (manual.length) {
    console.log(C.yellow('\n  另需手工跑（不在汇总运行器里）：'));
    for (const m of manual) console.log('    $ ' + m);
  }
  console.log(C.bold(suites.length + scripts.length
    ? `\n合计 ${suites.length} 套 + ${scripts.length} 个脚本`
    : '\n没有可自动跑的检查 —— 按上面的手工检查走。'));
}

async function runSuites(suites) {
  if (!suites.length) return 0;
  const args = [path.join(ENV.VERIFY_DIR, 'run_all_suites.js'), '--ci', ...suites.map(s => `--suite=${s}`)];
  const child = spawn(ENV_NAME, args, { cwd: REPO, stdio: 'inherit', env: { ...process.env } });
  return await new Promise(resolve => {
    child.on('error', () => resolve(-1));
    child.on('close', code => resolve(code === null ? -1 : code));
  });
}

/** 跑 RULES 里 scripts 声明的单脚本（不是 SUITES 成员，但同样有退出码） */
async function runScripts(scripts) {
  let bad = 0;
  for (const s of scripts) {
    const abs = path.join(REPO, s);
    if (!fs.existsSync(abs)) {
      console.error(C.red(`\n🔴 规则引用的脚本不存在（fail-closed）：${s}`));
      bad++;
      continue;
    }
    console.log(C.bold(`\n>>> ${s}`));
    const r = await run(ENV_NAME, [abs], { stdio: 'inherit' });
    if (r.code !== 0) {
      console.log(C.red(`    ✗ 判红（exit ${r.code}）`));
      bad++;
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// 发版闸门：tag 与版本真源必须对得上
// 为什么单独做：版本号有 8 处，其中 5 处靠 build.ps1、3 处靠 verify_pkg_versions；
// 但「tag 名 / CHANGELOG 条目 / manifest.changelog」这条链此前无人校验。
// ---------------------------------------------------------------------------
function readManifest() {
  const txt = fs.readFileSync(path.join(REPO, 'manifest'), 'utf8');
  const m = {};
  for (const line of txt.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    if (!k || k.startsWith('#')) continue;
    m[k] = line.slice(i + 1).trim();
  }
  return m;
}

async function releaseGate(argv) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  let tag = (argv.find(a => a.startsWith('--tag=')) || '').slice('--tag='.length).trim();
  if (!tag) {
    const r = await run(ENV.GIT, ['describe', '--tags', '--exact-match', 'HEAD']);
    if (r.code === 0) tag = r.out.trim();
  }
  if (!tag) {
    console.error(C.red('✗ 无法确定 tag：HEAD 不在任何 tag 上，也没有给 --tag='));
    console.error('  用法：node tools/verify/gate.js release --tag=v0.0.34');
    process.exit(2);
  }
  const ver = tag.replace(/^v/i, '');

  const man = readManifest();
  add('tag 名是 vX.Y.Z 形式', /^v\d+\.\d+\.\d+$/.test(tag), `tag=${tag}`);
  add('tag 与 manifest.version 一致', man.version === ver, `tag=${ver} / manifest=${man.version}`);
  add('manifest.sub_version === version', man.sub_version === man.version, `${man.sub_version} vs ${man.version}`);

  const chlog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  add('CHANGELOG.md 有该版本小节', new RegExp(`^##\\s*\\[${ver.replace(/\./g, '\\.')}\\]`, 'm').test(chlog), `查找 "## [${ver}]"`);

  const manChangelog = man.changelog || '';
  add('manifest.changelog 非空', manChangelog.length > 20, `${manChangelog.length} 字符`);
  add('manifest.changelog 提到该版本', new RegExp(ver.replace(/\./g, '\\.'), 'i').test(manChangelog),
    manChangelog.slice(0, 40) + (manChangelog.length > 40 ? '…' : ''));

  console.log(C.bold(`\n发版闸门：${tag}\n`));
  let bad = 0;
  for (const c of checks) {
    console.log(`  ${c.ok ? C.green('✓') : C.red('✗')} ${c.name}  ${C.dim(c.detail || '')}`);
    if (!c.ok) bad++;
  }

  // 版本号那 3 处「无人管」的文件交给常驻套件（它自带反例自检）。
  const code = await runSuites(['verify_pkg_versions']);
  if (code !== 0) bad++;

  if (bad) {
    console.log(C.red(`\n🔴 发版闸门未通过：${bad} 项\n`));
    process.exit(1);
  }
  console.log(C.green(`\n✅ 发版闸门通过：${tag}\n`));
}

// ---------------------------------------------------------------------------
// 自检模式：只改了 tools/verify 自身
// ---------------------------------------------------------------------------
/**
 * 规则表自检：RULES 里引用的套件名必须真的存在。
 * 为什么：套件一旦改名/删除，规则会**静默指向空气** —— 表面上有规则，实际什么都没跑。
 * 这类腐烂只有靠机器盯着（workflow.md 第九节把"规则表靠人工维护"列为已知缺口，这是补丁）。
 */
async function checkRuleNames() {
  const src = fs.readFileSync(path.join(__dirname, 'rules.js'), 'utf8');
  const r = await run(ENV_NAME, [path.join(ENV.VERIFY_DIR, 'run_all_suites.js'), '--list']);
  if (r.code !== 0) {
    console.log(C.red('  ✗ 跑 --list 失败，无法校验规则表'));
    return 1;
  }
  const listed = new Set(
    // ⚠️ 字符类必须含 `-`：2026-11-12 加入 `e2e-command` 时，原来的 `[A-Za-z0-9_]+`
    // 把它截成了 `e2e`，于是自检报「规则表引用了不存在的套件 e2e-command」——
    // 一个**假红**，但方向危险：这类"截断"如果发生在别的解析里，就会把
    // "存在"读成"不存在"（或反过来，把不存在的读成存在）。见 L-023 的同族问题。
    // 用 `\s{2,}` 收口：--list 的列之间是补空格对齐的，名字本身不会带连续空格。
    r.out.split('\n').map(l => (l.trim().match(/^([A-Za-z0-9_-]+)\s{2,}/) || [])[1]).filter(Boolean)
  );
  const bad = new Set();
  for (const m of src.matchAll(/suites:\s*\[([^\]]*)\]/g)) {
    for (const n of m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)) {
      if (!listed.has(n)) bad.add(n);
    }
  }
  if (bad.size) {
    console.log(C.red(`  ✗ 规则表引用了不存在的套件：${[...bad].join(', ')}（套件改了名？）`));
    return 1;
  }
  console.log(C.green(`  ✓ 规则表引用的套件名全部存在（可用 ${listed.size} 套）`));
  return 0;
}

async function selfCheck(argv) {
  const { files } = await changedFiles(argv);
  const js = files.filter(f => /^tools\/verify\/.*\.js$/.test(f));
  let bad = 0;
  console.log(C.bold(`\n脚本自检：${js.length} 个改动的 .js`));
  for (const f of js) {
    const r = await run(ENV_NAME, ['--check', path.join(REPO, f)]);
    const ok = r.code === 0;
    console.log(`  ${ok ? C.green('✓') : C.red('✗')} ${f}`);
    if (!ok) { bad++; console.log(C.dim((r.err || '').trim().split('\n').slice(0, 3).join('\n'))); }
  }
  // 顺带确认验证环境本身没坏（挑两套最快的、纯静态的）
  const code = await runSuites(['verify_pkg_versions', 'verify_api_contracts']);
  if (code !== 0) bad++;
  bad += await checkRuleNames();
  if (bad) { console.log(C.red(`\n🔴 自检未通过：${bad} 项\n`)); process.exit(1); }
  console.log(C.green('\n✅ 自检通过。改过套件逻辑的，请另跑一次全量。\n'));
}

// ---------------------------------------------------------------------------
(async () => {
  const argv = process.argv.slice(2);
  if (argv[0] === 'release' || argv[0] === '--release') return releaseGate(argv);
  if (argv.includes('--self')) return selfCheck(argv);

  const { files, label } = await changedFiles(argv).catch(e => {
    console.error(C.red('读取 git 改动失败：' + e.message));
    process.exit(2);
  });

  if (!files.length) {
    console.log(C.dim(`\n${label}：没有检测到改动。`));
    console.log('   想跑全量：node tools/verify/run_all_suites.js');
    return;
  }

  const { hits, suites, manual, scripts } = pickSuites(files);
  printPlan(files, label, hits, suites, manual, scripts);

  if (argv.includes('--dry-run')) {
    console.log(C.dim('\n--dry-run：未执行。'));
    return;
  }
  if (!suites.length && !scripts.length) {
    if (manual.length) {
      console.log(C.yellow('\n本规则只有手工检查，没有可自动跑的 —— 跑完上面那几条再来。'));
    }
    return;
  }

  let bad = 0;
  if (scripts.length) bad += await runScripts(scripts);
  if (suites.length) {
    const code = await runSuites(suites);
    if (code !== 0) bad++;
  }

  if (bad) {
    console.log(C.red(`\n🔴 闸门拦下：${bad} 项红灯`));
    console.log(C.dim('   修到绿，或按 docs/review-protocol.md 写清 Not run 的原因与补验条件。'));
    process.exit(1);
  }
  console.log(C.green(`\n✅ 闸门通过：${suites.length} 套 + ${scripts.length} 个脚本全绿`));
  console.log(C.dim('   提交信息里贴证据块（docs/review-protocol.md §六）。'));
})();
