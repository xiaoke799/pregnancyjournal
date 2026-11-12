#!/usr/bin/env node
/**
 * tools/ci/labels.js —— 仓库标签的**唯一真源**
 *
 * 为什么抽出来：标签定义原先散在三处 ——
 *   `pr-review.js` 的结论标签 + 颜色、`issue-triage.js` 的 LABEL_COLORS、
 *   `security-audit.yml` 里 `gh label create security`。
 *   三处各自写色号，改一处忘两处是必然的（CS-03：列表型功能必须有唯一真源）。
 *
 * `owner` 字段是**安全语义**，不是文档：
 *   - `human`  ⇒ 只有人能打，机器人**绝不自动添加**（`automerge` 是自动合并的授权载体）
 *   - `bot`    ⇒ 机器人可以创建/添加
 * bootstrap-labels.js 会遵守 owner，selftest 有断言盯着 `automerge.owner === 'human'`。
 *
 * 用法：
 *   const { LABELS, COLORS, VERDICT_LABELS, HUMAN_ONLY } = require('./labels');
 */
'use strict';

const LABELS = {
  // ---- 审查结论（机器人打）----
  'review:pass': {
    color: '0e8a16', owner: 'bot',
    desc: '审查通过：硬检查与模型层均无阻断项（pj-bot）',
  },
  'review:changes': {
    color: 'd93f0b', owner: 'bot',
    desc: '审查有阻断项，需要修改（pj-bot）',
  },
  'review:needs-human': {
    color: 'fbca04', owner: 'bot',
    desc: '含高危路径或超出自动判定范围，需人工过一遍（pj-bot）',
  },

  // ---- 自动合并授权（🔴 只有人能打）----
  'automerge': {
    color: '5319e7', owner: 'human',
    desc: '人工授权自动合并 —— 机器人不得自动添加；打上标签前请确认审查已过',
  },

  // ---- issue 分类（机器人打）----
  'kind/bug': { color: 'd73a4a', owner: 'bot', desc: '缺陷报告（pj-bot 自动分类）' },
  'kind/enhancement': { color: 'a2eeef', owner: 'bot', desc: '功能建议（pj-bot 自动分类）' },
  'kind/question': { color: 'd876e3', owner: 'bot', desc: '使用咨询（pj-bot 自动分类）' },
  'triage/auto': { color: 'ededed', owner: 'bot', desc: '由机器人完成的首次分类' },
  'known-issue': { color: 'fbca04', owner: 'bot', desc: '命中已知问题表' },

  // ---- 安全审计 ----
  'security': { color: 'b60205', owner: 'bot', desc: '每周全历史密钥审计发现（定时 workflow）' },
};

/** 审查结论 → 该加谁、该删谁（与 pr-review 的 verdict 一一对应） */
const VERDICT_LABELS = {
  pass: { add: 'review:pass', remove: ['review:changes', 'review:needs-human'] },
  changes: { add: 'review:changes', remove: ['review:pass', 'review:needs-human'] },
  'needs-human': { add: 'review:needs-human', remove: ['review:pass', 'review:changes'] },
};

/** 兼容旧代码：{ name: color } */
const COLORS = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, v.color]));

/** 只有人能打的标签 —— 机器人任何路径都不得创建或添加 */
const HUMAN_ONLY = Object.keys(LABELS).filter(k => LABELS[k].owner === 'human');

module.exports = { LABELS, COLORS, VERDICT_LABELS, HUMAN_ONLY };
