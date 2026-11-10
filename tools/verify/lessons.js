#!/usr/bin/env node
/**
 * tools/verify/lessons.js —— 错题本的「事不过三」检查器（L2 → L3 的升格闸门）
 *
 * 【为什么需要它】
 *   错题本一旦只靠自觉，就会变成两类垃圾场：
 *     ① 条目越写越多、永远不硬化（写的时候很爽，下次照样踩）；
 *     ② 号称「已转正」，但 code-standards 里根本没有那一条（引用悬空，等于没写）。
 *   本脚本把两条都变成机器检查：
 *     · Seen ≥ 3× 且状态仍是 OPEN  ⇒ 判红，强制升格（或说明为什么不用硬化）
 *     · 状态是 PROMOTED ⇒ 必须给出 `docs/code-standards.md#CS-NN`，且该锚点真实存在
 *     · 缺字段（症状/根因/判据/证据）⇒ 判红（没有证据的条目等于没发生）
 *
 * 用法：
 *   node tools/verify/lessons.js                  # 检查
 *   node tools/verify/lessons.js --bump=L-003     # 把该条 Seen +1（可逗号分隔多个）
 *   node tools/verify/lessons.js --list           # 只列摘要表
 *   node tools/verify/lessons.js --file=<副本> --standards=<副本>   # 反例验证用
 *
 * 退出码：0 全通过 / 1 有硬错误 / 2 用法或读取错误
 */
const fs = require('fs');
const path = require('path');
const ENV = require('./_env');

const REPO = ENV.REPO;
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};

const LESSONS = path.resolve(argOf('file', path.join(REPO, 'LESSONS.md')));
const STANDARDS = path.resolve(argOf('standards', path.join(REPO, 'docs/code-standards.md')));

const REQUIRED = ['Seen', '状态', '症状', '根因', '判据', '证据'];
const THRESHOLD = 3;

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

function fail(msg) {
  console.error(C.red('✗ ' + msg));
  process.exitCode = 1;
}

function readOrDie(p, label) {
  if (!fs.existsSync(p)) {
    console.error(C.red(`✗ 找不到${label}：${p}`));
    process.exit(2);
  }
  return fs.readFileSync(p, 'utf8');
}

const md = readOrDie(LESSONS, '错题本');
const std = readOrDie(STANDARDS, '硬化规范');

