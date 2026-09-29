// 测试 #19：app/ui/index.cgi 是否真正转发请求体
//
// 手法：用「假 curl」替换 PATH 里的 curl，让它把收到的 argv 和 stdin 落盘。
//   关键细节：假 curl **只在参数里出现 --data-binary/@- 时才读 stdin**——
//   否则它自己会读走 stdin，旧代码也会「看起来转发了 body」，变成假绿。
//
// 被测代码不是重写的：直接从真实的 app/ui/index.cgi 里**原样截取**「Query 字符串」
// 那行到文件末尾的片段来跑（前面的 socket 等待逻辑本机无法复现：Windows 上拿不到
// Unix Socket，`[ -S ]` 恒为假）。旧版本用同一套 harness 跑一遍作为反例。
//
// ⚠️ 本文件必须用**异步 spawn**：本机沙箱下 `spawnSync(任意 exe)` 一律返回 EBUSY
//   （子进程创建被 broker 拦；`node -e` 里实测 spawnSync bash.exe / git.exe 都是 EBUSY），
//   而异步 spawn 正常。原先用 spawnSync 的版本在这台机器上 R2 全红、R4 直接 ENOENT 崩掉，
//   连 R3 的反例都被静默跳过 —— 等于这个测试从来没真正跑起来过。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = require('./_env').REPO;
const CGI = path.join(REPO, 'app/ui/index.cgi');
const BASE = require('./_env').TMP;
const TMP = path.join(BASE, 'tmp_r');
const FAKEBIN = path.join(TMP, 'fakebin');
const BASH = require('./_env').BASH;

// 反例来源（固定的「修复前」版本）。这里用 **tag 名**而不是提交号：
// tag 名在本仓库历史被重写（filter-branch + force-push）之后依然有效，提交号会直接查不到。
// v0.0.30 是本次修复前的最后一个发布版本，其 app/ui/index.cgi 确实没有 `--data-binary`。
// （原先写 `HEAD` —— 一旦提交修复，反例会退化成"取到的是新版"，而代码里已经先断言
//   「旧版本确实没有 --data-binary」，于是要么误报要么被静默跳过。）
const OLD_REFS = ['v0.0.30', 'HEAD'];

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/** 异步 spawn：可选地把 input 写进 stdin，收集 stdout/stderr。绝不 throw。 */
function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    } catch (e) {
      return resolve({ status: null, stdout: '', stderr: '', spawnError: e.message });
    }
    let stdout = '', stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d; });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ status: null, stdout, stderr, spawnError: e.message }));
    child.on('close', (code) => resolve({ status: code, stdout, stderr }));
    // ⚠️ 必须显式 end()：片段里的（假）curl 会读 stdin，不关就永远等不到 EOF，
    //    子进程不退出 → 整个测试挂死。
    if (child.stdin) child.stdin.end(opts.input === undefined ? '' : opts.input);
  });
}

/** 取某个提交里的 index.cgi 原文；取不到返回 null（不抛错）。 */
async function gitShow(ref) {
  const r = await spawnAsync('git', ['show', `${ref}:app/ui/index.cgi`], { cwd: REPO });
  if (r.spawnError || r.status !== 0 || !r.stdout) return null;
  return r.stdout;
}

// ---- 假 curl ----
const fakeCurlPath = path.join(FAKEBIN, 'curl');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(FAKEBIN, { recursive: true });
fs.writeFileSync(fakeCurlPath, `#!/bin/bash
printf '%s\\n' "$@" > "$CAPTURE_ARGV"
has_data=0
for a in "$@"; do
  case "$a" in
    --data-binary|--data|--data-raw|-d|@-) has_data=1 ;;
  esac
done
if [ "$has_data" = "1" ]; then
  cat > "$CAPTURE_BODY"
else
  : > "$CAPTURE_BODY"
fi
printf 'Content-Type: application/json\\r\\n\\r\\n{"code":0}'
`);
// MSYS/Git-Bash 下要从 PATH 里直接执行，必须有可执行位
try { fs.chmodSync(fakeCurlPath, 0o755); } catch (e) { console.log('chmod 假 curl 失败:', e.message); }

// 锚点选在「路径解析」之前，这样 REL_PATH / TARGET_URL / curl 调用都在片段里，
// 与真实脚本走的完全是同一段逻辑（只有前面的 socket 等待被 harness 替代）。
const ANCHOR = '# 从 REQUEST_URI 提取路径';
function snippetOf(src, label) {
  const i = src.indexOf(ANCHOR);
  if (i < 0) throw new Error(`${label} 中找不到锚点「${ANCHOR}」`);
  return '# --- harness 预置 ---\nCURL_OPTS="--unix-socket /tmp/nonexistent"\nBASE_URL="http://localhost"\n\n'
    + src.slice(i);
}

const BODY = JSON.stringify({ pregnancy_id: 'pg1', date: '2026-09-28', items: [1, 2, 3] });

async function runSnippet(snippet, tag, envExtra, input) {
  const shFile = path.join(TMP, `snippet_${tag}.sh`);
  fs.writeFileSync(shFile, snippet);
  const argvFile = path.join(TMP, `argv_${tag}.txt`);
  const bodyFile = path.join(TMP, `body_${tag}.txt`);
  const env = {
    ...process.env,
    PATH: `${FAKEBIN}:${process.env.PATH}`,
    CAPTURE_ARGV: argvFile.replace(/\\/g, '/'),
    CAPTURE_BODY: bodyFile.replace(/\\/g, '/'),
    REMOTE_ADDR: '127.0.0.1',
    ...envExtra,
  };
  const r = await spawnAsync(BASH, [shFile.replace(/\\/g, '/')], { env, input });
  return {
    status: r.status,
    spawnError: r.spawnError,
    stderr: r.stderr || '',
    stdout: r.stdout || '',
    argv: fs.existsSync(argvFile) ? fs.readFileSync(argvFile, 'utf8') : '',
    body: fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '',
  };
}

