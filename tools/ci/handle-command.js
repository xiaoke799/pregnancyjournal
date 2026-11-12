#!/usr/bin/env node
/**
 * tools/ci/handle-command.js —— 评论里的斜杠命令
 *
 * 只认 `/` 开头的评论。**普通评论一律不回复** —— 一个到处插嘴的机器人比没有更烦，
 * 而且会把真正需要人看的讨论淹掉。
 *
 * 命令（只有 OWNER / MEMBER / COLLABORATOR 能用，外部用户发命令会被点踩并忽略）：
 *   /review   在 PR 上重跑审查（PR 刚提时没触发、或想重试时用）
 *   /triage   重跑 issue 分类（新规则上线后补跑）
 *   /merge    尝试自动合并（判定条件跟 auto-merge.yml 一样，不额外放水）
 *   /help     列命令
 *
 * 授权口径：GitHub 的 author_association。不自己维护白名单 —— 那个迟早跟仓库成员对不上。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeClient } = require('./gh');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'xiaoke799/pregnancyjournal';
const ALLOWED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
};

const HELP = [
  '可用命令（仅维护者可用）：',
  '',
  '| 命令 | 作用 |',
  '|---|---|',
  '| `/review` | 在 PR 上重跑审查（贴/更新审查评论，同步标签） |',
  '| `/triage` | 重跑 issue 分类与自动回复 |',
  '| `/merge` | 尝试自动合并（条件同 `automerge` 标签流程，不额外放水） |',
  '| `/help` | 显示本说明 |',
  '',
  '<sub>机器人不会在普通讨论里插嘴；只有 `/` 开头才会响应。</sub>',
].join('\n');

function runNode(script, args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, ...env },
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => resolve({ code: -1, out, err: err + e.message }));
    child.on('close', code => resolve({ code, out, err }));
  });
}

(async () => {
  const p = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : null;
  if (!p || !p.comment) {
    console.log(C.dim('没有 comment payload，跳过'));
    return;
  }

  const body = String(p.comment.body || '').trim();
  if (!body.startsWith('/')) {
    console.log(C.dim('不是命令，忽略（普通评论不回复）'));
    return;
  }

  const [rawCmd, ...rest] = body.split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const num = p.issue?.number;
  const isPR = !!p.issue?.pull_request;
  const assoc = String(p.comment.author_association || '').toUpperCase();

  if (!TOKEN || !num) throw new Error('缺少 GITHUB_TOKEN 或 issue 号');
  const gh = makeClient({ token: TOKEN, repo: REPO });

  // 权限：不在维护者名单里就点踩 + 忽略（不回帖，避免给刷屏者舞台）
  if (!ALLOWED.has(assoc)) {
    console.log(C.yellow(`拒绝：${p.comment.user?.login} 的 association=${assoc}`));
    try {
      await gh.request('POST', `/repos/${REPO}/issues/comments/${p.comment.id}/reactions`, { body: { content: '-1' } });
    } catch (e) { /* 反应失败无所谓 */ }
    return;
  }

  const reply = async text => {
    await gh.request('POST', `/repos/${REPO}/issues/${num}/comments`, { body: { body: text } });
  };

  switch (cmd) {
    case '/help': {
      await reply(HELP);
      break;
    }
    case '/review': {
      if (!isPR) { await reply('`/review` 只能用在 PR 上。'); break; }
      console.log(C.dim(`重跑审查 PR #${num}`));
      const r = await runNode('pr-review.js', [], { PR_NUMBER: String(num) });
      // pr-review 自己会贴评论；这里只在它彻底崩了的时候兜底说一声
      if (r.code === 4) {
        await reply('审查器自身出错，没能产出结论。\n\n```\n' + (r.err || r.out).slice(-800) + '\n```');
      }
      break;
    }
    case '/triage': {
      console.log(C.dim(`重跑分类 #${num}`));
      const r = await runNode('issue-triage.js', ['--force'], { ISSUE_NUMBER: String(num) });
      if (r.code !== 0) {
        await reply('分类器出错：\n\n```\n' + (r.err || r.out).slice(-800) + '\n```');
      }
      break;
    }
    case '/merge': {
      if (!isPR) { await reply('`/merge` 只能用在 PR 上。'); break; }
      console.log(C.dim(`尝试合并 PR #${num}`));
      const r = await runNode('auto-merge.js', [], { PR_NUMBER: String(num) });
      if (r.code === 2) {
        await reply('合并条件未满足，具体原因见 `auto-merge` 的检查日志；' +
          '如果只是缺标签，先加 `automerge` 再发一次 `/merge`。');
      } else if (r.code !== 0) {
        await reply('合并器出错：\n\n```\n' + (r.err || r.out).slice(-800) + '\n```');
      }
      break;
    }
    default: {
      await reply(`未知命令 \`${rawCmd}\`。\n\n` + HELP);
    }
  }

  console.log(C.green(`已处理 ${cmd}`));
})().catch(e => {
  console.error(C.red('命令处理器出错：' + e.stack));
  process.exit(1);
});
