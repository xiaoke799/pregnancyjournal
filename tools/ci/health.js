#!/usr/bin/env node
/**
 * tools/ci/health.js —— 自动化工作流健康巡检
 *
 * 起因（2026-11-12）：5 个 workflow 都注册了，但只有 verify 真跑过；
 * 标签一个都没有；而"看起来配好了"和"真的能跑"之间没有任何可查询的差距。
 * 这个脚本把差距变成一条命令能看到的清单。
 *
 * 检查四块：
 *   ① workflow 是否注册、最近一次运行结论、有没有"从未运行"
 *   ② 标签是否与 tools/ci/labels.js 真源一致
 *   ③ 开放的 issue / PR
 *   ④ 仓库基础能力（has_issues / 默认分支）
 *
 * 用法：
 *   node tools/ci/health.js                 # 报告（不判红）
 *   node tools/ci/health.js --strict       # 标签缺失 / workflow 未注册 ⇒ exit 1
 *   node tools/ci/health.js --json
 *   GITHUB_TOKEN=…；没有 token 则只做离线部分（工件、标签定义、本地 workflow 文件）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { LABELS, HUMAN_ONLY } = require('./labels');

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const STRICT = has('strict');
const JSON_OUT = has('json');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REPO = process.env.GITHUB_REPOSITORY || 'xiaoke799/pregnancyjournal';
const WF_DIR = path.join(REPO_ROOT, '.github', 'workflows');

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

function token() {
  // 只认环境变量：不在代码里写死"某个本机目录能拿到 token"——
  // 那种路径只有作者那台机器有，clone 的人照着做只会得到"文件不存在"。
  return process.env.GITHUB_TOKEN || '';
}

const localWorkflows = () => fs.existsSync(WF_DIR)
  ? fs.readdirSync(WF_DIR).filter(f => f.endsWith('.yml')).sort()
  : [];

(async () => {
  const tok = token();
  const out = { repo: REPO, online: !!tok, workflows: [], labels: {}, open: [], issues: [] };

  if (!tok) {
    out.issues.push('没有 token，跳过线上检查（只列本地 workflow 文件）');
  }

  let gh = null;
  if (tok) {
    const { makeClient } = require('./gh');
    gh = makeClient({ token: tok, repo: REPO });
  }

  // ① workflow
  for (const f of localWorkflows()) {
    const row = { file: f, registered: false, last: null };
    if (gh) {
      try {
        const r = await gh.request('GET', `/repos/${REPO}/actions/workflows/${f}/runs?per_page=1`);
        row.registered = true;
        const run = (r.workflow_runs || [])[0];
        row.last = run ? { conclusion: run.conclusion || run.status, sha: run.head_sha.slice(0, 7), at: run.created_at.slice(0, 10) } : null;
        if (!run) row.note = '从未运行';
      } catch (e) { row.note = String(e.message || e).slice(0, 100); }
    }
    out.workflows.push(row);
  }

  // ② 标签
  const expected = Object.keys(LABELS);
  out.labels.expected = expected.length;
  if (gh) {
    try {
      const list = await gh.request('GET', `/repos/${REPO}/labels?per_page=100`);
      const names = new Set((list || []).map(l => l.name));
      out.labels.present = expected.filter(n => names.has(n));
      out.labels.missing = expected.filter(n => !names.has(n));
      if (out.labels.missing.length) {
        out.issues.push(`缺 ${out.labels.missing.length} 个标签：${out.labels.missing.join(', ')}（跑 bootstrap-labels.js）`);
      }
    } catch (e) { out.issues.push('标签读取失败：' + String(e.message || e).slice(0, 100)); }
  }

  // ③ 开放项
  if (gh) {
    try {
      const list = await gh.request('GET', `/repos/${REPO}/issues?state=open&per_page=100`);
      out.open = (list || []).map(i => ({ number: i.number, pr: !!i.pull_request, title: i.title.slice(0, 50) }));
    } catch (e) { out.issues.push('开放项读取失败：' + String(e.message || e).slice(0, 100)); }
  }

  // ④ 仓库能力
  if (gh) {
    try {
      const r = await gh.request('GET', `/repos/${REPO}`);
      out.repoMeta = { has_issues: r.has_issues, default_branch: r.default_branch };
    } catch (e) { /* 非关键 */ }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(STRICT && out.issues.length ? 1 : 0);
  }

  console.log(C.bold(`\n自动化工作流巡检（${REPO}）${tok ? '' : C.yellow(' [离线]')}`));

  console.log('\n  workflow');
  for (const w of out.workflows) {
    const state = !tok ? C.dim('本地存在')
      : !w.registered ? C.red('未注册')
      : w.note === '从未运行' ? C.yellow('从未运行')
      : w.last ? (w.last.conclusion === 'success' ? C.green('success') : C.yellow(w.last.conclusion)) : C.dim('-');
    const extra = w.last ? `${w.last.sha} ${w.last.at}` : (w.note || '');
    console.log(`    ${w.file.padEnd(24)} ${state.padEnd(20)} ${C.dim(extra)}`);
  }

  console.log('\n  标签');
  if (tok) {
    console.log(`    ${out.labels.present?.length ?? '?'} / ${out.labels.expected} 存在`,
      out.labels.missing?.length ? C.red('缺：' + out.labels.missing.join(', ')) : C.green('✓ 齐全'));
  } else console.log(C.dim('    （离线跳过）'));
  console.log(C.dim(`    人工授权标签：${HUMAN_ONLY.join(', ')}（机器人不得添加）`));

  console.log('\n  开放项');
  if (tok) {
    if (!out.open.length) console.log(C.dim('    （无）'));
    for (const i of out.open) console.log(`    #${String(i.number).padEnd(4)} ${i.pr ? 'PR   ' : 'issue'} ${i.title}`);
  } else console.log(C.dim('    （离线跳过）'));

  if (out.issues.length) {
    console.log('\n  ' + C.yellow('待办'));
    for (const s of out.issues) console.log('    · ' + s);
  }
  console.log('');
  process.exit(STRICT && out.issues.length ? 1 : 0);
})().catch(e => {
  console.error(C.red('巡检失败：' + (e.stack || e.message)));
  process.exit(1);
});
