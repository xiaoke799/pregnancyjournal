#!/usr/bin/env node
/**
 * tools/verify/check_artifact_freshness.js —— 打包前检查「产物是不是由当前源码构建的」
 *
 * 硬化自 LESSONS L-025（2026-11-10 真实事故）：
 *   21:41 build → 21:43 合入改前端的 commit → 21:45 打包。
 *   包里是旧产物，但 build.ps1 六步全绿、开包 md5 比对也过 ——
 *   因为「包内 == 本地」只证明打包过程没出错，两边都是旧的照样相等。
 *
 * 三层证据，缺一不可：
 *   ① 内容级：产物里注入的版本号 == manifest.version（旧产物会带旧版本号）
 *   ② 时间级：产物 mtime >= **frontend/src 所有源码文件 mtime 的最大值**
 *      ⚠️ 不用 `git log --format=%ct`：那是「提交动作」的时间，源码内容可能早在 build
 *         之前就改好了（提交晚于构建 ⇒ 假红）。文件 mtime 才反映内容最后变更。
 *         本地打包环境不会 checkout 刷新源码 mtime；CI 里没有 app/ui，脚本直接跳过。
 *   ③ 工作区级：frontend/src 有未提交改动时，在结论里显式点出来（供人复核）
 *
 * 用法：
 *   node tools/verify/check_artifact_freshness.js            # 无产物时跳过（CI 场景）
 *   node tools/verify/check_artifact_freshness.js --require  # 产物必须存在（build.ps1 用）
 *   … --json / --verbose
 *
 * 退出码：0 通过或跳过 / 1 判红 / 2 用法或环境错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ENV = require('./_env');

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const JSON_OUT = has('json');
const VERBOSE = has('verbose');
const REQUIRE = has('require');
const ROOT = (() => {
  const a = argv.find(x => x.startsWith('--root='));
  return a ? path.resolve(a.slice('--root='.length)) : ENV.REPO;
})();

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

/**
 * 纯判定函数 —— 故意不碰文件系统，便于 selftest 用假数据跑反例。
 * @param {object} d
 * @param {boolean} d.hasArtifact    产物是否存在
 * @param {boolean} [d.require]      是否要求产物必须存在
 * @param {string}  d.manifestVersion
 * @param {string[]} d.artifactVersions  产物里出现的所有 0.0.N 版本号
 * @param {number}  d.artifactMtime  产物 mtime（秒）
 * @param {number}  d.srcNewestMtime 前端源码文件 mtime 的最大值（秒）
 * @param {number}  [d.commitTime]   最后一次前端提交时间（仅展示，不作判据）
 * @param {number}  [d.dirtyCount]   未提交前端改动的文件数（仅展示）
 */
function evaluate(d) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  if (!d.hasArtifact) {
    return {
      ok: !d.require, skipped: true, checks,
      reason: d.require ? '产物不存在，但 --require 要求必须有' : '无产物（CI 环境），跳过检查',
    };
  }

  // ① 版本注入
  const others = (d.artifactVersions || []).filter(v => v !== d.manifestVersion);
  add('产物版本号与 manifest 一致',
    (d.artifactVersions || []).includes(d.manifestVersion) && others.length === 0,
    others.length ? `产物里还有旧版本 ${others.join(', ')}（manifest=${d.manifestVersion}）`
      : (d.artifactVersions || []).length ? `产物注入 ${d.manifestVersion}` : '产物里找不到版本字符串（无法证明新鲜）');

  // ② 时间：产物必须晚于源码最后一次内容变更
  if (d.srcNewestMtime > 0) {
    add('产物晚于前端源码最后改动', d.artifactMtime >= d.srcNewestMtime,
      `产物 ${d.artifactMtime} / 源码 ${d.srcNewestMtime}` +
      (d.artifactMtime < d.srcNewestMtime
        ? ` —— 差 ${d.srcNewestMtime - d.artifactMtime}s，先 cd frontend && npm run build`
        : (d.dirtyCount ? `（另有 ${d.dirtyCount} 个未提交改动）` : '')));
  }

  return { ok: checks.every(c => c.ok), skipped: false, checks };
}

