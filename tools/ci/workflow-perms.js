#!/usr/bin/env node
/**
 * workflow 权限的唯一真源（解析 + 审计）。
 *
 * 为什么需要它：
 *   GitHub Actions 的顶层 `permissions` 是**所有 job 的默认值**。只要顶层写了
 *   `contents: write`，后来新加的任何一个 job 都会白拿写权限 —— 而新加 job 的人
 *   往往只想着"跑个测试"，不会去想"我这个 job 有写权限意味着什么"。
 *
 * 口径（一句话：能写的不跑 PR 代码，跑 PR 代码的不给写）：
 *   ① 顶层一律 `permissions: {}`（全无），任何权限都必须**显式下沉到 job**；
 *   ② 每个 job 只声明它那一小块，一个也不多；
 *   ③ 权限必须和脚本行为对得上 —— 界面上写着 `/merge`，脚本真的去合并了，
 *      这个 job 就必须有 `contents: write`（见 selftest 的耦合断言）。
 *
 * ⚠️ YAML 语法过 ≠ 权限正确。这个模块存在的意义就是把"语法层面看不见的东西"
 *    变成可以断言的纯数据。
 *
 * 用法：
 *   node tools/ci/workflow-perms.js            # 审计（有问题 exit 1）
 *   node tools/ci/workflow-perms.js --matrix   # 打印权限矩阵
 *   node tools/ci/workflow-perms.js --json     # 机器可读
 *   node tools/ci/workflow-perms.js --file=.github/workflows/verify.yml
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const WFDIR = path.join(REPO, '.github', 'workflows');

/** 合法的 scope 名（写错一个字母 GitHub 不报错，等于没申请） */
const SCOPES = [
  'actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions',
  'id-token', 'issues', 'models', 'packages', 'pages', 'pull-requests',
  'repository-projects', 'security-events', 'statuses',
];

const indentOf = line => line.length - line.replace(/^ +/, '').length;

/**
 * 去掉行尾注释。
 * ⚠️ 必须做：本项目每个 scope 后面都跟了「# 为什么需要它」，不剥掉的话
 *    `contents: read   # 合并 + 删源分支` 匹配不上 `^([\w-]+)\s*:\s*(\w+)$`，
 *    那一行会被**静默丢弃** —— 于是审计看到的是"没申请权限"或"少申请了一条"。
 *    （2026-11-12 实测：第一次跑就因此把 auto-merge 的 contents: write 判丢了。）
 */
