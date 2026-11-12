#!/usr/bin/env node
/**
 * tools/ci/close-issue.js —— 关闭 issue（需要 PAT，不接受匿名）
 *
 * 为什么单独做一个脚本，而不是让机器人自动关：
 *   关闭的判据是「用户升级到最新发布版后还会不会复现」，而机器人不知道「已上架」这个事实
 *   （manifest 只有版本号，没有发布状态）。所以关闭保持**人工触发**，脚本只负责省掉点鼠标。
 *
 * 为什么不用连接器：
 *   connector 的 OAuth scope 由它自己定，可能只读；PAT 的权限由仓库所有者定，可控。
 *   用法见 docs/issue-replies.md §五。
 *
 * 用法：
 *   GITHUB_TOKEN=... node tools/ci/close-issue.js --issue=3 --reason=completed
 *   GITHUB_TOKEN=... node tools/ci/close-issue.js --issues=1,2 --reason=completed --comment=reply.md
 *   …--dry-run          只打印将要做什么
 *   …--comment-file=…    关闭前先贴一段说明（强烈建议：不写原因的 Close 等于没解释）
 *
 * 幂等：已经关闭的会跳过，不会报错。
 */
const fs = require('fs');
const path = require('path');
const { makeClient } = require('./gh');

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const argOf = (n, d = null) => {
  const a = argv.find(x => x.startsWith(`--${n}=`));
  return a === undefined ? d : a.slice(n.length + 3);
};

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'xiaoke799/pregnancyjournal';
const REASON = argOf('reason', 'completed');
const DRY = has('dry-run');
const VALID_REASONS = ['completed', 'not_planned', 'duplicate'];

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
};

function targets() {
  const single = argOf('issue');
  const many = argOf('issues');
  const raw = [single, many].filter(Boolean).join(',');
  const nums = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  return [...new Set(nums)];
}

(async () => {
  if (!TOKEN) {
    console.error(C.red('缺少 GITHUB_TOKEN。'));
    console.error('  连接器只读时请用 PAT：GitHub → Settings → Developer settings → Fine-grained tokens');
    console.error('  权限：Issues = Read and write、Pull requests = Read and write、Contents = Read');
    console.error(C.dim('  例：GITHUB_TOKEN=<你的 PAT> node tools/ci/close-issue.js --issue=3'));
    process.exit(2);
  }
  if (!VALID_REASONS.includes(REASON)) {
    console.error(C.red(`--reason 只能是 ${VALID_REASONS.join(' / ')}，收到：${REASON}`));
    process.exit(2);
  }

  const nums = targets();
  if (!nums.length) {
    console.error(C.red('没指定 issue：用 --issue=3 或 --issues=1,2'));
    process.exit(2);
  }

  const commentFile = argOf('comment-file');
  let comment = argOf('comment', '');
  if (commentFile) {
    const p = path.resolve(commentFile);
    if (!fs.existsSync(p)) {
      console.error(C.red(`--comment-file 找不到：${p}`));
      process.exit(2);
    }
    comment = fs.readFileSync(p, 'utf8');
  }

  const gh = makeClient({ token: TOKEN, repo: REPO });
  let ok = 0, skipped = 0, failed = 0;

  for (const n of nums) {
    try {
      const issue = await gh.request('GET', `/repos/${REPO}/issues/${n}`);
      if (issue.pull_request) {
        console.log(C.yellow(`  #${n} 是 PR，不是 issue —— 跳过（PR 请用 auto-merge 或网页操作）`));
        skipped++;
        continue;
      }
      if (issue.state === 'closed') {
        console.log(C.dim(`  #${n} 已经关闭（${issue.state_reason || '-'}）—— 跳过`));
        skipped++;
        continue;
      }

      console.log(`  #${n} ${issue.title}`);

      if (comment) {
        if (DRY) console.log(C.dim(`    将发布 ${comment.length} 字符的说明`));
        else {
          await gh.request('POST', `/repos/${REPO}/issues/${n}/comments`, { body: { body: comment } });
          console.log(C.green('    ✓ 已发布说明'));
        }
      }

      if (DRY) {
        console.log(C.dim(`    将置为 closed（${REASON}）`));
      } else {
        await gh.request('PATCH', `/repos/${REPO}/issues/${n}`, { body: { state: 'closed', state_reason: REASON } });
        console.log(C.green(`    ✓ 已关闭（${REASON}）`));
      }
      ok++;
    } catch (e) {
      console.error(C.red(`  #${n} 失败：${e.message}`));
      failed++;
    }
  }

  console.log(`\n结果：${ok} 已处理 / ${skipped} 跳过 / ${failed} 失败${DRY ? '（dry-run，未实际修改）' : ''}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(C.red('close-issue 出错：' + e.stack));
  process.exit(1);
});