// --- 解析条目 ---------------------------------------------------------------
const heads = [...md.matchAll(/^## (L-\d{3})\s+(.+)$/gm)];
if (!heads.length) {
  console.error(C.red('✗ 一个条目都没解析到（标题格式必须是 `## L-001 一句话结论`）'));
  process.exit(1);
}

function fieldOf(body, name) {
  const m = new RegExp(`^- \\*\\*${name}\\*\\*:\\s*(.+)$`, 'm').exec(body);
  return m ? m[1].trim() : null;
}

const entries = heads.map((h, i) => {
  const start = h.index;
  const end = i + 1 < heads.length ? heads[i + 1].index : md.length;
  const body = md.slice(start, end);
  const seenRaw = fieldOf(body, 'Seen') || '';
  const seenM = /^(\d+)\s*[×xX]/.exec(seenRaw);
  return {
    id: h[1],
    title: h[2].trim(),
    body,
    start,
    end,
    seen: seenM ? Number(seenM[1]) : null,
    seenRaw,
    statusRaw: fieldOf(body, '状态') || '',
    fields: Object.fromEntries(REQUIRED.map(n => [n, fieldOf(body, n)])),
  };
});

// --- 硬化规范的锚点集合（PROMOTED 必须指向真实存在的条目）--------------------
const anchors = new Set([...std.matchAll(/^## (CS-\d{2})\s/gm)].map(m => m[1]));

// --- --list -----------------------------------------------------------------
if (argv.includes('--list')) {
  const pad = (s, n) => String(s).padEnd(n, ' ');
  console.log(pad('编号', 8) + pad('Seen', 7) + pad('状态', 12) + '结论');
  for (const e of entries) {
    const st = /PROMOTED/i.test(e.statusRaw) ? 'PROMOTED'
      : /RETIRED/i.test(e.statusRaw) ? 'RETIRED' : 'OPEN';
    console.log(pad(e.id, 8) + pad(e.seen === null ? '?' : e.seen + '×', 7) + pad(st, 12) + e.title);
  }
  console.log(`\n共 ${entries.length} 条；硬化规范 ${anchors.size} 条（${[...anchors].join(', ')}）`);
  process.exit(process.exitCode || 0);
}

// --- --bump -----------------------------------------------------------------
const bumps = argv.filter(a => a.startsWith('--bump=')).flatMap(a => a.slice('--bump='.length).split(','))
  .map(s => s.trim()).filter(Boolean);
if (bumps.length) {
  let text = md;
  for (const id of bumps) {
    const e = entries.find(x => x.id === id);
    if (!e) { console.error(C.red(`✗ 没有 ${id} 这条`)); process.exitCode = 1; continue; }
    if (e.seen === null) { console.error(C.red(`✗ ${id} 的 Seen 解析不了：${e.seenRaw}`)); process.exitCode = 1; continue; }
    const next = e.seen + 1;
    const oldLine = `- **Seen**: ${e.seenRaw}`;
    const newLine = `- **Seen**: ${next}×`;
    if (!e.body.includes(oldLine)) {
      console.error(C.red(`✗ ${id} 的 Seen 行不是规范写法，没法自动 +1：${e.seenRaw}`));
      process.exitCode = 1;
      continue;
    }
    text = text.replace(e.body, e.body.replace(oldLine, newLine));
    console.log(C.green(`✓ ${id} Seen ${e.seen}× → ${next}×`) +
      (next >= THRESHOLD ? C.yellow(`  ← 到阈值了，该升格进 ${path.relative(REPO, STANDARDS)}`) : ''));
  }
  if (text !== md) fs.writeFileSync(LESSONS, text, 'utf8');
  console.log(C.dim('\n已写回。改完再跑一次本脚本做校验。\n'));
  process.exit(process.exitCode || 0);
}

// --- 校验 -------------------------------------------------------------------
console.log(C.bold(`\n错题本校验：${path.relative(REPO, LESSONS)}（${entries.length} 条）`));

const ids = new Set();
let promoted = 0, open = 0, retired = 0;

for (const e of entries) {
  if (ids.has(e.id)) fail(`${e.id} 编号重复 —— 编号永不复用，否则旧引用全部悬空`);
  ids.add(e.id);

  for (const n of REQUIRED) {
    if (!e.fields[n]) fail(`${e.id} 缺字段 **${n}**`);
  }
  if (e.seen === null) fail(`${e.id} 的 Seen 解析不了：${JSON.stringify(e.seenRaw)}（要写成 \`3×\`）`);

  const isPromoted = /PROMOTED/i.test(e.statusRaw);
  const isRetired = /RETIRED/i.test(e.statusRaw);

  if (isPromoted) {
    promoted++;
    const m = /#(CS-\d{2})/.exec(e.statusRaw);
    if (!m) {
      fail(`${e.id} 标了 PROMOTED 但没给锚点（要写成 \`PROMOTED → docs/code-standards.md#CS-NN\`）`);
    } else if (!anchors.has(m[1])) {
      fail(`${e.id} 指向 ${m[1]}，但 ${path.relative(REPO, STANDARDS)} 里没有这个小节（引用悬空 = 没写）`);
    }
  } else if (isRetired) {
    retired++;
    if (!/理由|不需要|不适用|已删除|已下线/.test(e.statusRaw)) {
      fail(`${e.id} 标了 RETIRED，但没写为什么不用硬化（加一句理由，否则看起来像在逃）`);
    }
  } else {
    open++;
    if (e.seen !== null && e.seen >= THRESHOLD) {
      fail(`${e.id} Seen ${e.seen}× 仍标 OPEN —— 事不过三，必须二选一：\n` +
        `      ① 搬进 ${path.relative(REPO, STANDARDS)} 并挂护栏，标 PROMOTED → #CS-NN\n` +
        `      ② 确认无需硬化，标 RETIRED 并写理由`);
    }
  }
}

// 反向检查：code-standards 里的每条都应该能追到一条 LESSONS（允许直接来源为"初始回填"）
const orphan = [...anchors].filter(a => !entries.some(e => e.statusRaw.includes('#' + a)));
if (orphan.length) {
  console.log(C.yellow(`\n⚠️ 这些规范条目在错题本里没有来源：${orphan.join(', ')}`));
  console.log(C.dim('   （允许，但请在规范的「来源」里写清 L-NNN，否则以后没人知道它为什么存在）'));
}

if (!process.exitCode) {
  console.log(C.green(`\n✅ 通过：${promoted} 条已硬化 / ${open} 条观察中 / ${retired} 条已退役`));
  console.log(C.dim(`   阈值：Seen ≥ ${THRESHOLD}× 必须硬化；硬化条目共 ${anchors.size} 条。\n`));
} else {
  console.log(C.red('\n🔴 有硬错误（见上）。\n'));
}
