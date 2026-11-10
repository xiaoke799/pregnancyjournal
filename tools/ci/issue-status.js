#!/usr/bin/env node
/**
 * tools/ci/issue-status.js —— 开放 issue 与「已知问题表」的对账（只读）
 *
 * 解决的问题：修复发了、issue 忘了关，越积越多；或者反过来 —— 还没发布就把 issue 关了，
 * 用户升级后发现没修。两种情况都靠人记，靠不住。
 *
 * 判据只有一条（与 docs/issue-replies.md 一致）：
 *   **用户升级到最新发布版后，他报的现象还会不会复现。**
 *   ⇒ 命中「已 fixed 且版本 ≤ 当前 manifest 版本」的 issue，才是真的可以关。
 *
 * 只读：不关 issue、不发评论、不需要 token（公开仓库走匿名 API）。
 * 关 issue 仍是人工动作 —— 机器人不知道"是否已上架应用中心"这个事实。
 *
 * 用法：
 *   node tools/ci/issue-status.js
 *   node tools/ci/issue-status.js --json
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REPO = process.env.PJ_REPO_SLUG || 'xiaoke799/pregnancyjournal';
const API = 'https://api.github.com';
const JSON_OUT = process.argv.includes('--json');

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

/** 版本比较：a <= b ? 支持 3 段；容忍 "0.0.30 起" 这类带后缀的写法（否则会解析出 NaN、比较恒 false） */
function versionLte(a, b) {
  const nums = v => {
    const m = String(v).replace(/^v/i, '').match(/\d+(?:\.\d+)*/);
    return m ? m[0] : '0';
  };
  const pa = nums(a).split('.').map(Number);
  const pb = nums(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return true;
}

function readManifestVersion() {
  const txt = fs.readFileSync(path.join(REPO_ROOT, 'manifest'), 'utf8');
  const m = /^version\s*=\s*(\S+)/m.exec(txt);
  return m ? m[1] : '';
}

/** 复用 issue-triage 的解析器，避免两套口径 */
function readKnownIssues() {
  const T = require('./issue-triage');
  return T.parseKnownIssues(fs.readFileSync(path.join(REPO_ROOT, 'docs/known-issues.md'), 'utf8'));
}

async function gh(p) {
  const res = await fetch(`${API}${p}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pregnancyjournal-issue-status',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${p} → ${res.status}`);
  return res.json();
}

(async () => {
  const ver = readManifestVersion();
  const known = readKnownIssues();
  const T = require('./issue-triage');

  const open = (await gh(`/repos/${REPO}/issues?state=open&per_page=100`))
    .filter(i => !i.pull_request);   // PR 也是 issue 接口，排除掉

  const rows = open.map(i => {
    const text = `${i.title}\n${i.body || ''}`;
    const matches = T.matchKnownIssues({ title: i.title, body: i.body || '' }, known);
    const ki = matches[0] || null;
    let verdict = '待判断';
    let why = '';

    if (ki) {
      if (ki.status === 'fixed') {
        if (versionLte(ki.version, ver)) {
          verdict = '可关闭';
          why = `已 fixed 于 ${ki.version} ≤ 当前 ${ver}`;
        } else {
          verdict = '等发布';
          why = `声明 ${ki.version} 修复，但当前版本只有 ${ver}`;
        }
      } else if (ki.status === 'wontfix') {
        verdict = '可关闭';
        why = '已定性为不做（记得写清理由）';
      } else {
        verdict = '暂不关';
        why = `状态 ${ki.status}`;
      }
    } else {
      const kind = T.classify(text);
      verdict = '待判断';
      why = kind === 'bug' ? '未匹配已知问题：先确认能否复现' : `类目 ${kind}`;
    }
    return { number: i.number, title: i.title, author: i.user?.login || '', kind: T.classify(text), ki: ki ? ki.id : '', verdict, why };
  });

  if (JSON_OUT) {
    console.log(JSON.stringify({ version: ver, issues: rows }, null, 2));
    return;
  }

  console.log(C.bold(`\n开放 issue 对账（当前 manifest 版本 ${ver}）`));
  if (!rows.length) {
    console.log(C.dim('  没有开放的 issue。\n'));
    return;
  }
  const pad = (s, n) => String(s).padEnd(n);
  for (const r of rows) {
    const color = r.verdict === '可关闭' ? C.green : r.verdict === '等发布' ? C.yellow : C.dim;
    console.log(`  #${pad(r.number, 4)} ${color(pad(r.verdict, 6))} ${pad(r.ki || '-', 7)} ${r.title.slice(0, 42)}`);
    console.log(C.dim(`        ${r.why}　by ${r.author}`));
  }

  const closable = rows.filter(r => r.verdict === '可关闭');
  console.log('');
  if (closable.length) {
    console.log(C.green(`  → ${closable.length} 条可以关：`) + closable.map(r => '#' + r.number).join(', '));
    console.log(C.dim('    关闭前贴 docs/issue-replies.md 里对应话术。'));
  } else {
    console.log(C.dim('  → 暂时没有"已发布且已修"的 issue 可以关。'));
  }
  console.log('');
})().catch(e => {
  console.error(C.red('巡检失败：' + e.message));
  process.exit(1);
});