// ---------------------------------------------------------------------------
// 采集真实数据
// ---------------------------------------------------------------------------
function git(args) {
  const r = spawnSync(ENV.GIT, args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function collect() {
  const uiDir = path.join(ROOT, 'app', 'ui');
  const indexHtml = path.join(uiDir, 'index.html');
  const hasArtifact = fs.existsSync(indexHtml);

  const manifestPath = path.join(ROOT, 'manifest');
  let manifestVersion = '';
  if (fs.existsSync(manifestPath)) {
    const m = /^version\s*=\s*(\S+)/m.exec(fs.readFileSync(manifestPath, 'utf8'));
    if (m) manifestVersion = m[1];
  }

  // 只认 0.0.N 这种项目自有版本形态；bundle 里库版本号（如 1.2.3）不参与
  const artifactVersions = new Set();
  const assetsDir = path.join(uiDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    for (const f of fs.readdirSync(assetsDir)) {
      if (!f.endsWith('.js')) continue;
      const p = path.join(assetsDir, f);
      let txt = '';
      try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
      // ⚠️ 不能用 `\b0\.0\.\d+\b`：产物里实际是 "孕程记 v0.0.35 已加载"，
      //    `v` 和 `0` 都是单词字符，开头没有单词边界 ⇒ 会一个都扫不到（2026-11-12 实测）。
      //    改用"前面不是数字"的捕获组，既能命中 v0.0.35，又不会把 10.0.35 当项目版本。
      for (const m of txt.matchAll(/(?:^|[^0-9])(0\.0\.\d+)\b/g)) artifactVersions.add(m[1]);
    }
  }

  const artifactMtime = hasArtifact ? Math.floor(fs.statSync(indexHtml).mtimeMs / 1000) : 0;

  // 源码内容最后变更时间 = frontend/src 下所有源文件 mtime 的最大值。
  // 递归遍历，跳过 node_modules / .git 之类的垃圾目录。
  const srcDir = path.join(ROOT, 'frontend', 'src');
  let srcNewestMtime = 0;
  (function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|vue|js|css|scss|json)$/i.test(e.name)) continue;
      try { srcNewestMtime = Math.max(srcNewestMtime, Math.floor(fs.statSync(p).mtimeMs / 1000)); }
      catch (err) { /* 忽略 */ }
    }
  })(srcDir);

  // 下面两项只用于展示，不参与判定
  const lg = git(['log', '-1', '--format=%ct', '--', 'frontend/src']);
  const commitTime = lg.code === 0 && /^\d+$/.test(lg.out) ? Number(lg.out) : 0;
  const st = git(['status', '--porcelain', '--', 'frontend/src']);
  const dirtyCount = st.code === 0 && st.out ? st.out.split('\n').filter(Boolean).length : 0;

  return {
    hasArtifact, require: REQUIRE, manifestVersion,
    artifactVersions: [...artifactVersions], artifactMtime,
    srcNewestMtime, commitTime, dirtyCount,
  };
}

// ---------------------------------------------------------------------------
function main() {
  const d = collect();
  const r = evaluate(d);

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...r, inputs: d }, null, 2));
  } else {
    console.log(C.bold('\n前端产物新鲜度检查'));
    if (r.skipped) {
      console.log('  ' + (r.ok ? C.dim('⚪ 跳过：' + r.reason) : C.red('🔴 ' + r.reason)));
    } else {
      for (const c of r.checks) {
        console.log(`  ${c.ok ? C.green('✓') : C.red('✗')} ${c.name}`);
        if (!c.ok || VERBOSE) console.log(C.dim('      ' + c.detail));
      }
      if (VERBOSE) {
        console.log(C.dim(`  ── manifest=${d.manifestVersion} 产物版本=[${d.artifactVersions.join(',')}] ` +
          `产物mtime=${d.artifactMtime} 源码最新mtime=${d.srcNewestMtime} ` +
          `最后提交=${d.commitTime} 未提交=${d.dirtyCount}`));
      }
      console.log(r.ok ? C.green('  ✓ 产物由当前源码构建，可以打包')
        : C.red('  🔴 产物比源码旧 —— 先 cd frontend && npm run build 再打包'));
    }
    console.log('');
  }
  process.exit(r.ok ? 0 : 1);
}

module.exports = { evaluate, collect };
if (require.main === module) main();
