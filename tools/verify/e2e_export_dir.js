/**
 * 端到端验证：「导出备份到用户授权目录」
 *
 * 跑法：node e2e_export_dir.js
 * 真起 server.js（经 tcp_shim 把 socket 监听转 TCP 环回）+ 真库 + 真 HTTP。
 *
 * 覆盖点：
 *   1. /storage-info 能报出「默认备份落点」与「用户已授权目录」
 *   2. /browse-dir 的 roots 里能看到授权目录；根请求不列系统 / 目录
 *   3. /browse-dir 拒绝越权路径
 *   4. /backup 带 dir=授权目录 → 成功落盘
 *   5. /backup 带 dir=非白名单路径 → 拒绝（老版本这里没校验，是任意路径写入）
 *   6. /backup 不带 dir → 老行为不回归
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-export-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38472);

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const AUTH_DIR = path.join(T, 'authorized');      // 模拟「用户授权目录」
const SHARE_DIR = path.join(T, 'share');          // 模拟 data-share 共享目录
const OUTSIDE_DIR = path.join(T, 'outside');      // 不在白名单里的目录（应被拒）
for (const d of [AUTH_DIR, SHARE_DIR, OUTSIDE_DIR]) fs.mkdirSync(d, { recursive: true });
fs.mkdirSync(path.join(AUTH_DIR, 'sub'), { recursive: true });
fs.writeFileSync(path.join(T, 'a-file.txt'), 'x'); // 用于验证 trust-dir 拒绝"非目录"

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
  // 关键：模拟飞牛系统注入的「用户授权目录」。
  // 注意：TRIM_DATA_SHARE_PATHS 刻意不设——config.js 里它按 ':' 切分，
  // 而 Windows 盘符自带冒号（C:\...）会被切碎，那是本机跑测试的环境差异，不是产品问题
  //（生产环境是 fnOS/Linux，路径不含冒号）。共享目录分支因此在本测试中不参与断言。
  TRIM_DATA_ACCESSIBLE_PATHS: AUTH_DIR,
};

function req(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 300) });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

const postJson = (p, obj) =>
  req('POST', p, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));

  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const r = await req('GET', '/api/v1/health');
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* 还没起来 */ }
  }
  if (!ready) {
    console.log('服务未就绪。server 输出末尾：\n' + srvLog.slice(-1500));
    cleanup(); process.exit(2);
  }

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

  // ===== 1. /storage-info =====
  const si = await req('GET', '/api/v1/storage-info');
  const sid = (si.json && si.json.data) || {};
  console.log('\n[storage-info]', JSON.stringify(sid));
  check('storage-info 返回 code 0', si.json && si.json.code === 0);
  check('storage-info 报出默认备份落点', !!sid.default_backup_dir, String(sid.default_backup_dir || ''));
  const authList = (sid.authorized_dirs || []).map((d) => d.path);
  check('storage-info 认到用户授权目录', authList.includes(AUTH_DIR), JSON.stringify(authList));
  check('授权目录标记为可写', (sid.authorized_dirs || []).some((d) => d.path === AUTH_DIR && d.canRW === true));

  // ===== 2. /browse-dir 根请求 =====
  const br = await req('GET', '/api/v1/browse-dir?path=/');
  const brd = (br.json && br.json.data) || {};
  const rootPaths = (brd.roots || []).map((r) => r.path);
  console.log('[browse-dir /] roots=', JSON.stringify((brd.roots || []).map((r) => r.name)));
  check('roots 含授权目录', rootPaths.includes(AUTH_DIR), JSON.stringify(rootPaths));
  check('根请求 items 为空（不列系统 / 内容）', Array.isArray(brd.items) && brd.items.length === 0, `items=${(brd.items || []).length}`);

  // ===== 3. 浏览授权目录 + 越权拒绝 =====
  const bl = await req('GET', '/api/v1/browse-dir?path=' + encodeURIComponent(AUTH_DIR));
  const bld = (bl.json && bl.json.data) || {};
  const names = (bld.items || []).map((i) => i.name);
  console.log('[browse-dir 授权目录] items=', JSON.stringify(names));
  check('能列出授权目录下的子目录', names.includes('sub'), JSON.stringify(names));

  const esc = await req('GET', '/api/v1/browse-dir?path=' + encodeURIComponent(OUTSIDE_DIR));
  console.log('[browse-dir 越权] message=', esc.json && esc.json.message);
  check('越权路径被拒绝', !(esc.json && esc.json.code === 0), String(esc.json && esc.json.message));

  const esc2 = await req('GET', '/api/v1/browse-dir?path=' + encodeURIComponent(AUTH_DIR + '/../../etc'));
  console.log('[browse-dir 穿越] message=', esc2.json && esc2.json.message);
  check('路径穿越被拒绝', !(esc2.json && esc2.json.code === 0), String(esc2.json && esc2.json.message));

  // ===== 4. 导出到授权目录 =====
  const bk = await postJson('/api/v1/backup', { dir: AUTH_DIR });
  const bkd = (bk.json && bk.json.data) || {};
  console.log('[backup → 授权目录] code=', bk.json && bk.json.code, 'dir=', bkd.dir);
  check('导出到授权目录成功', bk.json && bk.json.code === 0, String(bk.json && bk.json.message));
  const madeDir = bkd.dir || '';
  check('导出目标落在授权目录下', madeDir.startsWith(AUTH_DIR), madeDir);
  const hasJson = madeDir && fs.existsSync(path.join(madeDir, 'data.json'));
  check('导出产物含 data.json', !!hasJson, madeDir);
  check('导出产物含 files/ 目录', !!(madeDir && fs.existsSync(path.join(madeDir, 'files'))));

  // ===== 5. 越权导出必须被拒 =====
  const bad = await postJson('/api/v1/backup', { dir: OUTSIDE_DIR });
  console.log('[backup → 非白名单] code=', bad.json && bad.json.code, 'message=', bad.json && bad.json.message);
  check('非白名单目录被拒绝', bad.json && bad.json.code === 1003, `code=${bad.json && bad.json.code}`);
  const leaked = fs.readdirSync(OUTSIDE_DIR).filter((f) => f.startsWith('backup_'));
  check('非白名单目录里没有写入任何备份', leaked.length === 0, JSON.stringify(leaked));

  const bad2 = await postJson('/api/v1/backup', { dir: AUTH_DIR + '/../../../evil' });
  console.log('[backup 穿越] code=', bad2.json && bad2.json.code);
  check('导出的路径穿越被拒绝', bad2.json && bad2.json.code === 1003, `code=${bad2.json && bad2.json.code}`);

  // ===== 7. 手动指定目录（/trust-dir）=====
  // 顺序关键：必须在上面的"非白名单被拒"之后跑，才能证明"拒 → 确认 → 可写"这条链是真的。
  const tMissing = await postJson('/api/v1/trust-dir', { dir: path.join(T, 'not-exist-xyz') });
  check('trust-dir 拒绝不存在的路径', tMissing.json && tMissing.json.code === 1001, `code=${tMissing.json && tMissing.json.code}`);

  const tFile = await postJson('/api/v1/trust-dir', { dir: path.join(T, 'a-file.txt') });
  check('trust-dir 拒绝非目录', tFile.json && tFile.json.code === 1001, `code=${tFile.json && tFile.json.code}`);

  const tEmpty = await postJson('/api/v1/trust-dir', { dir: '' });
  check('trust-dir 拒绝空路径', tEmpty.json && tEmpty.json.code === 1001, `code=${tEmpty.json && tEmpty.json.code}`);

  const trust = await postJson('/api/v1/trust-dir', { dir: OUTSIDE_DIR });
  console.log('[trust-dir] code=', trust.json && trust.json.code, 'message=', trust.json && trust.json.message);
  check('trust-dir 接受可写目录', trust.json && trust.json.code === 0, String(trust.json && trust.json.message));

  const bkTrusted = await postJson('/api/v1/backup', { dir: OUTSIDE_DIR });
  check('手动确认过的目录现在可以导出', bkTrusted.json && bkTrusted.json.code === 0, String(bkTrusted.json && bkTrusted.json.message));

  const si2 = await req('GET', '/api/v1/storage-info');
  const trusted = (si2.json && si2.json.data && si2.json.data.trusted_dirs) || [];
  check('storage-info 报出已记忆的手动目录', trusted.includes(OUTSIDE_DIR), JSON.stringify(trusted));
  check('storage-info 带诊断信息', !!(si2.json && si2.json.data && si2.json.data.diag), '');
  check('诊断里回传了 TRIM_ 变量名列表', Array.isArray(si2.json?.data?.diag?.trim_env_keys), '');
  check('诊断不泄露 token', !JSON.stringify(si2.json?.data?.diag || {}).includes('TRIM_API_TOKEN') || String(si2.json.data.diag.trim_env?.TRIM_API_TOKEN || '') === '(已隐藏)', '');

  const br2 = await req('GET', '/api/v1/browse-dir?path=/');
  check('browse-dir 的 roots 含手动指定目录', ((br2.json && br2.json.data && br2.json.data.roots) || []).map((r) => r.path).includes(OUTSIDE_DIR));

  // ===== 6. 老行为（不带 dir）不回归 =====
  const auto = await postJson('/api/v1/backup', {});
  const autoDir = (auto.json && auto.json.data && auto.json.data.dir) || '';
  console.log('[backup 不带 dir] code=', auto.json && auto.json.code, 'dir=', autoDir);
  check('不带 dir 仍然成功（老行为不回归）', auto.json && auto.json.code === 0, String(auto.json && auto.json.message));
  check('不带 dir 时落在默认备份落点', autoDir.startsWith(path.join(T, 'backups')), autoDir);

  console.log('\n================ 结果 ================');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`  ${r.pass ? '[OK]  ' : '[FAIL]'} ${r.name}  ${r.detail || ''}`);
  }
  console.log(`\n总计 ${results.filter((r) => r.pass).length}/${results.length} 通过`);

  cleanup();
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(3); });
