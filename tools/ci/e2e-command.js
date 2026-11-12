#!/usr/bin/env node
/**
 * 斜杠命令的离线端到端：起一个假 GitHub API，跑**真实脚本**。
 *
 * 为什么必须有它：
 *   `issue_comment → handle-command.js → auto-merge.js → PUT /pulls/{n}/merge`
 *   这条链路做的是**写操作**（合并 + 删分支），而它在真实仓库上从未被触发过 ——
 *   PAT 没有 `Actions: write`，点不动 Run workflow。也就是说：
 *   「这条命令能不能用」此前唯一的证据是"代码看起来对"。
 *   而 L-027 / L-028 两个事故都是"代码看起来对、从没真跑过"造成的。
 *
 * 它能证明什么、不能证明什么（别夸大）：
 *   ✅ 命令分发正确（哪个命令干什么、非维护者被拒、非命令不回复）
 *   ✅ 发出去的 HTTP 请求形状正确（method / path / body）
 *   ✅ 判定为"可合并"时确实调用了合并接口，而不是只打印一句话
 *   ❌ 不能证明 GitHub 真会接受这些请求（权限、保护分支、合并策略都在服务端）
 *   ❌ 不能证明 GraphQL 真实 schema 与这里的桩一致
 *   ⇒ 所以它**不能**替代真跑一次，只能把"从没跑过"降级成"逻辑至少跑通过一遍"。
 *
 * 用法：
 *   node tools/ci/e2e-command.js           # 跑全部场景
 *   node tools/ci/e2e-command.js -v        # 同时打印子进程输出
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const CMD = path.join(__dirname, 'handle-command.js');
const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');
const OWNER_REPO = 'o/r';
const PR_NUM = 7;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? '  ← ' + detail : ''}`); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-e2e-'));

// ---------------------------------------------------------------------------
// 假 GitHub API
// ---------------------------------------------------------------------------

/** 一个"什么条件都满足"的 PR（状态、标签、检查、路径全过） */
function gqlPayload({ labels = ['automerge', 'review:pass'], files = ['app/server/node/routes/x.js'], fileTotal, checks } = {}) {
  const nodes = checks || [
    { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  return {
    data: {
      repository: {
        pullRequest: {
          number: PR_NUM,
          title: '示例 PR',
          isDraft: false,
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          headRefName: 'feat/x',
          baseRefName: 'master',
          author: { login: 'xiaoke799' },
          labels: { nodes: labels.map(name => ({ name })) },
          files: {
            totalCount: fileTotal === undefined ? files.length : fileTotal,
            nodes: files.map(p => ({ path: p })),
          },
          commits: {
            nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }],
          },
        },
      },
    },
  };
}

/**
 * 起一个假 API。opts.graphql 决定 GraphQL 返回什么（每个场景不一样）。
 * 所有请求都会被记进 calls，供断言用（包括"没约定"的请求 —— 宁可让它看着成功，
 * 也要留下痕迹，否则"少发了一个请求"这种 Bug 会隐身）。
 */
