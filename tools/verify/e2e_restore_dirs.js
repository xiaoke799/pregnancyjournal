/**
 * 端到端验证：备份「读侧」与「写侧」口径对齐 + 恢复失败不再卡死落盘
 *
 * 跑法：node e2e_restore_dirs.js
 * 真起 server.js（经 tcp_shim 把 socket 监听转 TCP 环回）+ 真库 + 真 HTTP。
 *
 * 背景（2026-09-23 修复）：
 *   A) 写侧 POST /backup 用 _exportAllowedRoots()，允许导出到「用户授权目录」；
 *      但读侧 GET /export/backups、POST /restore、POST /restore-latest 只认备份落点，
 *      导致「导出提示成功 → 列表看不到 → 也无法恢复」。现三方统一为 _backupSearchRoots()。
 *   B) POST /restore-latest 把 db.lockDb() 放在了「缺 data.json」「JSON 解析失败」两个
 *      提前 return 之前且那两个分支漏了解锁 → _dbLocked 永久为 true → db.js 的
 *      30 秒自动落盘被 `if (_savingDb || _dbLocked) return;` 跳过 → 此后所有写入只进内存、
 *      永不落盘（接口仍返回成功）。现把加锁下移到所有校验之后，与 POST /restore 一致。
 *
 * 覆盖点：
 *   1. 导出到授权目录 → GET /export/backups 列表能看到（读侧闭环）
 *   2. POST /restore 能从授权目录恢复（以前报「超出备份目录范围」）
 *   3. POST /restore-latest 能在授权目录里找到备份（以前找不到）
 *   4. 对照组：正常写一条记录，等一个落盘周期，数据库文件里能搜到 → 证明本用例的观测手法有效
 *   5. 实验组：先让 restore-latest 在损坏备份上失败（缺 data.json / 坏 JSON 两种），
 *      再写一条记录并等一个落盘周期 —— 必须仍能落盘（修复前会卡死）
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-restore-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38473);
const DB_FILE = path.join(T, 'pj.db');
const SAVE_TICK_MS = 30500; // db.js 的自动落盘间隔是 30s，留一点余量

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const AUTH_DIR = path.join(T, 'authorized');   // 模拟「用户授权目录」
const SHARE_DIR = path.join(T, 'share');       // 模拟 data-share 共享目录
const OUTSIDE_DIR = path.join(T, 'outside');   // 不在白名单里的目录
for (const d of [AUTH_DIR, SHARE_DIR, OUTSIDE_DIR]) fs.mkdirSync(d, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: DB_FILE,
  PHOTOS_DIR: path.join(T, 'photos'),
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
  // 模拟飞牛系统注入的「用户授权目录」
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

/** 在落盘的数据库文件里找标记 —— 直接回答「这条记录到底写进磁盘了吗」 */
function dbFileContains(marker) {
  try {
    return fs.readFileSync(DB_FILE).includes(Buffer.from(marker, 'utf-8'));
  } catch (e) {
    return false;
  }
}

/** 写一条带标记的日常记录（只用到 pregnancy_id / record_date / note 三个字段）*/
// ⚠️ 2026-09-28：db.js 修好「db.export() 重连导致 PRAGMA foreign_keys 被重置为 0」之后，
//    外键约束真正生效了。此前本套件直接给不存在的 pregnancy_id 写子表记录也能成功
//    （外键失效 ⇒ 孤儿行随便写）；现在必须先用真实接口建好孕期，再用它的 id 写记录——
//    这与真实前端的行为一致（用户先建孕期档案，再记录）。
let PREGNANCY_ID = null;
async function ensurePregnancy() {
  if (PREGNANCY_ID) return PREGNANCY_ID;
  const r = await postJson('/api/v1/pregnancies', { last_period_date: '2025-04-10' });
  PREGNANCY_ID = (r.json && r.json.data && r.json.data.id) || null;
  if (!PREGNANCY_ID) throw new Error('创建孕期失败: ' + JSON.stringify(r.json));
  return PREGNANCY_ID;
}
async function writeMarker(marker) {
  const r = await postJson('/api/v1/daily-records', {
    pregnancy_id: await ensurePregnancy(),
    record_date: '2026-01-15',
    note: marker,
  });
  return !!(r.json && r.json.code === 0);
}