const stripComment = s => s.replace(/\s+#.*$/, '');

/**
 * 解析 flow map：`{}` / `{ contents: read, issues: write }`。
 * @returns {object|null} null = 不是 flow map（后面跟着缩进块）
 */
function parseFlowMap(s) {
  const t = String(s).trim();
  if (!t) return null;                       // `permissions:` 后面没东西 ⇒ 块式
  const m = /^\{(.*)\}$/.exec(t);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return {};                     // `permissions: {}` ⇒ 显式全无
  const out = {};
  for (const part of inner.split(',')) {
    const kv = /^\s*([\w-]+)\s*:\s*(\w+)\s*$/.exec(part);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

const SCOPE_RE = /^([\w-]+)\s*:\s*(\w+)$/;

/**
 * 解析一个 workflow 文本。只认我们实际用到的结构，不做通用 YAML。
 * @returns {{top: object|null, jobs: Array<{id: string, permissions: object|null}>}}
 *   top === null            ⇒ 没有声明顶层 permissions（GitHub 给默认权限，最危险）
 *   top === {}              ⇒ 显式 deny-all（期望状态）
 *   job.permissions === null⇒ 该 job 没自己声明，吃顶层的
 */
function parseWorkflow(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = { top: null, jobs: [] };
  let state = 'root';   // root | topPerms | jobs | job | jobPerms
  let cur = null;

  const pushJob = id => {
    const job = { id, permissions: null };
    out.jobs.push(job);
    return job;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const t = stripComment(line.trim());
    if (!t || t.startsWith('#')) continue;
    const ind = indentOf(line);

    // ---- 顶层缩进 0：任何块都在此结束 ----
    if (ind === 0) {
      state = 'root';
      cur = null;
    }

    // ---- 顶层 permissions 的缩进内容（ind >= 2） ----
    if (state === 'topPerms') {
      const m = SCOPE_RE.exec(t);
      if (m) (out.top = out.top || {})[m[1]] = m[2];
      continue;
    }

    if (state === 'root') {
      const pm = /^permissions\s*:\s*(.*)$/.exec(t);
      if (pm) {
        const flow = parseFlowMap(pm[1]);
        out.top = flow || {};
        state = flow ? 'root' : 'topPerms';
        continue;
      }
      if (/^jobs\s*:\s*$/.test(t)) { state = 'jobs'; continue; }
      continue;
    }

    // ---- 以下都在 jobs: 块内 ----
    if (ind === 2) {
      const jm = /^([\w-]+)\s*:\s*(.*)$/.exec(t);
      if (jm) { cur = pushJob(jm[1]); state = 'job'; }
      continue;
    }

    if (state === 'jobPerms') {
      if (ind >= 6) {
        const m = SCOPE_RE.exec(t);
        if (m && cur) (cur.permissions = cur.permissions || {})[m[1]] = m[2];
        continue;
      }
      state = 'job';   // 缩进回到 job 层级 ⇒ permissions 块结束
    }

    if (state === 'job' && ind === 4 && cur) {
      const pm = /^permissions\s*:\s*(.*)$/.exec(t);
      if (pm) {
        const flow = parseFlowMap(pm[1]);
        cur.permissions = flow || {};
        state = flow ? 'job' : 'jobPerms';
      }
    }
  }

  return out;
}

/** 该权限集合里拿到 write 的 scope（按字母序） */
function writeScopes(perms) {
  if (!perms) return [];
  return Object.keys(perms).filter(k => perms[k] === 'write').sort();
}

/**
 * 审计一组 workflow。返回问题列表；空数组 = 全部合规。
 * @param {Array<{file: string, text: string}>} list
 */
function audit(list) {
  const problems = [];
  const add = (file, job, code, detail) => problems.push({ file, job, code, detail });

  for (const { file, text } of list) {
    const w = parseWorkflow(text);

    // ① 顶层必须显式 deny-all
    if (w.top === null) {
      add(file, null, 'top-permissions-missing',
        '没有顶层 permissions —— GitHub 按仓库默认给权限，以后新加的 job 白拿写权限');
    } else if (Object.keys(w.top).length > 0) {
      add(file, null, 'top-permissions-not-deny-all',
        `顶层写了 ${Object.entries(w.top).map(([k, v]) => `${k}:${v}`).join(' ')}；` +
        '应为 `permissions: {}`，权限全部下沉到 job');
    }

    // ② 每个 job 必须自己声明
    if (!w.jobs.length) add(file, null, 'no-jobs', '解析不到任何 job —— 文件结构变了？');
    for (const j of w.jobs) {
      if (j.permissions === null) {
        add(file, j.id, 'job-permissions-missing', '该 job 没声明 permissions，会吃顶层默认值');
      }
    }

    // ③ scope 拼写（拼错等于静默失效）
    const all = [w.top, ...w.jobs.map(j => j.permissions)].filter(Boolean);
    for (const perms of all) {
      for (const k of Object.keys(perms)) {
        if (!SCOPES.includes(k)) add(file, null, 'unknown-scope', `未知 scope \`${k}\``);
      }
    }
  }

  return problems;
}

function loadAll(dir = WFDIR) {
  const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort();
  return files.map(f => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

function formatMatrix(list) {
  const rows = [];
  for (const { file, text } of list) {
    const w = parseWorkflow(text);
    const top = w.top === null ? '（未声明 ⚠️）'
      : Object.keys(w.top).length ? `（非空 ⚠️ ${JSON.stringify(w.top)}）` : '{}  全无';
    rows.push([file, '(顶层)', top]);
    for (const j of w.jobs) {
      const p = j.permissions === null ? '（继承顶层 ⚠️）'
        : Object.keys(j.permissions).length
          ? Object.entries(j.permissions).map(([k, v]) => `${k}:${v}`).join('  ')
          : '{}  全无';
      rows.push(['', j.id, p]);
    }
  }
  const w0 = Math.max(...rows.map(r => r[0].length), 8);
  const w1 = Math.max(...rows.map(r => r[1].length), 3);
  return rows.map(([a, b, c]) => `${a.padEnd(w0)}  ${b.padEnd(w1)}  ${c}`).join('\n');
}

function main(argv = process.argv.slice(2)) {
  const has = n => argv.includes('--' + n);
  const val = n => {
    const hit = argv.find(a => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : null;
  };

  const one = val('file');
  const list = one
    ? [{ file: one, text: fs.readFileSync(path.resolve(one), 'utf8') }]
    : loadAll(val('dir') || WFDIR);

  if (has('matrix')) { console.log(formatMatrix(list)); return 0; }

  const problems = audit(list);
  if (has('json')) {
    console.log(JSON.stringify({ files: list.length, problems }, null, 2));
    return problems.length ? 1 : 0;
  }

  console.log(`审计 ${list.length} 个 workflow：`);
  for (const { file, text } of list) {
    const w = parseWorkflow(text);
    const jobs = w.jobs.map(j => `${j.id}[${writeScopes(j.permissions).join('+') || 'r/o'}]`).join(' ');
    console.log(`  ${file.padEnd(22)} 顶层=${w.top === null ? '缺 ⚠️' : '{}'}  ${jobs || '无 job'}`);
  }

  if (!problems.length) {
    console.log('\n✅ 权限全部显式下沉到 job，顶层全无');
    return 0;
  }
  console.log(`\n🔴 ${problems.length} 个问题：`);
  for (const p of problems) {
    console.log(`  · ${p.file}${p.job ? ' :: ' + p.job : ''}  [${p.code}]  ${p.detail}`);
  }
  return 1;
}

module.exports = { parseWorkflow, writeScopes, audit, loadAll, formatMatrix, SCOPES, WFDIR };

if (require.main === module) {
  process.exitCode = main();
}