function startMock(opts = {}) {
  const calls = [];
  const gqlBody = gqlPayload(opts.graphql || {});

  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', d => { buf += d; });
    req.on('end', () => {
      let body = null;
      try { body = buf ? JSON.parse(buf) : null; } catch (e) { body = { __unparsable: buf.slice(0, 200) }; }
      calls.push({ method: req.method, path: req.url, body });

      const send = (status, payload) => {
        if (status === 204 || payload === undefined) { res.writeHead(status || 204); res.end(); return; }
        res.writeHead(status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      const p = req.url.split('?')[0];
      if (req.method === 'POST' && p === '/graphql') return send(200, gqlBody);
      if (req.method === 'PUT' && /\/pulls\/\d+\/merge$/.test(p)) {
        // 允许场景模拟"服务端拒绝"（比如权限不足的 403）——
        // 只看"请求发出去了"是不够的：403 也是发出去了。
        if (opts.mergeStatus && opts.mergeStatus >= 400) {
          return send(opts.mergeStatus, { message: opts.mergeMessage || 'Resource not accessible by integration' });
        }
        return send(200, { merged: true, sha: 'abcdef1234567890', message: 'Pull Request successfully merged' });
      }
      if (req.method === 'DELETE') return send(204);
      if (req.method === 'POST' && /\/issues\/\d+\/comments$/.test(p)) return send(201, { id: 900 });
      if (req.method === 'POST' && /\/issues\/comments\/\d+\/reactions$/.test(p)) return send(201, { id: 901 });
      if (req.method === 'POST' && /\/issues\/\d+\/labels$/.test(p)) return send(200, []);
      if (req.method === 'GET') return send(200, []);
      return send(200, null);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 跑一次 handle-command.js（真实子进程 + 真实 HTTP）
// ---------------------------------------------------------------------------

function commentPayload({ body, association = 'OWNER', isPr = true, commentId = 555 }) {
  return {
    action: 'created',
    comment: {
      id: commentId,
      body,
      author_association: association,
      user: { login: association === 'NONE' ? 'random-stranger' : 'xiaoke799' },
    },
    issue: {
      number: PR_NUM,
      ...(isPr ? { pull_request: { url: `https://api.github.com/repos/${OWNER_REPO}/pulls/${PR_NUM}` } } : {}),
    },
  };
}

let seq = 0;
function runCommand(apiUrl, payload, extraEnv = {}) {
  const evPath = path.join(TMP, `event-${++seq}.json`);
  fs.writeFileSync(evPath, JSON.stringify(payload));

  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CMD], {
      cwd: REPO,
      env: {
        ...process.env,
        GITHUB_TOKEN: 'fake-token-for-offline-test',
        GITHUB_REPOSITORY: OWNER_REPO,
        GITHUB_API_URL: apiUrl,        // ⇒ gh.js 的默认 base url（见 gh.js 注释）
        GITHUB_EVENT_PATH: evPath,
        // 清掉可能干扰的变量：真实一次 run 里不会同时存在另一个 PR_NUMBER
        PR_NUMBER: '',
        ISSUE_NUMBER: '',
        PJ_DRY_RUN: '',
        ...extraEnv,
      },
    });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { } }, 25_000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: err + e.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      if (VERBOSE) {
        console.log(`\n    ── child exit=${code} ${Date.now() - t0}ms ──`);
        (out + err).split('\n').filter(Boolean).forEach(l => console.log('    | ' + l.trim().slice(0, 160)));
      }
      resolve({ code, out, err });
    });
  });
}

const findCall = (calls, method, re) => calls.find(c => c.method === method && re.test(c.path));
const mergeCalls = calls => calls.filter(c => c.method === 'PUT' && /\/pulls\/\d+\/merge$/.test(c.path));
const commentCalls = calls => calls.filter(c => c.method === 'POST' && /\/issues\/\d+\/comments$/.test(c.path));
const trail = calls => JSON.stringify(calls.map(c => `${c.method} ${c.path}`));
const replyBody = (calls, i = 0) => String(commentCalls(calls)[i]?.body?.body || '');

// ---------------------------------------------------------------------------
// 场景（每个都是独立 mock + 独立子进程）
// ---------------------------------------------------------------------------

const CASES = [];
/**
 * @param title 场景名
 * @param opts  { body: 评论内容, association?: 作者身份, graphql?: GraphQL 桩, env?: 额外环境变量 }
 * @param fn    (mock, run) => void，run() 跑一次真实 handle-command
 */
const scenario = (title, opts, fn) => CASES.push({ title, opts, fn });

