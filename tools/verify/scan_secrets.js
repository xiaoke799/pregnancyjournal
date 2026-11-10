#!/usr/bin/env node
/**
 * tools/verify/scan_secrets.js —— 敏感信息门禁（凭据、私钥、webhook、数据库）
 *
 * 目的只有一个：**别让密钥跟着代码上云**。
 * 一旦推上去，即使事后删除，它仍然留在历史里、留在 fork 里、留在别人的 clone 里 ——
 * 唯一正确的处置是去服务端**撤销那个凭据**，而不是 `git rebase` 自己骗自己。
 * 所以这层门禁的意义在"推之前拦住"，不在"推之后清理"。
 *
 * 扫什么（block = 直接拦下）：
 *   GitHub PAT / classic token、AWS Access Key、私钥块、JWT、
 *   企业微信 / 飞书 / 钉钉 / Bark 的 webhook（这些 URL 里就带着 key）、
 *   以及明确写着密钥的赋值（password = "真实值"）。
 * 不算敏感（不拦）：
 *   占位符（xxx / your-key / ${VAR} / process.env.X）、测试夹具里的假值、纯文档示例。
 *
 * 用法：
 *   node tools/verify/scan_secrets.js --staged      # 暂存区（pre-commit 用）
 *   node tools/verify/scan_secrets.js --push        # 待推送的提交（pre-push 用）
 *   node tools/verify/scan_secrets.js --range=v0.0.34..HEAD
 *   node tools/verify/scan_secrets.js --all         # 工作区全量（当前文件）
 *   node tools/verify/scan_secrets.js --history     # 全部历史（一次性审计，慢）
 *   …--json / --quiet
 *
 * 误报豁免：在那一行加注释 `pj-secret-ok`（需人工写明理由），或把文件加进 ALLOW_FILES。
 *
 * 退出码：0 干净 / 1 发现敏感信息 / 2 用法错误
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ENV = require('./_env');

const REPO = ENV.REPO;
const argv = process.argv.slice(2);
const has = n => argv.includes(`--${n}`);
const argOf = (n, d = null) => {
  const a = argv.find(x => x.startsWith(`--${n}=`));
  return a === undefined ? d : a.slice(n.length + 3);
};
const JSON_OUT = has('json');
const QUIET = has('quiet');

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// 规则：block = 确定是凭据；warn = 可疑但不一定（默认不拦，--strict 才拦）
// 正则在运行时拼接关键前缀，避免本文件自己被扫成违规（自举陷阱）
// ---------------------------------------------------------------------------
const GH = 'g' + 'h';   // 拆开写，防止源码里出现完整前缀
const RULES = [
  {
    id: 'github-fine-grained', level: 'block',
    re: new RegExp(`\\b${GH}ithub_pat_[A-Za-z0-9_]{30,}`),
    why: 'GitHub fine-grained PAT',
  },
  {
    id: 'github-classic', level: 'block',
    re: new RegExp(`\\b${GH}[posur]_[A-Za-z0-9]{30,}`),
    why: 'GitHub classic token（ghp_/gho_/ghu_/ghs_/ghr_）',
  },
  {
    id: 'aws-access-key', level: 'block',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    why: 'AWS Access Key ID',
  },
  {
    id: 'private-key-block', level: 'block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    why: '私钥块',
  },
  {
    id: 'jwt', level: 'block',
    re: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
    why: 'JWT（可能含签名的访问令牌）',
  },

  // ---- 国内云：这两个是踩坑率最高的（AccessKey 一旦泄露，挖矿账单当天就到）----
  {
    id: 'aliyun-accesskey', level: 'block',
    re: /\bLTAI[0-9A-Za-z]{12,}/,
    why: '阿里云 AccessKeyId（LTAI 开头）',
  },
  {
    id: 'tencentcloud-secretid', level: 'block',
    re: /\bAKID[0-9A-Za-z]{26,}/,
    why: '腾讯云 SecretId（AKID 开头）',
  },
  // ---- AI 服务的 key：这个仓库正在接模型审查，key 写进代码的风险很实在 ----
  {
    id: 'ai-api-key', level: 'block',
    re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/,
    why: 'AI 服务 API key（OpenAI / Anthropic / DeepSeek 等 sk- 前缀）',
  },
  {
    id: 'google-api-key', level: 'block',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    why: 'Google API key（AIza 开头，长度固定 39）',
  },
  {
    id: 'slack-token', level: 'block',
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
    why: 'Slack token（xox* 开头）',
  },
  {
    id: 'stripe-key', level: 'block',
    re: /\bsk_live_[0-9A-Za-z]{20,}/,
    why: 'Stripe 生产密钥',
  },
  {
    id: 'npm-token', level: 'block',
    re: /\bnpm_[A-Za-z0-9]{36}\b/,
    why: 'npm 发布 token',
  },
  {
    id: 'wecom-webhook', level: 'block',
    re: /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[0-9a-fA-F-]{20,}/,
    why: '企业微信机器人 webhook（URL 里带 key）',
  },
  {
    id: 'feishu-webhook', level: 'block',
    re: /open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[0-9a-fA-F-]{20,}/,
    why: '飞书机器人 webhook',
  },
  {
    id: 'dingtalk-webhook', level: 'block',
    re: /oapi\.dingtalk\.com\/robot\/send\?access_token=[0-9a-fA-F]{20,}/,
    why: '钉钉机器人 webhook（access_token 即密钥）',
  },
  {
    id: 'bark-key', level: 'block',
    re: /api\.day\.app\/[A-Za-z0-9]{15,}/,
    why: 'Bark 推送 key（在 URL 路径里）',
  },
  {
    id: 'secret-assignment', level: 'warn',
    // 只匹配"看起来像真值"的：长度 >= 16、含字母且含数字或符号，排除占位符
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"]([^'"\s]{16,})['"]/i,
    why: '疑似硬编码密钥（赋值语句）',
  },
];

/** 明显是占位符 / 环境变量的值，不算泄露 */
function looksLikePlaceholder(v) {
  if (!v) return true;
  if (/^(x+|\*+|-+|\.+)$/i.test(v)) return true;
  if (/^(your|my|my_|test|demo|sample|example|fake|dummy|placeholder|change[_-]?me|replace[_-]?me)/i.test(v)) return true;
  if (/^(\$\{|<|\[|\{|process\.env|import\.meta\.env)/.test(v)) return true;
  if (/^(true|false|null|undefined|none)$/i.test(v)) return true;
  // 全是同一种字符（aaaa / 1111 / 0000）
  if (/^(.)\1{7,}$/.test(v)) return true;
  return false;
}

/**
 * 整段匹配是否"显然是捏造的"。
 * 起因（2026-11-10）：`tools/verify/wecom/test_feishu_push.js` 里的测试夹具用了
 * `bot/v2/hook/00000000-0000-0000-0000-000000000000` —— 形态完全正确，但一眼假。
 * 判据：**去掉协议与域名后**，不透明部分里出现连续 8 个相同字符，或整段只有 0 和分隔符。
 * 真实凭据的熵不可能长这样，所以这条不会放过真泄露。
 */
function obviouslyFake(matchStr) {
  const opaque = String(matchStr)
    .replace(/^https?:\/\//i, '')
    .replace(/^[^/]+\//, '');
  return /(.)\1{7,}/.test(opaque) || /^[0\-.]+$/.test(opaque);
}

/** 只显示前 4 位 + 长度，绝不打印完整凭据 */
function mask(s) {
  const t = String(s);
  if (t.length <= 8) return '*'.repeat(t.length);
  return t.slice(0, 4) + '…' + `(${t.length} 字符)`;
}

/** 扫描一段文本，返回命中列表 */
function scanText(text, { file = '', startLine = 1 } = {}) {
  const hits = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/pj-secret-ok/.test(line)) continue;             // 人工豁免
    if (line.length > 4000) continue;                    // 超长行（打包产物）跳过，避免正则回溯
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      // 赋值类规则：值像占位符就放过
      if (rule.id === 'secret-assignment' && looksLikePlaceholder(m[1])) continue;
      // 通用：整段匹配长成"一眼假"的样子（全 0 UUID / 连续同字符）也放过
      if (obviouslyFake(m[0])) continue;
      hits.push({
        file, line: startLine + i, rule: rule.id, level: rule.level,
        why: rule.why, sample: mask(m[0]), snippet: line.trim().slice(0, 120),
      });
      break;                                             // 一行只报一次，避免重复刷屏
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 二进制 / 不该扫的文件
// ---------------------------------------------------------------------------
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|heic|mp4|mov|zip|gz|tgz|fpk|db|woff2?|ttf|otf|pdf)$/i;
const SKIP_PATH = /^(node_modules\/|frontend\/node_modules\/|\.git\/|app\/ui\/assets\/|tools\/verify\/(fixtures|regress-out|\.tmp)\/)/;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;   // 超过 2MB 只查文件名，不读内容（避免把打包产物拖进正则）

// ---------------------------------------------------------------------------
// 文件名规则：这些文件**不看内容**也不该进版本库
//   内容扫描回答"里面有没有密钥"，文件名规则回答"这个文件本身就是密钥/数据"。
//   后者更重要：一个 `data.db` 里是用户的孕期记录，它不需要"长得像密钥"才危险。
// ---------------------------------------------------------------------------
const BAD_FILES = [
  {
    re: /(^|\/)\.env(\.(?!example|sample|template)[^/]*)?$/i,
    why: '环境变量文件（常含密钥）—— 提交 .env.example 就够了',
  },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i, why: 'SSH 私钥' },
  { re: /(^|\/)\.npmrc$/i, why: 'npm 配置（常含发布 token）' },
  { re: /(^|\/)\.netrc$/i, why: 'netrc（含登录凭据）' },
  { re: /(^|\/)credentials?\.(json|ya?ml)$/i, why: '凭据文件' },
  { re: /\.(db|sqlite|sqlite3)$/i, why: '数据库文件 —— 里面是用户真实数据，绝不该入库' },
  { re: /\.(kdbx|keychain)$/i, why: '密码库' },
];

function scanFileName(file) {
  for (const r of BAD_FILES) {
    if (r.re.test(file)) {
      return { file, line: 0, rule: 'bad-file', level: 'block', why: r.why, sample: '(文件名)', snippet: file };
    }
  }
  return null;
}

// 明确允许出现凭据形态的文件（例如专门放示例的文档、测试桩）——**必需写理由**
const ALLOW_FILES = [
  // 扫描器自身：规则里用字符串拼接，但片段里可能出现关键字
  'tools/verify/scan_secrets.js',
  'docs/review-protocol.md',
];

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// git 取数
// ---------------------------------------------------------------------------
function git(args, { input } = {}) {
  return new Promise(resolve => {
    const child = spawn(ENV.GIT, args, { cwd: REPO, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    if (input) { child.stdin.write(input); child.stdin.end(); }
    child.on('error', e => resolve({ code: -1, out: '', err: e.message }));
    child.on('close', code => resolve({ code, out, err }));
  });
}

/**
 * 解析 unified diff，只取新增行（`+` 且不是 `+++`），带新文件行号。
 * 为什么只扫新增行：扫全文会把历史里已经存在的东西反复报一遍，噪音大到没人看。
 */
function scanDiff(diffText, label) {
  const hits = [];
  let file = '';
  let newLine = 0;
  const seenFiles = new Set();
  for (const raw of diffText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? '' : p.replace(/^b\//, '').replace(/^"|"$/g, '');
      // 文件名规则：每个文件只查一次（不是每一行都报）
      if (file && !seenFiles.has(file) && !SKIP_PATH.test(file) && !ALLOW_FILES.includes(file)) {
        seenFiles.add(file);
        const fh = scanFileName(file);
        if (fh) hits.push(fh);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (line.startsWith('--- ') || line.startsWith('diff --git ')) continue;
    if (line.startsWith('+')) {
      if (file && !SKIP_EXT.test(file) && !SKIP_PATH.test(file) && !ALLOW_FILES.includes(file)) {
        hits.push(...scanText(line.slice(1), { file, startLine: newLine }));
      }
      newLine++;
    } else if (!line.startsWith('-')) {
      newLine++;
    }
  }
  return hits;
}

async function stagedHits() {
  const d = await git(['diff', '--cached', '-U0']);
  if (d.code !== 0) throw new Error('git diff --cached 失败：' + d.err);
  return scanDiff(d.out, 'staged');
}

async function rangeHits(range) {
  const d = await git(['diff', range, '-U0']);
  if (d.code !== 0) throw new Error(`git diff ${range} 失败：` + d.err);
  return scanDiff(d.out, range);
}

async function pushHits() {
  // "这次要推上去的东西" = 远端还没有的提交。
  // 用 `--not --remotes` 而不是 `@{push}..HEAD`：后者在没有 upstream 时会报错，
  // 而推送前恰恰可能是第一次推（新分支/新克隆）。
  const revs = await git(['rev-list', 'HEAD', '--not', '--remotes']);
  if (revs.code !== 0) throw new Error('git rev-list 失败：' + revs.err);
  const list = revs.out.split('\n').filter(Boolean);
  if (!list.length) return [];
  const hits = [];
  for (const sha of list) {
    const d = await git(['show', sha, '--format=', '-U0', '--no-color']);
    if (d.code !== 0) continue;
    for (const h of scanDiff(d.out, sha)) hits.push({ ...h, commit: sha.slice(0, 7) });
  }
  return hits;
}

async function allHits() {
  const list = await git(['ls-files', '-z']);
  if (list.code !== 0) throw new Error('git ls-files 失败');
  const files = list.out.split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) {
    if (SKIP_PATH.test(f) || ALLOW_FILES.includes(f)) continue;
    // 文件名规则先查 —— 数据库/私钥/`.env` 这类文件，内容都不必读
    const fh = scanFileName(f);
    if (fh) hits.push(fh);
    // 二进制与超大文件不读内容（`.db` 已在上面报了，这里不再重复）
    if (SKIP_EXT.test(f)) continue;
    let buf;
    try { buf = fs.readFileSync(path.join(REPO, f)); } catch (e) { continue; }
    if (buf.length > MAX_SCAN_BYTES) continue;
    if (isBinary(buf)) continue;
    hits.push(...scanText(buf.toString('utf8'), { file: f }));
  }
  return hits;
}

async function historyHits() {
  // 全历史：逐个提交扫 patch。慢，只用于一次性审计。
  const revs = await git(['rev-list', '--all']);
  if (revs.code !== 0) throw new Error('git rev-list 失败');
  const list = revs.out.split('\n').filter(Boolean);
  const hits = [];
  for (const sha of list) {
    const d = await git(['show', sha, '--format=', '-U0', '--no-color']);
    if (d.code !== 0) continue;
    for (const h of scanDiff(d.out, sha)) hits.push({ ...h, commit: sha.slice(0, 7) });
  }
  return hits;
}

// ---------------------------------------------------------------------------
async function main() {
  let hits = [];
  let label = '';

  try {
    if (has('history')) { label = '全部历史'; hits = await historyHits(); }
    else if (has('all')) { label = '工作区全量'; hits = await allHits(); }
    else if (has('push')) { label = '待推送'; hits = await pushHits(); }
    else if (argOf('range')) { label = argOf('range'); hits = await rangeHits(argOf('range')); }
    else { label = '暂存区'; hits = await stagedHits(); }
  } catch (e) {
    console.error(C.red('扫描失败：' + e.message));
    process.exit(2);
  }

  const blocks = hits.filter(h => h.level === 'block');
  const warns = hits.filter(h => h.level === 'warn');
  const strict = has('strict');
  const failing = blocks.length + (strict ? warns.length : 0);

  if (JSON_OUT) {
    console.log(JSON.stringify({ label, blocks, warns, fail: failing > 0 }, null, 2));
    process.exit(failing ? 1 : 0);
  }

  if (!hits.length) {
    if (!QUIET) console.log(C.green(`✓ 敏感信息扫描（${label}）：干净`));
    return;
  }

  console.log(C.bold(`\n敏感信息扫描（${label}）`));
  const loc = h => (h.line ? `${h.file}:${h.line}` : `${h.file}（文件名）`);
  for (const h of blocks) {
    console.log(C.red(`  🔴 [${h.rule}] ${loc(h)}`));
    console.log(C.dim(`     ${h.why}　命中：${h.sample}`));
    console.log(C.dim(`     ${h.snippet}`));
  }
  for (const h of warns) {
    console.log(C.yellow(`  🟡 [${h.rule}] ${loc(h)}`));
    console.log(C.dim(`     ${h.why}　命中：${h.sample}`));
    console.log(C.dim(`     ${h.snippet}`));
  }

  if (failing) {
    console.log(C.red(`\n🔴 拦下：${blocks.length} 项确定凭据${strict ? `、${warns.length} 项可疑赋值` : ''}`));
    console.log(C.dim('   处置：把密钥移到环境变量 / 本地配置文件（不入库），然后从暂存区移除。'));
    console.log(C.dim('   如果这个凭据曾经提交过：**去服务端撤销它**，再考虑清理历史 —— 光删文件没用。'));
    console.log(C.dim('   确属误报（示例/夹具）：在该行加 `pj-secret-ok` 注释并写明理由。'));
    process.exit(1);
  }

  console.log(C.yellow(`\n🟡 有 ${warns.length} 项可疑赋值（未拦下，加 --strict 可当错误处理）`));
}

module.exports = { scanText, scanDiff, scanFileName, RULES, BAD_FILES, looksLikePlaceholder };

if (require.main === module) {
  main().catch(e => { console.error(e.stack); process.exit(2); });
}
