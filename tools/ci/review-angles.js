#!/usr/bin/env node
/**
 * tools/ci/review-angles.js —— 多角度审查的角度表与纯函数
 *
 * 为什么要单独一个模块：
 *   pr-review.js 的 main 是立即执行的 IIFE，直接 require 会触发一次真实审查。
 *   把可测的纯计算抽出来，selftest 才能离线验证"角度归类"和"多轮对比"，
 *   又不用改 main 的结构。
 *
 * 为什么按 code 映射角度，而不是让每个检查点自己填：
 *   11 个硬检查散落在 hardChecks 各处，让调用点各自填角度迟早漏填/填错
 *   （CS-03：列表型功能必须有唯一真源）。
 */
'use strict';

const ANGLES = [
  { id: 'correctness', emoji: '🧠', label: '正确性 / 逻辑',
    focus: '边界条件、状态流转、时区口径、取值域、平行清单是否同步' },
  { id: 'security', emoji: '🔒', label: '安全',
    focus: '高危路径、密钥泄露、越权、注入面、fork PR 的可写边界' },
  { id: 'regression', emoji: '🧪', label: '回归覆盖',
    focus: '必跑套件、护栏与反例、新增代码有没有断言、没有规则覆盖的改动' },
  { id: 'consistency', emoji: '📋', label: '文档与一致性',
    focus: '版本号、CHANGELOG、提交信息、规则表与文档是否同步' },
  { id: 'hygiene', emoji: '🧹', label: '仓库卫生 / 资源',
    focus: '构建产物与日志混入、改动规模、文件分散度、依赖膨胀' },
  { id: 'discussion', emoji: '💬', label: '已有讨论',
    focus: 'PR 已有评论、上轮审查结论、多轮之间哪些问题已解决/新出现' },
];

const ANGLE_IDS = new Set(ANGLES.map(a => a.id));

/** 硬检查 code → 角度。未登记的默认归「正确性 / 逻辑」。 */
const CODE_ANGLE = {
  'empty-diff': 'correctness',
  'high-risk-path': 'security',
  'secret-leak': 'security',
  'secret-scan-skipped': 'security',
  'commit-message': 'consistency',
  'diff-size': 'hygiene',
  'many-files': 'hygiene',
  'artifact-commit': 'hygiene',
  'no-test-touch': 'regression',
  'uncovered': 'regression',
  'sibling-leftover': 'correctness',
  'discussion-summary': 'discussion',
  'round-changes': 'discussion',
};

function angleOf(code) {
  return CODE_ANGLE[code] || 'correctness';
}

/** 把一组发现按角度分组；未知角度一律落到 correctness，不静默丢掉。 */
function groupByAngle(items) {
  const out = new Map(ANGLES.map(a => [a.id, []]));
  for (const it of items || []) {
    const id = ANGLE_IDS.has(it.angle) ? it.angle : 'correctness';
    out.get(id).push(it);
  }
  return out;
}

/**
 * 多轮对比：上一轮报告里标记过的 code 与本次对比。
 * 首轮（prev 为空）不算"全部新增"，避免把正常审查说成一堆新问题。
 */
function compareRounds(prevCodes, currentCodes) {
  const prev = new Set(prevCodes || []);
  const cur = new Set(currentCodes || []);
  return {
    first: prev.size === 0,
    resolved: [...prev].filter(c => !cur.has(c)),
    added: [...cur].filter(c => !prev.has(c)),
    persistent: [...cur].filter(c => prev.has(c)),
  };
}

/** 模型返回的 issues 形状 ≠ 硬检查的，统一成可分组的形状。 */
function normalizeAiIssues(issues) {
  return (issues || []).map(i => ({
    angle: ANGLE_IDS.has(i.angle) ? i.angle : 'correctness',
    severity: i.severity || 'nit',
    title: String(i.file || '(未指明文件)'),
    detail: String(i.why || '').slice(0, 300),
    hint: [
      i.evidence ? '证据：' + String(i.evidence).replace(/`/g, "'").slice(0, 200) : '',
      i.fix ? '建议：' + String(i.fix).slice(0, 300) : '',
    ].filter(Boolean).join('；'),
    source: 'ai',
  }));
}

module.exports = { ANGLES, ANGLE_IDS, CODE_ANGLE, angleOf, groupByAngle, compareRounds, normalizeAiIssues };