// ① 正常合并 —— 唯一会真改仓库状态的路径，必须证明它确实发了 PUT
scenario('/merge（维护者 + 条件全满足）', { body: '/merge' }, async (mock, run) => {
  const r = await run();
  const puts = mergeCalls(mock.calls);
  ok('调用了合并接口', puts.length === 1, `实际 ${puts.length} 次`);
  ok('合并方式用 squash', puts[0]?.body?.merge_method === 'squash', JSON.stringify(puts[0]?.body || null));
  ok('commit_title 带 PR 号', /\(#7\)$/.test(String(puts[0]?.body?.commit_title || '')),
    String(puts[0]?.body?.commit_title || ''));
  ok('合完删了源分支', !!findCall(mock.calls, 'DELETE', /\/git\/refs\/heads\/feat%2Fx$/),
    JSON.stringify(mock.calls.filter(c => c.method === 'DELETE').map(c => c.path)));
  ok('合完在 PR 上留了评论', !!findCall(mock.calls, 'POST', /\/issues\/7\/comments$/));
  // 🔴 关键：必须验"结果"，不能只验"请求发出去了" —— 403 也是发出去了。
  //    这一句只有在 res.merged 为真时才会出现，所以它证明的是合并**成功**。
  ok('回帖确认「已自动合并」（说明 res.merged 为真，不是只发了个请求）',
    /已自动合并/.test(replyBody(mock.calls)), replyBody(mock.calls).slice(0, 100) || '(没有评论)');
  const gql = findCall(mock.calls, 'POST', /^\/graphql$/);
  ok('用 GraphQL 一次拿全（而不是 REST 分几次）', !!gql);
  ok('查询里要了 statusCheckRollup（检查状态靠它）', /statusCheckRollup/.test(String(gql?.body?.query || '')));
  ok('子进程正常退出', r.code === 0, `exit=${r.code} ${(r.err || '').slice(-200)}`);
});

// ② 非维护者 —— 以前只靠脚本里的 if，没人验过
scenario('/merge（陌生人）', { body: '/merge', association: 'NONE' }, async (mock, run) => {
  const r = await run();
  const react = findCall(mock.calls, 'POST', /\/issues\/comments\/555\/reactions$/);
  ok('给该评论点了踩', !!react);
  ok('点踩用的是 -1（content 不是 comment）', react?.body?.content === '-1', JSON.stringify(react?.body || null));
  ok('没有调用合并接口', mergeCalls(mock.calls).length === 0);
  ok('没有回帖（不给刷屏者舞台）', commentCalls(mock.calls).length === 0);
  ok('正常退出（拒绝不是故障）', r.code === 0, `exit=${r.code}`);
});

// ③ 普通评论 —— 一个请求都不该发
scenario('普通评论（不是命令）', { body: '这个我看下，谢谢' }, async (mock, run) => {
  const r = await run();
  ok('一个 API 请求都没发', mock.calls.length === 0, trail(mock.calls));
  ok('正常退出', r.code === 0, `exit=${r.code}`);
});

// ④ /help —— 只回帖
scenario('/help', { body: '/help' }, async (mock, run) => {
  const r = await run();
  ok('回了一条评论', commentCalls(mock.calls).length === 1, `实际 ${commentCalls(mock.calls).length} 条`);
  ok('回的是命令说明', /可用命令/.test(replyBody(mock.calls)));
  ok('没有调用合并接口', mergeCalls(mock.calls).length === 0);
  ok('正常退出', r.code === 0, `exit=${r.code}`);
});

// ⑤ 未知命令
scenario('/nonsense', { body: '/nonsense' }, async (mock, run) => {
  const r = await run();
  ok('回帖说明了未知命令', /未知命令/.test(replyBody(mock.calls)), replyBody(mock.calls).slice(0, 80));
  ok('没有调用合并接口', mergeCalls(mock.calls).length === 0);
  ok('正常退出', r.code === 0, `exit=${r.code}`);
});

// ⑥ 审查没过（有 review:changes）：必须拒绝并回帖
scenario('/merge（审查没过）',
  { body: '/merge', graphql: { labels: ['automerge', 'review:changes'] } },
  async (mock, run) => {
    const r = await run();
    ok('没有调用合并接口', mergeCalls(mock.calls).length === 0, trail(mock.calls));
    ok('回帖说明了条件不满足', /合并条件未满足/.test(replyBody(mock.calls)), replyBody(mock.calls).slice(0, 80));
    ok('退出码 0（规则拒绝不是 CI 故障）', r.code === 0, `exit=${r.code}`);
  });

// ⑦ 高危路径（改 CI 自己）：最该拦的一种，绝不能被"标签 + 绿检查"绕过
scenario('/merge（含高危路径）',
  { body: '/merge', graphql: { files: ['.github/workflows/verify.yml'] } },
  async (mock, run) => {
    const r = await run();
    ok('高危路径 PR 没有被合并', mergeCalls(mock.calls).length === 0);
    ok('回帖说明了条件不满足', /合并条件未满足/.test(replyBody(mock.calls)));
    ok('退出码 0', r.code === 0, `exit=${r.code}`);
  });

// ⑧ 文件列表被截断：无法确认高危路径 ⇒ 必须拦（L-023 同类，靠 fail-closed）
scenario('/merge（文件列表被截断）',
  { body: '/merge', graphql: { files: ['a.js'], fileTotal: 120 } },
  async (mock, run) => {
    const r = await run();
    ok('截断时不许合并', mergeCalls(mock.calls).length === 0);
    ok('回帖说明了条件不满足', /合并条件未满足/.test(replyBody(mock.calls)));
    ok('退出码 0', r.code === 0, `exit=${r.code}`);
  });

// ⑨ dry-run：判定通过也绝不合并（workflow_dispatch 的默认值靠它兜住）
scenario('/merge + PJ_DRY_RUN=1', { body: '/merge', env: { PJ_DRY_RUN: '1' } }, async (mock, run) => {
  const r = await run();
  ok('dry-run 下没有调用合并接口', mergeCalls(mock.calls).length === 0, trail(mock.calls));
  ok('仍然做了判定（发了 GraphQL）', !!findCall(mock.calls, 'POST', /^\/graphql$/));
  ok('正常退出', r.code === 0, `exit=${r.code}`);
});

// ⑩ 服务端拒绝合并（比如权限不足的 403）——
//    只验"请求发出去了"是不够的：403 也是发出去了。必须验"没谎报成功"。
scenario('/merge（服务端 403）', { body: '/merge', mergeStatus: 403 }, async (mock, run) => {
  const r = await run();
  ok('确实尝试了合并', mergeCalls(mock.calls).length === 1, trail(mock.calls));
  ok('没有谎报成功（不存在「已自动合并」的评论）',
    !/已自动合并/.test(replyBody(mock.calls)), replyBody(mock.calls).slice(0, 120));
  ok('把失败告诉人了（回帖含「合并器出错」）',
    /合并器出错/.test(replyBody(mock.calls)), replyBody(mock.calls).slice(0, 120) || '(没有回帖)');
  ok('命令处理器自己没崩', r.code === 0, `exit=${r.code}`);
});

// ---------------------------------------------------------------------------

(async () => {
  for (const c of CASES) {
    console.log(`\n== ${c.title} ==`);
    const mock = await startMock({
      graphql: c.opts.graphql,
      mergeStatus: c.opts.mergeStatus,
      mergeMessage: c.opts.mergeMessage,
    });
    const run = () => runCommand(
      mock.url,
      commentPayload({ body: c.opts.body, association: c.opts.association || 'OWNER' }),
      c.opts.env || {},
    );
    try {
      await c.fn(mock, run);
    } catch (e) {
      ok(`${c.title} 未抛异常`, false, e.message);
    } finally {
      await mock.close();
    }
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('e2e 自身出错：' + e.stack);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { }
  process.exitCode = 1;
});
