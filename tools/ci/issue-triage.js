#!/usr/bin/env node
/**
 * tools/ci/issue-triage.js —— issue 自动分类与回复
 *
 * 【为什么不让模型自由发挥】
 *   一个编造"已在 v0.0.35 修复"的自动回复，比不回复更伤用户 —— 用户会去升级、发现没修、然后不再反馈。
 *   所以：**事实只从 `docs/known-issues.md` 取**，模型不参与生成结论。
 *   （关键词匹配是笨办法，但它的错误是"没匹配上 ⇒ 走通用模板"，可接受；
 *     模型的错误是"自信地说错话"，不可接受。）
 *
 * 做什么：
 *   1. 分类：bug / enhancement / question（关键词，命中即定，兜底 question）
 *   2. 匹配已知问题：标题命中权重 2、正文 1，最高分 ≥2 才算命中
 *   3. 按状态生成回复：fixed（版本+升级方式）/ investigating / need-info / wontfix / 未命中
 *   4. 打标签；幂等 —— 同一 issue 只回一次（靠 marker）
 *
 * 用法：
 *   # 本地：只看会回什么，不碰 GitHub
 *   node tools/ci/issue-triage.js --title="催奶食谱无法显示" --body="只有猪蹄系列"
 *   node tools/ci/issue-triage.js --title="..." --json
 *
 *   # CI
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=o/r ISSUE_NUMBER=2 ACTION=opened node tools/ci/issue-triage.js
 *
 * 退出码：0 = 正常（含"没匹配到已知问题"） / 1 = 发布失败 / 2 = 用法错误
 */
const fs = require('fs');
const path = require('path');
const { makeClient } = require('./gh');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const KI_FILE = process.env.PJ_KNOWN_ISSUES || path.join(REPO_ROOT, 'docs/known-issues.md');

const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const argOf = (n, d = null) => {
  const a = argv.find(x => x.startsWith(`--${n}=`));
  return a === undefined ? d : a.slice(n.length + 3);
};