/** 造一个「损坏的备份」并让它成为 restore-latest 会选中的最新备份 */
function makeCorruptBackup(name, kind) {
  const dir = path.join(AUTH_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  if (kind === 'badjson') fs.writeFileSync(path.join(dir, 'data.json'), '{{{ not json at all');
  // kind === 'nojson' → 故意不写 data.json
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(dir, future, future); // 确保它是最新的，restore-latest 必然选中它
  return dir;
}

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
    for (const hp of ['/api/v1/health', '/api/health']) {
      try {
        const r = await req('GET', hp);
        if (r.status === 200) { ready = true; break; }
      } catch (e) { /* 还没起来 */ }
    }
    if (ready) break;
  }
  if (!ready) {
    console.log('服务未就绪。server 输出末尾：\n' + srvLog.slice(-1500));
    cleanup(); process.exit(2);
  }

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

  console.log('\n########## A. 读侧与写侧口径对齐 ##########');

  // ===== 0. 先建孕期档案（外键生效后，子表记录必须有真实父行）=====
  // 放在第一次备份之前：这样备份里就带着它，后面的 restore 会把它恢复回来。
  const pgId = await ensurePregnancy();
  console.log('[前置] 已创建孕期档案 id=', pgId);

  // ===== 1. 导出到授权目录 =====
  const bk = await postJson('/api/v1/backup', { dir: AUTH_DIR });
  const madeDir = (bk.json && bk.json.data && bk.json.data.dir) || '';
  console.log('[backup → 授权目录] code=', bk.json && bk.json.code, 'dir=', madeDir);
  check('导出到授权目录成功', bk.json && bk.json.code === 0, String(bk.json && bk.json.message));
  check('导出产物落在授权目录下', madeDir.startsWith(AUTH_DIR), madeDir);

  // ===== 2. 列表能看到（读侧闭环）=====
  const list = await req('GET', '/api/v1/export/backups');
  const listed = ((list.json && list.json.data) || []).map((b) => path.resolve(b.path));
  console.log('[export/backups] 条目数=', listed.length);
  check('导出到授权目录的备份出现在列表里',
    !!madeDir && listed.includes(path.resolve(madeDir)), JSON.stringify(listed));

  // ===== 3. 能从授权目录恢复 =====
  const rs = await postJson('/api/v1/restore', { dir: madeDir });
  console.log('[restore ← 授权目录] code=', rs.json && rs.json.code, 'message=', rs.json && rs.json.message);
  check('POST /restore 接受授权目录（修复前报「超出备份目录范围」）',
    rs.json && rs.json.code === 0, String(rs.json && rs.json.message));

  // ===== 4. 一键恢复能在授权目录里找到 =====
  // 此刻 T/backups 这个默认落点还没被创建过，唯一的备份就在授权目录里
  const noDefault = !fs.existsSync(path.join(T, 'backups'));
  check('前提：默认备份落点尚无备份（结论只可能来自授权目录）', noDefault,
    `exists=${!noDefault}`);
  const rl = await postJson('/api/v1/restore-latest', {});
  const rlDir = (rl.json && rl.json.data && rl.json.data.backup_dir) || '';
  console.log('[restore-latest] code=', rl.json && rl.json.code, 'dir=', rlDir);
  check('一键恢复能在授权目录里找到备份（修复前找不到）',
    rl.json && rl.json.code === 0 && rlDir.startsWith(AUTH_DIR), `dir=${rlDir}`);

  console.log('\n########## B. 恢复失败后数据库仍能落盘 ##########');
  console.log('（每步都要等一个 30 秒落盘周期，共约 95 秒，请耐心）');

  // ===== 5. 对照组：证明「写标记 → 等落盘 → 文件里搜到」这套观测有效 =====
  const M_CTRL = 'MARKCTRL_' + Date.now();
  const w1 = await writeMarker(M_CTRL);
  check('对照组：写入记录接口返回成功', w1);
  await sleep(SAVE_TICK_MS);
  const ctrlVisible = dbFileContains(M_CTRL);
  console.log('[对照组] 数据库文件含标记 =', ctrlVisible);
  check('对照组：正常情况记录确实落盘（观测手法有效）', ctrlVisible);

  // ===== 6. 实验组①：restore-latest 撞上「缺 data.json」=====
  const c1 = makeCorruptBackup('backup_20990101-000001', 'nojson');
  const f1 = await postJson('/api/v1/restore-latest', {});
  console.log('[restore-latest 缺 data.json] code=', f1.json && f1.json.code, 'message=', f1.json && f1.json.message);
  check('缺 data.json 时返回失败码', !!(f1.json && f1.json.code === 1001), `code=${f1.json && f1.json.code}`);

  const M_T1 = 'MARKT1_' + Date.now();
  check('实验组①：写入记录接口返回成功', await writeMarker(M_T1));
  await sleep(SAVE_TICK_MS);
  const t1Visible = dbFileContains(M_T1);
  console.log('[实验组①] 数据库文件含标记 =', t1Visible);
  check('实验组①：失败后记录仍能落盘（修复前会卡死）', t1Visible,
    t1Visible ? '' : '数据库锁未释放，落盘被跳过');

  // ===== 7. 实验组②：restore-latest 撞上「JSON 解析失败」=====
  fs.rmSync(c1, { recursive: true, force: true });
  const c2 = makeCorruptBackup('backup_20990101-000002', 'badjson');
  const f2 = await postJson('/api/v1/restore-latest', {});
  console.log('[restore-latest 坏 JSON] code=', f2.json && f2.json.code, 'message=', f2.json && f2.json.message);
  check('坏 JSON 时返回失败码', !!(f2.json && f2.json.code === 1001), `code=${f2.json && f2.json.code}`);

  const M_T2 = 'MARKT2_' + Date.now();
  check('实验组②：写入记录接口返回成功', await writeMarker(M_T2));
  await sleep(SAVE_TICK_MS);
  const t2Visible = dbFileContains(M_T2);
  console.log('[实验组②] 数据库文件含标记 =', t2Visible);
  check('实验组②：失败后记录仍能落盘（修复前会卡死）', t2Visible,
    t2Visible ? '' : '数据库锁未释放，落盘被跳过');

  // ===== 8. 损坏备份不该污染数据 =====
  // 注意返回结构是 data.items / data.list（不是裸数组）
  const after = await req('GET', `/api/v1/daily-records?pregnancy_id=${encodeURIComponent(await ensurePregnancy())}&page_size=50`);
  const ad = (after.json && after.json.data) || {};
  const rows = ad.items || ad.list || [];
  const notes = (Array.isArray(rows) ? rows : []).map((r) => r && r.note).filter(Boolean);
  console.log('[失败后数据仍在] notes=', JSON.stringify(notes.slice(0, 5)), 'total=', ad.total);
  check('损坏备份未破坏已有数据（标记仍在库里）',
    notes.includes(M_T1) || notes.includes(M_T2), JSON.stringify(notes.slice(0, 5)));

  fs.rmSync(c2, { recursive: true, force: true });

  console.log('\n================ 结果 ================');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`  ${r.pass ? '[OK]  ' : '[FAIL]'} ${r.name}  ${r.detail || ''}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n总计 ${passed}/${results.length} 通过`);

  cleanup();
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(3); });
