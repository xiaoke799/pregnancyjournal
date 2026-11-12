#!/usr/bin/env node
/**
 * tools/ci/auto-merge.js —— 自动合并判定与执行
 *
 * 判定逻辑和"执行合并"**分开**：`evaluate()` 是纯函数，能单测（见 selftest.js）；
 * `main()` 只负责取数据、调 evaluate、执行。否则"合并条件写反了"这种错误只能靠线上出事才发现。
 *
 * 合并必须同时满足（缺一不可）：
 *   ① 有 `automerge` 标签 —— 默认不自动合，得有人明确说"这个可以自动走"
 *   ② 有 `review:pass` 标签 —— 审查器跑过且没阻断项
 *   ③ 没有 `review:changes` / `review:needs-human`
 *   ④ 改动文件不含高危路径（`.github/` `cmd/` `manifest` `tools/verify/` `tools/ci/` …）
 *   ⑤ CI 检查全部成功：一个都不能 pending，也不能一个都没有
 *   ⑥ 非 draft、无冲突（mergeable=true）
 *   ⑦ head 分支不是 base 分支
 *
 * 设计取舍：
 *   · **"没有检查"按阻断处理**，不按通过处理。没有 CI 的 PR 自动合并等于裸奔。
 *   · **in_progress 一律等**，不猜。宁可下一轮再合，也不合一个半绿的东西。
 *   · 合并方式默认 squash —— 这个仓库的提交历史要能看懂，不要 15 个 "wip"。
 *
 * 用法：
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=o/r PR_NUMBER=5 node tools/ci/auto-merge.js
 *   …--dry-run     只判定不合并
 *   …--json        机器可读输出
 *   …--merge-method=merge|squash|rebase
 *
 * 退出码：0 = 已合并或按规则跳过（不是失败） / 1 = 执行出错 / 2 = 本该合并但被拦下
 */
const RULES = require('../verify/rules');
const { makeClient } = require('./gh');

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const argOf = (n, d = null) => {
  const a = argv.find(x => x.startsWith(`--${n}=`));
  return a === undefined ? d : a.slice(n.length + 3);
};

const REQUIRED_LABEL = process.env.PJ_MERGE_LABEL || 'automerge';
const PASS_LABEL = 'review:pass';
const BLOCK_LABELS = ['review:changes', 'review:needs-human'];
const MERGE_METHOD = argOf('merge-method', process.env.PJ_MERGE_METHOD || 'squash');

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// 纯函数：给定 PR 的全部事实，判定能不能合
// ---------------------------------------------------------------------------
function evaluate({ pr, files = [], fileTotal = 0, labels = [], checks = [], requiredLabel = REQUIRED_LABEL }) {
  const blockers = [];
  const waits = [];
  const block = (code, msg) => blockers.push({ code, msg });
  const wait = (code, msg) => waits.push({ code, msg });

  if (!pr) return { action: 'skip', reason: '没有 PR 信息' };
  if (pr.state !== 'open') return { action: 'skip', reason: `PR 状态是 ${pr.state}，不是 open` };
  if (pr.draft) return { action: 'skip', reason: 'PR 还是 draft' };

  const has = name => labels.some(l => String(l).toLowerCase() === name.toLowerCase());

  if (!has(requiredLabel)) {
    return { action: 'skip', reason: `没有 \`${requiredLabel}\` 标签 —— 自动合并需要显式授权` };
  }
  for (const b of BLOCK_LABELS) {
    if (has(b)) block('block-label', `标签 \`${b}\` 存在，说明审查没过或需要人看`);
  }
  if (!has(PASS_LABEL)) {
    block('no-pass-label', `缺少 \`${PASS_LABEL}\` —— 审查器还没给出通过结论（评论里发 \`/review\` 触发）`);
  }

  // 🔴 文件列表被截断 ⇒ 无法确认是否含高危路径 ⇒ 一律不许自动合并（fail-closed）。
  //    起因：GraphQL 的 `files(first:100)` 只返回前 100 个。若一个 120 文件的 PR 把
  //    `.github/workflows/x.yml` 放在第 101 个，findHighRisk 就扫不到它 ——
  //    高危红线会被"文件够多"这件事本身绕过去。这种洞不能靠"改天再说"。
  if (fileTotal > files.length) {
    block('files-truncated',
      `PR 有 ${fileTotal} 个文件，这里只拿到 ${files.length} 个 —— 无法确认是否含高危路径`);
  }

  // 高危路径：这是硬红线，标签和检查都不能覆盖它
  const risky = RULES.findHighRisk(files);
  for (const r of risky) block('high-risk-path', `\`${r.path}\` —— ${r.reason}`);

  // 分支
  if (pr.head?.ref && pr.base?.ref && pr.head.ref === pr.base.ref) {
    block('same-branch', 'head 与 base 是同一个分支');
  }

  // 冲突 / 计算中
  if (pr.mergeable === false) block('conflict', `存在冲突（mergeable_state=${pr.mergeable_state || 'dirty'}）`);
  if (pr.mergeable === null || pr.mergeable === undefined) {
    wait('mergeable-unknown', 'GitHub 还在计算 mergeable，下一轮再看');
  }

  // 检查
  if (!checks.length) {
    block('no-checks', '这个 PR 没有任何 CI 检查 —— 没有检查的自动合并等于裸奔');
  } else {
    const bad = checks.filter(c => /^(FAILURE|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE)$/i.test(c.conclusion || ''));
    const pending = checks.filter(c => {
      const st = String(c.status || '').toUpperCase();
      return st && st !== 'COMPLETED';
    });
    for (const c of bad) block('check-failed', `检查 \`${c.name}\` = ${c.conclusion}`);
    for (const c of pending) wait('check-pending', `检查 \`${c.name}\` 仍在 ${c.status}`);
  }

  if (blockers.length) return { action: 'block', reason: `${blockers.length} 项不满足合并条件`, blockers, waits };
  if (waits.length) return { action: 'wait', reason: `${waits.length} 项还在进行中`, blockers, waits };
  return { action: 'merge', reason: '全部条件满足', blockers, waits };
}