const MARKER = '<!-- pj-bot:triage -->';
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'xiaoke799/pregnancyjournal';

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// 一、解析已知问题表（这是唯一事实来源）
// ---------------------------------------------------------------------------
function parseKnownIssues(md) {
  const heads = [...md.matchAll(/^## (KI-\d{3})\s+(.+)$/gm)];
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const body = md.slice(heads[i].index, i + 1 < heads.length ? heads[i + 1].index : md.length);
    // 字段值允许跨行续写（中文长句本来就会折行）。
    // ⚠️ 这里踩过两个坑，都留作反面教材：
    //   ① 只取一行 ⇒ `说明` 的第二行被静默丢掉，回复里句子断在半截；
    //   ② 用 `$` 当结尾锚点 + `m` 标志 ⇒ `$` 变成**行尾**，非贪婪匹配到第一行末就停了。
    //      必须用 `(?![\s\S])` 表示"绝对结尾"。
    const fieldRe = name =>
      new RegExp(`^- \\*\\*${name}\\*\\*:[ \\t]*([\\s\\S]*?)(?=\\n- \\*\\*|\\n## |\\n---|(?![\\s\\S]))`, 'm');
    const rawOf = name => {
      const m = fieldRe(name).exec(body);
      return m ? m[1] : '';
    };
    const f = name => {
      const lines = rawOf(name).split('\n').map(l => l.trim()).filter(Boolean);
      return lines.reduce((acc, l) => {
        if (!acc) return l;
        // 中文续行直接接上；英文续行之间补一个空格，否则会粘成一个词
        const needSpace = /[A-Za-z0-9,.;:!?]$/.test(acc) && /^[A-Za-z0-9]/.test(l);
        return acc + (needSpace ? ' ' : '') + l;
      }, '');
    };
    out.push({
      id: heads[i][1],
      title: heads[i][2].trim(),
      status: (f('状态') || '').toLowerCase(),
      version: f('版本'),
      // 可选：给了修复提交，就能被 git 验证（见 selftest F 段）——
      // 「版本号写错」是自动回复最伤人的一类错误，光靠人工核对靠不住。
      fixCommit: f('修复提交'),
      // 关键词用原始文本按「逗号/顿号/空白」切 —— 跨行写了也能分对
      keywords: rawOf('关键词').split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean),
      detail: f('说明'),
      advice: f('处理建议'),
      raw: body,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 二、分类与匹配（纯函数，可单测）
// ---------------------------------------------------------------------------
const KIND_RULES = [
  { kind: 'bug', re: /(失败|报错|错误|异常|崩溃|闪退|无法|不能用|用不了|不显示|没反应|点了没|丢了|丢失|白屏|卡住|超时|bug|error|fail|crash|broken|not work)/i },
  { kind: 'enhancement', re: /(希望|建议|能否|可以加|增加|支持|想要|需求|feature|request|would be nice|add support|improve)/i },
  { kind: 'question', re: /(如何|怎么|怎样|咨询|请问|是否支持|how (do|to)|question|什么区别)/i },
];

function classify(text) {
  for (const r of KIND_RULES) if (r.re.test(text)) return r.kind;
  return 'question';
}

/** 返回按相关度排序的命中列表（分数 ≥2 才算） */
function matchKnownIssues(issue, known) {
  const title = String(issue.title || '');
  const body = String(issue.body || '');
  const scored = [];
  for (const k of known) {
    let score = 0;
    const hits = [];
    for (const kw of k.keywords) {
      if (!kw) continue;
      const inTitle = title.toLowerCase().includes(kw.toLowerCase());
      const inBody = body.toLowerCase().includes(kw.toLowerCase());
      if (inTitle) { score += 2; hits.push(kw + '(标题)'); }
      else if (inBody) { score += 1; hits.push(kw); }
    }
    if (score >= 2) scored.push({ ...k, score, hits });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function detectLang(text) {
  const cn = (String(text).match(/[\u4e00-\u9fa5]/g) || []).length;
  // 阈值 2 而不是 6：「上传失败」只有 4 个汉字，按 6 判会被当成英文、给中文用户回英文。
  // 英文 issue 里几乎不会出现连续两个汉字，所以 2 足够安全。
  return cn >= 2 ? 'zh' : 'en';
}

// ---------------------------------------------------------------------------
// 三、回复模板（中文 / 英文）
// ---------------------------------------------------------------------------
const T = {
  zh: {
    foot: '<sub>本条回复由自动化流程生成，依据 `docs/known-issues.md` 与 `docs/review-protocol.md`。' +
      '维护者会在此基础上补充，最终结论以人工回复为准。</sub>',
    fixed: (k) => `感谢反馈。这是已知问题 **${k.id}**，已在 **${k.version || '后续版本'}** 修复。\n\n` +
      `${k.detail}\n\n**建议**：${k.advice}\n\n升级后若仍能复现，请在本楼回复「版本号 + 复现步骤」，我来重新跟进。`,
    investigating: (k) => `感谢反馈。这是已知问题 **${k.id}**，目前在处理中。\n\n` +
      `${k.detail}\n\n**现状**：${k.advice}\n\n有进展会更新在本楼；暂时不需要你做额外操作。`,
    'need-info': (k) => `感谢反馈。这个现象对应已知问题 **${k.id}**，但需要更多信息才能定位。\n\n` +
      `${k.detail}\n\n**请补充**：${k.advice}`,
    wontfix: (k) => `感谢反馈。关于 **${k.id}**：${k.detail}\n\n` +
      `这个方向本项目**有意不做**（${k.advice}）。不是遗漏，是设计取舍 —— 相关口径在 README 与 \`docs/known-issues.md\` 里有说明。`,
    genericBug: () => `感谢反馈。为了定位问题，需要以下信息（缺一项就很难推进）：\n\n` +
      `1. **应用版本**（设置页底部，或 fnOS 应用中心里显示的版本）\n` +
      `2. **设备与系统**（设备型号、fnOS 版本、用的是浏览器还是手机 App）\n` +
      `3. **复现步骤**：从哪个页面进、点了什么、期望什么、实际什么\n` +
      `4. **\`info.log\` 报错前后 10 行**（在应用数据目录下）\n\n` +
      `拿到这些就能判断是数据层、网关还是前端渲染的问题。如果方便，附一张截图会更快。`,
    genericEnhancement: () => `感谢建议。已记录为功能请求，维护者会评估。\n\n` +
      `先说明一条既定设计，可能影响你的预期：本项目**数据完全本地、不做账号与云端同步**，` +
      `定位是「同一台 NAS 上的家庭共用」。所以涉及多账号、多设备云端同步的需求，在架构上不是小改动。\n\n` +
      `如果你的需求不属于这一类，欢迎补充具体使用场景，我按场景判断优先级。`,
    genericQuestion: () => `感谢提问。\n\n` +
      `建议先看这几处，多数问题在那里有答案：\n` +
      `- \`README.md\` 的安装与使用说明\n` +
      `- \`docs/known-issues.md\` 已知问题清单\n` +
      `- \`DEPLOY_NOTES.md\` 部署与目录结构\n\n` +
      `如果看完仍未解决，请补充你的**版本号**与**具体操作步骤**，我按步骤复现。`,
  },
  en: {
    foot: '<sub>Automated reply based on `docs/known-issues.md` and `docs/review-protocol.md`. ' +
      'A maintainer will follow up; treat this as a first pass, not the final answer.</sub>',
    fixed: (k) => `Thanks for the report. This is known issue **${k.id}**, fixed in **${k.version || 'a later release'}**.\n\n` +
      `${k.detail}\n\n**Suggestion**: ${k.advice}\n\nIf it still reproduces after upgrading, reply here with your version and steps.`,
    investigating: (k) => `Thanks. This is known issue **${k.id}** and is being worked on.\n\n${k.detail}\n\n**Status**: ${k.advice}`,
    'need-info': (k) => `Thanks. This maps to known issue **${k.id}**, but more detail is needed.\n\n${k.detail}\n\n**Please provide**: ${k.advice}`,
    wontfix: (k) => `Thanks. On **${k.id}**: ${k.detail}\n\nThis is intentionally out of scope (${k.advice}).`,
    genericBug: () => `Thanks for the report. To reproduce it I need:\n\n` +
      `1. **App version** (bottom of Settings, or the fnOS App Center listing)\n` +
      `2. **Device & OS** (model, fnOS version, browser vs mobile app)\n` +
      `3. **Steps**: which page, what you clicked, expected vs actual\n` +
      `4. **10 lines around the error in \`info.log\`**\n\n` +
      `A screenshot helps too.`,
    genericEnhancement: () => `Thanks for the suggestion. Recorded as a feature request.\n\n` +
      `One design note that may affect expectations: this project stores **all data locally** with no accounts ` +
      `and no cloud sync — it is meant for family use on a single NAS. Multi-account / cloud-sync requests are ` +
      `therefore not a small change.`,
    genericQuestion: () => `Thanks for asking.\n\nMost answers are in:\n` +
      `- \`README.md\` (install & usage)\n- \`docs/known-issues.md\` (known issues)\n- \`DEPLOY_NOTES.md\` (deployment/paths)`,
  },
};

function renderReply({ issue, kind, matches, lang = 'zh' }) {
  const t = T[lang] || T.zh;
  const parts = [];

  if (matches.length) {
    const k = matches[0];
    const fn = t[k.status];
    if (typeof fn === 'function') {
      parts.push(fn(k));
    } else {
      // 状态字段写了不认识的值：不要假装知道，退回通用模板但保留编号
      parts.push((kind === 'bug' ? t.genericBug() : t.genericQuestion()) +
        `\n\n（关联条目：${k.id}，状态未知，维护者确认中）`);
    }
    if (matches.length > 1) {
      parts.push(`另外可能相关：${matches.slice(1, 3).map(m => `**${m.id}** ${m.title}`).join('；')}`);
    }
  } else {
    parts.push(kind === 'bug' ? t.genericBug() : kind === 'enhancement' ? t.genericEnhancement() : t.genericQuestion());
  }

  parts.push('---');
  parts.push(t.foot);

  return {
    body: MARKER + '\n' + parts.join('\n\n'),
    labels: [
      `kind/${kind}`,
      'triage/auto',
      ...(matches.length ? ['known-issue'] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// 四、发布
// ---------------------------------------------------------------------------
// 标签颜色来自唯一真源 tools/ci/labels.js（CS-03：列表型功能不许有第二份清单）
const { COLORS: LABEL_COLORS } = require('./labels');

async function main() {
  const known = parseKnownIssues(fs.readFileSync(KI_FILE, 'utf8'));

  // 本地模式：只用命令行给的标题/正文
  const localTitle = argOf('title');
  if (localTitle !== null) {
    const issue = { title: localTitle, body: argOf('body', '') };
    const kind = classify(issue.title + '\n' + issue.body);
    const matches = matchKnownIssues(issue, known);
    const lang = argOf('lang', detectLang(issue.title + issue.body));
    const r = renderReply({ issue, kind, matches, lang });
    if (has('json')) {
      console.log(JSON.stringify({ kind, lang, matched: matches.map(m => ({ id: m.id, score: m.score, hits: m.hits })), labels: r.labels, body: r.body }, null, 2));
    } else {
      console.log(C.dim(`分类=${kind} 语言=${lang} 命中=${matches.map(m => m.id + '(' + m.score + ')').join(',') || '无'}\n`));
      console.log(r.body);
    }
    return;
  }

  if (!TOKEN) throw new Error('缺少 GITHUB_TOKEN（本地预览请用 --title=）');
  let num = Number(process.env.ISSUE_NUMBER || 0);
  if (!num && process.env.GITHUB_EVENT_PATH) {
    const p = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    num = p.issue?.number || p.pull_request?.number || p.number || 0;
  }
  if (!num) throw new Error('拿不到 issue 号');

  const gh = makeClient({ token: TOKEN, repo: REPO });

  // 幂等：已经回过就不再刷一遍（人手动 /triage 时才强制重发）
  const force = has('force') || process.env.PJ_FORCE_TRIAGE === '1';
  if (!force) {
    const comments = await gh.paginate(`/repos/${REPO}/issues/${num}/comments`);
    if (comments.some(c => (c.body || '').includes(MARKER))) {
      console.log(C.dim(`#${num} 已经回过，跳过（要重发用 --force）`));
      return;
    }
  }

  const issue = await gh.request('GET', `/repos/${REPO}/issues/${num}`);
  const text = `${issue.title}\n${issue.body || ''}`;
  const kind = classify(text);
  const matches = matchKnownIssues({ title: issue.title, body: issue.body || '' }, known);
  const lang = detectLang(text);
  const r = renderReply({ issue, kind, matches, lang });

  await gh.request('POST', `/repos/${REPO}/issues/${num}/comments`, { body: { body: r.body } });

  // 打标签：先确保存在
  for (const name of r.labels) {
    try {
      await gh.request('POST', `/repos/${REPO}/labels`, {
        body: { name, color: LABEL_COLORS[name] || 'ededed', description: 'pj-bot 自动分类' },
      });
    } catch (e) { /* 已存在 */ }
  }
  try {
    await gh.request('POST', `/repos/${REPO}/issues/${num}/labels`, { body: { labels: r.labels } });
  } catch (e) {
    console.log(C.yellow(`  标签未加上（${e.message}）`));
  }

  console.log(C.green(`✅ #${num} 已回复（${kind}/${lang}${matches.length ? '，命中 ' + matches[0].id : ''}）`));
}

module.exports = { parseKnownIssues, classify, matchKnownIssues, renderReply, detectLang, MARKER };

if (require.main === module) {
  main().catch(e => {
    console.error(C.red('issue 回复器出错：' + e.stack));
    process.exit(1);
  });
}
