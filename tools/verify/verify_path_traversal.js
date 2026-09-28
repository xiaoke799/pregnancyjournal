/**
 * 路径穿越防护核查（上架自查第 4 条：文件读写接口需校验路径安全性）
 *
 * 做法：起真服务，先用接口问出「允许的根目录」，再**从允许范围之外**发起一堆穿越攻击，
 * 断言全部被拒绝。不是读代码判断，是真打。
 *
 * 覆盖 5 个接受路径/文件名的接口：
 *   GET  /browse-dir?path=              （导出：目录浏览）
 *   GET  /files/browse?path=            （产检：NAS 文件浏览）
 *   GET  /export/download-dir?dir=      （导出产物下载）
 *   POST /export/import-dir  {dir}      （目录导入）
 *   GET  /daily-records/diary/:filename （日记插图按文件名取）
 *
 * 用法：node verify_path_traversal.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-traversal');
const PORT = Number(process.env.PJ_TCP_PORT || 38498);
const AUTH_DIR = path.join(T, 'authorized');   // 唯一的「用户授权目录」

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.writeFileSync(path.join(AUTH_DIR, 'ok.txt'), 'allowed');

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'),
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
  TRIM_DATA_ACCESSIBLE_PATHS: AUTH_DIR,
};

function req(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, raw: d.slice(0, 200) }); } });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  [OK]   ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${extra ? '  ← ' + extra : ''}`); }
}
/** 被拒绝 = 业务码非 0（且不该带回文件内容） */
const rejected = (r) => !(r.json && r.json.code === 0);

/** 把响应压成一行原因（⚠️ 响应可能不是 JSON，直接 .slice 会把自己的脚本搞崩） */
function why(r) {
  if (!r) return '(无响应)';
  if (r.json) return `code=${r.json.code} ${JSON.stringify(r.json.message || '').slice(0, 46)}`;
  if (r.raw) return `非 JSON: ${String(r.raw).replace(/\s+/g, ' ').slice(0, 60)}`;
  return `status=${r.status}`;
}

(async () => {
  const srvLog = [];
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env });
  child.stdout.on('data', (d) => srvLog.push(String(d)));
  child.stderr.on('data', (d) => srvLog.push(String(d)));

  for (let i = 0; i < 40; i++) {
    try { const h = await req('GET', '/api/health'); if (h.json && h.json.status === 'ok') break; } catch {}
    await sleep(500);
  }

  try {
    console.log('\n########## 0. 先问出「允许的根目录」，才能知道"外面"在哪 ##########');
    const rootsResp = await req('GET', '/api/v1/browse-dir?path=/');
    const roots = ((rootsResp.json && rootsResp.json.data && rootsResp.json.data.roots) || []).map((r) => r.path);
    console.log('  允许的根: ' + JSON.stringify(roots));
    check('能取到允许根列表（说明接口工作正常）', roots.length > 0, `${roots.length} 个`);
    check('授权目录在允许列表里', roots.some((p) => path.resolve(p) === path.resolve(AUTH_DIR)));

    // 造一个「明确在允许范围之外」的真实文件与目录，作为攻击目标
    const outsideDir = path.join(os.tmpdir(), 'pj-traversal-outside');
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'TOP_SECRET_OUTSIDE');
    const outsideFile = path.join(outsideDir, 'secret.txt');

    console.log('\n########## 1. /browse-dir（导出目录浏览）##########');
    const traversals = [
      outsideDir,
      outsideDir.replace(/\\/g, '/') + '/../pj-traversal-outside',
      '/etc',
      '/etc/passwd',
      '../../../../etc',
      '..',
      AUTH_DIR + '/../pj-traversal-outside',            // 从允许目录往上跳
      encodeURIComponent(AUTH_DIR + '/../pj-traversal-outside'),
      encodeURIComponent('/etc/passwd'),
      '/proc/self/environ',
    ];
    for (const p of traversals) {
      const r = await req('GET', '/api/v1/browse-dir?path=' + encodeURIComponent(p));
      const leaked = r.json && r.json.code === 0 && Array.isArray(r.json.data && r.json.data.items)
        && r.json.data.items.some((it) => it.name === 'secret.txt' || it.name === 'passwd');
      check(`拒绝: ${p}`, rejected(r) && !leaked,
        leaked ? '⚠️ 泄露了目录内容！' : why(r));
    }
    // 正常目录仍应可用（防止"一刀切全拒"式的假通过）
    const okBrowse = await req('GET', '/api/v1/browse-dir?path=' + encodeURIComponent(AUTH_DIR));
    check('授权目录内部仍可正常浏览（不是简单全拒）',
      okBrowse.json && okBrowse.json.code === 0, JSON.stringify(okBrowse.json && okBrowse.json.message));

    console.log('\n########## 2. /files/browse（产检 NAS 浏览）##########');
    for (const p of [outsideDir, '/etc', '/etc/passwd', '../../../../etc', encodeURIComponent('/etc/passwd')]) {
      const r = await req('GET', '/api/v1/files/browse?path=' + encodeURIComponent(p));
      const leaked = r.json && r.json.code === 0 && Array.isArray(r.json.data && r.json.data.entries)
        && r.json.data.entries.some((it) => it.name === 'secret.txt' || it.name === 'passwd');
      check(`拒绝: ${p}`, rejected(r) && !leaked, leaked ? '⚠️ 泄露了目录内容！' : why(r));
    }

    console.log('\n########## 3. /export/download-dir（导出产物下载）##########');
    for (const d of [outsideDir, '/etc', T]) {
      const r = await req('GET', '/api/v1/export/download-dir?dir=' + encodeURIComponent(d));
      const leaked = r.json && r.json.code === 0 && JSON.stringify(r.json).includes('secret.txt');
      check(`拒绝: ${d}`, rejected(r) && !leaked, leaked ? '⚠️ 泄露！' : why(r));
    }

    console.log('\n########## 4. /export/import-dir（目录导入）##########');
    for (const d of [outsideDir, '/etc']) {
      const r = await req('POST', '/api/v1/export/import-dir', { dir: d });
      check(`拒绝: ${d}`, rejected(r), why(r));
    }

    console.log('\n########## 5. 日记插图按文件名取（路径穿越）##########');
    const names = [
      '..%2F..%2Fsecret.txt',
      encodeURIComponent('../../../etc/passwd'),
      '....//....//secret.txt',
      '%2e%2e%2f%2e%2e%2fsecret.txt',
      'a/../../secret.txt',
    ];
    for (const n of names) {
      const r = await req('GET', '/api/v1/daily-records/diary/' + n);
      const leaked = r.json && r.json.code === 0 && JSON.stringify(r.json).includes('TOP_SECRET');
      check(`拒绝: ${decodeURIComponent(n)}`, rejected(r) && !leaked,
        leaked ? '⚠️ 读到了目录外文件！' : why(r));
    }

    console.log('\n########## 6. 整库恢复：不允许从任意路径读 .db ##########');
    const rdb = await req('POST', '/api/v1/export/restore-db', { backup_path: outsideFile });
    check('拒绝: 目录外的 restore-db 路径', rejected(rdb), why(rdb));

    console.log('\n########## 7. 服务端日志不该出现异常堆栈 ##########');
    const crashed = /Unhandled|Uncaught|ERR_INVALID|TypeError/.test(srvLog.join(''));
    check('攻击过程中服务端没有未捕获异常', !crashed, crashed ? '日志里有异常' : '');
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.join('').slice(-1000));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();
