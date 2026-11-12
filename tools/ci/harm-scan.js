#!/usr/bin/env node
/**
 * tools/ci/harm-scan.js —— PR 的「伤害面」先行扫描（只看新增行，纯函数）
 *
 * 借鉴自 magpie 的 docs/contributors.md「Look for harm first」：
 *   在审 PR 做了什么之前，先找有没有越过声明目标的东西 —— 新的网络地址、
 *   上传/遥测、凭据外发、运行时从字符串构造代码、大段编码 blob、新依赖。
 *   命中就停下让人看，而不是让模型去判断"这段代码好不好"。
 *
 * 与 tools/verify/scan_secrets.js 的分工：
 *   scan_secrets 找**凭据形态**（PAT / 私钥 / webhook key）；
 *   harm-scan 找**行为面**（数据会不会去新地方、代码会不会动态执行）。
 *   两者可以同一行都命中，不冲突。
 *
 * 口径：宁可让人多点一次「确认没问题」，也不要漏掉一次外发。
 * 所以这里只做白名单豁免（内网/示例/代码托管），不做"看起来安全"的智能判断。
 */
'use strict';

/** 这些主机不算"新外发面"；其余一律要人确认 */
const ALLOW_HOST = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /(^|\.)github\.com$/i,
  /(^|\.)githubusercontent\.com$/i,
  /^example\.(com|org|net)$/i,
  /^\[?[fF][eE]80::/,            // IPv6 link-local
];

const RULES = [
  {
    code: 'dynamic-exec',
    why: '运行时从字符串构造/执行代码',
    re: /\b(eval|new\s+Function|Function\s*\(|vm\.runIn\w*|setTimeout\s*\(\s*['"`])/,
  },
  {
    code: 'encoded-blob',
    why: '新增大段 base64 / hex 编码内容（无法审阅的二进制）',
    re: /[A-Za-z0-9+/=]{240,}/,
  },
  {
    code: 'credential-egress',
    why: '疑似把凭据/令牌放进外发请求',
    re: /(?:authorization|bearer|x-api-key|cookie)\s*[:=]\s*['"`]?[^'"`\s]*\$\{?|body\s*:\s*JSON\.stringify\([^)]*(?:token|secret|password)/i,
  },
];

const DEP_FILES = /(^|\/)(package\.json|go\.mod|requirements\.txt|pyproject\.toml|Cargo\.toml)$/i;
const NEW_DEP_RE = /^\s*\+?\s*(?:"[^"]+"|[a-zA-Z0-9_./-]+)\s*[:=]\s*["']?[\^~]?\d/;

function isAllowedHost(host) {
  const h = String(host || '').split(':')[0].replace(/^\[|\]$/g, '');
  return ALLOW_HOST.some(re => re.test(h));
}

/**
 * @param {string} diffText unified diff
 * @returns {Array<{code,why,file,line,sample}>} 去重、限量的命中
 */
function scanHarm(diffText) {
  const flags = [];
  const seen = new Set();
  let file = '';
  let lineNo = 0;

  const add = (code, why, text) => {
    const key = `${file}|${code}`;
    if (seen.has(key)) return;             // 同一文件同一类只报一次，避免刷屏
    seen.add(key);
    flags.push({
      code, why, file, line: lineNo,
      sample: String(text).trim().slice(0, 120),
    });
  };

  for (const raw of String(diffText || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? '' : p.replace(/^b\//, '').replace(/^"|"$/g, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    const text = line.slice(1);
    // 纯注释/文档行里的 URL 不报（多是指向文档的链接，噪音太大）
    const skip = /^\s*(\/\/|\/\*|\*|#|<!--|>|\[.*\]\()/.test(text);
    if (!skip) {
      for (const m of text.matchAll(/https?:\/\/([^\s'"`)\]}>]+)/gi)) {
        const host = m[1].split('/')[0];
        if (!isAllowedHost(host)) add('external-endpoint', '新增外部网络地址', m[0]);
      }
      for (const r of RULES) {
        if (r.re.test(text)) add(r.code, r.why, text);
      }
      if (DEP_FILES.test(file) && NEW_DEP_RE.test(text)) {
        add('new-dependency', '新增依赖（供应链面）', text);
      }
    }
    lineNo++;
    if (flags.length >= 12) break;
  }
  return flags;
}

module.exports = { scanHarm, isAllowedHost, ALLOW_HOST, RULES };