(async () => {
  try {
    console.log('=== R1：静态断言——真实 index.cgi 的 curl 调用带上了 body 参数 ===');
    const cur = fs.readFileSync(CGI, 'utf8');
    ok(/--data-binary @-/.test(cur), 'index.cgi 出现了 --data-binary @-');
    ok(!/CONTENT_LENGTH:?\+?-H "Content-Length/.test(cur), '不再手动传 Content-Length（交给 curl 自己算）');
    ok(cur.indexOf('# ---- 请求体转发 ----') >= 0, '存在「请求体转发」说明段落');

    console.log('=== R2：跑真实片段——POST body 必须被转发 ===');
    const rNew = await runSnippet(snippetOf(cur, 'new'), 'new', {
      REQUEST_URI: '/cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1/habit-checkins',
      REQUEST_METHOD: 'POST',
      CONTENT_TYPE: 'application/json',
      CONTENT_LENGTH: String(Buffer.byteLength(BODY)),
    }, BODY);
    if (rNew.status !== 0 || !rNew.argv) {
      console.log('  [诊断] status=' + rNew.status + ' spawnError=' + JSON.stringify(rNew.spawnError || null)
        + ' stderr=' + JSON.stringify(rNew.stderr.slice(0, 500))
        + ' stdout=' + JSON.stringify(rNew.stdout.slice(0, 200)));
    }
    ok(!rNew.spawnError, '子进程能正常启动（异步 spawn，无 EBUSY）', rNew.spawnError);
    ok(rNew.status === 0, '脚本正常结束', rNew.status + ' ' + rNew.stderr.slice(0, 200));
    ok(/--data-binary/.test(rNew.argv) && /@-/.test(rNew.argv), '传给 curl 的参数含 --data-binary @-',
      rNew.argv.split('\n').filter(Boolean));
    ok(rNew.body.includes('pregnancy_id'), '【关键】curl 的 stdin 收到了请求体', rNew.body);
    ok(rNew.body === BODY, '收到的 body 与原始 body 逐字节一致', { got: rNew.body.length, want: BODY.length });
    ok(/-X/.test(rNew.argv) && /POST/.test(rNew.argv), '请求方法透传为 POST');
    ok(/api\/v1\/habit-checkins/.test(rNew.argv), '目标 URL 含 index.cgi 之后的路径');

    console.log('=== R3：反例对照——旧版本跑同一 harness 必须「丢 body」 ===');
    let oldSrc = null, oldRef = null;
    for (const ref of OLD_REFS) {
      const s = await gitShow(ref);
      if (s && !/--data-binary/.test(s)) { oldSrc = s; oldRef = ref; break; }
    }
    if (!oldSrc) {
      // ⚠️ 这里**不记为失败但必须显式可见**：取不到反例 = 失去"测试具备分辨力"的证明，
      //    正好是铁律里最忌讳的「反例被静默跳过」。所以打一条醒目的 WARN。
      console.log('  ⚠️ [警告] 取不到「修复前」版本（试过 ' + OLD_REFS.join(', ')
        + '），反例对照被跳过 —— 本次无法证明该断言真的能分辨对错。');
    } else {
      console.log(`  （反例来源：git ${oldRef}）`);
      const rOld = await runSnippet(snippetOf(oldSrc, 'old'), 'old', {
        REQUEST_URI: '/cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1/habit-checkins',
        REQUEST_METHOD: 'POST',
        CONTENT_TYPE: 'application/json',
        CONTENT_LENGTH: String(Buffer.byteLength(BODY)),
      }, BODY);
      ok(rOld.body === '', '【反例】旧版本 curl 的 stdin 收到空 body（body 被丢弃）', rOld.body.slice(0, 60));
      ok(/Content-Length/.test(rOld.argv), '旧版本只发了 Content-Length 头（声明了长度却没有 body）',
        rOld.argv.split('\n').filter(a => /Content-Length/i.test(a)));
      // 关键：一正一反，证明这个测试确实能分辨对错
      ok(rNew.body !== rOld.body, '【关键】新旧版本行为不同 ⇒ 测试具备分辨力（非恒真）');
    }

    console.log('=== R4：GET 请求不应读取 stdin（避免无谓阻塞）===');
    {
      const rGet = await runSnippet(snippetOf(cur, 'new'), 'get', {
        REQUEST_URI: '/cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1/health',
        REQUEST_METHOD: 'GET',
      }, '');
      ok(!/--data-binary/.test(rGet.argv), 'GET 不带 --data-binary', rGet.argv.split('\n').filter(Boolean).slice(-4));
      ok(rGet.body === '', 'GET 未读 stdin');
      ok(rGet.status === 0, 'GET 脚本正常结束', rGet.status);
    }
  } catch (e) {
    FAIL++;
    console.log('  🔴 测试自身异常: ' + e.message);
  } finally {
    console.log('');
    console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
    process.exit(FAIL === 0 ? 0 : 1);
  }
})();