// ---------------------------------------------------------------------------
// 事件 payload → PR 号
// 单独抽成纯函数，因为"取错号"的后果是**操作到别的 PR**（甚至合并错东西），
// 而它只会在某个特定触发事件下才出错，线上很难复现。
// ---------------------------------------------------------------------------
function resolvePrNumber(payload, envNumber) {
  const n = Number(envNumber || 0);
  if (n) return n;
  if (!payload) return 0;
  return payload.pull_request?.number
    || payload.check_suite?.pull_requests?.[0]?.number
    || payload.workflow_run?.pull_requests?.[0]?.number
    || payload.issue?.number
    || payload.number
    || 0;
}

// ---------------------------------------------------------------------------
function normalizeChecks(rollup) {
  return (rollup || []).map(c => {
    if (c.__typename === 'StatusContext' || c.context) {
      // 老式 status：state 只有 SUCCESS/PENDING/FAILURE/ERROR
      const st = String(c.state || '').toUpperCase();
      return {
        name: c.context || c.name || 'status',
        status: st === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
        conclusion: st === 'PENDING' ? null : st,
      };
    }
    return { name: c.name || 'check', status: c.status, conclusion: c.conclusion };
  });
}

// ---------------------------------------------------------------------------
async function main() {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || 'xiaoke799/pregnancyjournal';
  if (!token) throw new Error('缺少 GITHUB_TOKEN');

  let prNumber = 0;
  let payload = null;
  if (process.env.GITHUB_EVENT_PATH && require('fs').existsSync(process.env.GITHUB_EVENT_PATH)) {
    payload = JSON.parse(require('fs').readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  }
  prNumber = resolvePrNumber(payload, process.env.PR_NUMBER);
  if (!prNumber) throw new Error('拿不到 PR 号（PR_NUMBER 或 event payload）');

  const gh = makeClient({ token, repo });

  // 一次 GraphQL 拿全：mergeable + 文件 + 标签 + 检查
  const q = `query($owner:String!,$name:String!,$num:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$num){
        number title isDraft state mergeable
        headRefName baseRefName
        author{login}
        labels(first:20){nodes{name}}
        files(first:100){ totalCount nodes{path} }
        commits(last:1){nodes{commit{statusCheckRollup{contexts(first:60){nodes{
          __typename
          ... on CheckRun{name status conclusion}
          ... on StatusContext{context state}
        }}}}}}
      }
    }
  }`;
  const [owner, name] = repo.split('/');
  const gql = await gh.request('POST', '/graphql', { body: { query: q, variables: { owner, name, num: prNumber } } });
  const p = gql?.data?.repository?.pullRequest;
  if (!p) throw new Error('GraphQL 没拿到 PR：' + JSON.stringify(gql).slice(0, 300));

  const checks = normalizeChecks(p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes);
  const pr = toPr(p);
  const files = (p.files?.nodes || []).map(f => f.path);
  const fileTotal = p.files?.totalCount ?? files.length;
  const labels = (p.labels?.nodes || []).map(l => l.name);

  const verdict = evaluate({ pr, files, fileTotal, labels, checks });

  if (has('json')) {
    console.log(JSON.stringify({ pr: prNumber, ...verdict, checks, labels, files }, null, 2));
  } else {
    console.log(C.bold(`\nPR #${prNumber} ${pr.title}`));
    console.log(C.dim(`  分支 ${pr.base.ref} ← ${pr.head.ref}　标签 [${labels.join(', ') || '无'}]　检查 ${checks.length} 项`));
    console.log(`  判定：${verdict.action === 'merge' ? C.green('可以合并') : verdict.action === 'wait' ? C.yellow('等待中') : verdict.action === 'block' ? C.red('被拦下') : C.dim('跳过')} —— ${verdict.reason}`);
    for (const b of verdict.blockers || []) console.log(C.red(`    ✗ [${b.code}] ${b.msg}`));
    for (const w of verdict.waits || []) console.log(C.yellow(`    … [${w.code}] ${w.msg}`));
  }

  if (verdict.action !== 'merge') {
    process.exit(verdict.action === 'block' ? 2 : 0);
  }
  // workflow_dispatch 手动触发时默认只判定不合并（PJ_DRY_RUN=1），
  // 免得有人填个 PR 号就把带 automerge 标签的 PR 合了。真正要合得显式关掉 dry_run。
  const dryRun = has('dry-run') || !!process.env.PJ_DRY_RUN;
  if (dryRun) {
    console.log(C.dim('\n--dry-run：未执行合并（只判定）'));
    return;
  }

  // 执行合并
  const res = await gh.request('PUT', `/repos/${repo}/pulls/${prNumber}/merge`, {
    body: {
      merge_method: MERGE_METHOD,
      commit_title: `${pr.title} (#${prNumber})`,
      commit_message: `自动合并：审查通过、检查全绿、改动不含高危路径。\n\n审查口径见 docs/review-protocol.md。`,
    },
  });

  if (!res.merged) {
    console.error(C.red(`合并未成功：${res.message || '未知原因'}`));
    process.exit(1);
  }
  console.log(C.green(`\n✅ 已合并（${MERGE_METHOD}）：${res.sha?.slice(0, 7)}`));

  // 删源分支（失败不算错：可能是 fork 或受保护分支）
  if (process.env.PJ_KEEP_BRANCH !== '1' && pr.head.ref && pr.head.ref !== pr.base.ref) {
    try {
      await gh.request('DELETE', `/repos/${repo}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`);
      console.log(C.dim(`  已删除分支 ${pr.head.ref}`));
    } catch (e) {
      console.log(C.dim(`  分支未删除（${e.message}）`));
    }
  }

  try {
    await gh.request('POST', `/repos/${repo}/issues/${prNumber}/comments`, {
      body: { body: `已自动合并（${MERGE_METHOD}）为 \`${res.sha?.slice(0, 7)}\`。\n\n` +
        `判定依据：\`${REQUIRED_LABEL}\` + \`${PASS_LABEL}\` + 检查全绿 + 不含高危路径。\n` +
        `<sub>由 tools/ci/auto-merge.js 执行</sub>` },
    });
  } catch (e) { /* 评论失败不影响合并结果 */ }
}

/**
 * GraphQL → evaluate() 期望的形状。
 *
 * 🔴 2026-11-12 第一次真跑 GraphQL 才发现的三个语义坑（此前脚本从没跑过）：
 *   ① `state` 是枚举 `OPEN/CLOSED/MERGED`，而 evaluate 比的是小写 `'open'`
 *      ⇒ 不转换的话**任何 PR 都会被判 skip**；
 *   ② `mergeableState` 字段在 PullRequest 上不存在（那是 REST 的 `mergeable_state`）
 *      ⇒ 整个查询报 undefinedField；
 *   ③ `mergeable` 是枚举 `MERGEABLE/CONFLICTING/UNKNOWN`，而 evaluate 期望
 *      true/false/null ⇒ 不映射的话冲突检测永远不触发，UNKNOWN 也不会 wait。
 */
const MERGEABLE_MAP = { MERGEABLE: true, CONFLICTING: false, UNKNOWN: null };
function toPr(p) {
  return {
    number: p.number,
    title: p.title,
    draft: p.isDraft,
    state: String(p.state || '').toLowerCase(),
    mergeable: MERGEABLE_MAP[p.mergeable],
    mergeable_state: p.mergeable,
    head: { ref: p.headRefName },
    base: { ref: p.baseRefName },
    user: { login: p.author?.login },
  };
}

module.exports = { evaluate, normalizeChecks, resolvePrNumber, toPr,
  REQUIRED_LABEL, PASS_LABEL, BLOCK_LABELS };

if (require.main === module) {
  main().catch(e => {
    console.error(C.red('自动合并器出错：' + e.stack));
    process.exit(1);
  });
}
