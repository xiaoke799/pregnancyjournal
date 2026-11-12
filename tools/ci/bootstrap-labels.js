#!/usr/bin/env node
/**
 * tools/ci/bootstrap-labels.js —— 初始化仓库标签（幂等）
 *
 * 为什么需要：2026-11-12 体检发现 5 个 workflow 已注册，但仓库里 **一个标签都没有**。
 * 自动合并靠 `automerge` 表达"人授权了"，审查结论靠 `review:*` 落地 ——
 * 标签不存在时，机器人每次都要临时创建，而 fork PR 的只读 token 创建不了，
 * 结论就无处安放（applyLabels 以前还会把失败静默吞掉）。
 *
 * `owner: human` 的标签（automerge）这里**只创建定义**，绝不给任何 issue/PR 添加。
 * "授权"这个动作永远由人完成。
 *
 * 用法：
 *   GITHUB_TOKEN=<你的 PAT> node tools/ci/bootstrap-labels.js
 *   … --dry-run     只列将要做的事，不写
 *   … --list        纯离线：只打印标签清单（不需要 token）
 *   … --json        机器可读输出
 *
 * 幂等：已存在的标签默认不改（避免覆盖人工设置的颜色/描述）；加 --sync 才对齐真源。
 */
'use strict';
const { makeClient } = require('./gh');
const { LABELS, HUMAN_ONLY } = require('./labels');

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const DRY = has('dry-run');
const JSON_OUT = has('json');
const SYNC = has('sync');
const LIST_ONLY = has('list');
const REPO = process.env.GITHUB_REPOSITORY || 'xiaoke799/pregnancyjournal';

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

function token() {
  // 只认环境变量。不要从某个固定的本机目录去"猜" token ——
  // 那个目录只有我这台机器上才有，写进仓库等于给 clone 的人一条走不通的路。
  return process.env.GITHUB_TOKEN || '';
}

function printList(rows) {
  console.log(C.bold('\n标签真源（tools/ci/labels.js）'));
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(22)} #${r.color}  ${r.owner === 'human' ? C.yellow('人工') : '机器人'}  ${r.desc}`);
  }
  if (HUMAN_ONLY.length) {
    console.log(C.yellow(`\n  ⚠ ${HUMAN_ONLY.join(', ')} 只能由人打标签；本脚本只创建定义，不会给任何 issue/PR 添加。`));
  }
}

if (LIST_ONLY) {
  const rows = Object.entries(LABELS).map(([name, v]) => ({ name, ...v }));
  if (JSON_OUT) console.log(JSON.stringify(rows, null, 2));
  else printList(rows);
  process.exit(0);
}

(async () => {
  const tok = token();
  if (!tok && !DRY) {
    console.error(C.red('缺少 GITHUB_TOKEN。'));
    console.error(C.dim('  GITHUB_TOKEN=<你的 PAT> node tools/ci/bootstrap-labels.js'));
    console.error(C.dim('  或加 --list 纯离线查看清单'));
    process.exit(2);
  }

  const gh = tok ? makeClient({ token: tok, repo: REPO }) : null;
  const existing = gh ? (await gh.request('GET', `/repos/${REPO}/labels?per_page=100`)) : [];
  if (!Array.isArray(existing)) throw new Error('读取标签失败');
  const byName = new Map(existing.map(l => [l.name, l]));

  const actions = [];
  for (const [name, def] of Object.entries(LABELS)) {
    const cur = byName.get(name);
    if (!cur) actions.push({ op: 'create', name, ...def });
    else if (SYNC && (cur.color !== def.color || cur.description !== def.desc)) {
      actions.push({ op: 'update', name, ...def });
    } else {
      actions.push({ op: 'skip', name, ...def });
    }
  }

  const done = { created: [], updated: [], skipped: [], failed: [] };
  for (const a of actions) {
    if (a.op === 'skip') { done.skipped.push(a.name); continue; }
    if (DRY || !gh) { done[a.op === 'create' ? 'created' : 'updated'].push(a.name + ' (dry-run)'); continue; }
    try {
      const payload = { name: a.name, color: a.color, description: a.desc };
      if (a.op === 'create') await gh.request('POST', `/repos/${REPO}/labels`, { body: payload });
      else await gh.request('PATCH', `/repos/${REPO}/labels/${encodeURIComponent(a.name)}`, { body: payload });
      done[a.op === 'create' ? 'created' : 'updated'].push(a.name);
    } catch (e) {
      done.failed.push(`${a.name}: ${String(e.message || e).slice(0, 140)}`);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ repo: REPO, dryRun: DRY, ...done }, null, 2));
  } else {
    console.log(C.bold(`\n标签初始化（${REPO}）${DRY ? C.yellow(' [dry-run]') : ''}`));
    for (const n of done.created) console.log(C.green('  + 创建 ' + n));
    for (const n of done.updated) console.log(C.green('  ~ 对齐 ' + n));
    for (const n of done.failed) console.log(C.red('  ✗ 失败 ' + n));
    console.log(C.dim(`  已存在 ${done.skipped.length} 个，无需改动`));
    printList(Object.entries(LABELS).map(([name, v]) => ({ name, ...v })));
  }

  process.exit(done.failed.length ? 1 : 0);
})().catch(e => {
  console.error(C.red('初始化失败：' + (e.stack || e.message)));
  process.exit(1);
});
