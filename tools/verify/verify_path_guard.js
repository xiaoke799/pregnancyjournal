/**
 * 文件路径锚定 + 恢复白名单 + Bark SSRF + 用药锚点 —— 上线前检查修复的回归套件。
 *
 * 覆盖（全部真起后端、真 HTTP）：
 *   A. 写入侧：import-json 投毒 file_path（目录外绝对路径）→ 入库即被置 null
 *   B. 读取侧：库里已有投毒记录（模拟修复前遗留数据）→ 下载 403、内容不泄露
 *   C. 删除侧：投毒的 pregnancy_photo/checkup_report → 删记录不删文件；
 *      对照组（合法路径）正常下载/删除
 *   D. restore-latest 表名白名单（#12）："dose_plan WHERE 1=1" 不再清掉 dose_plan
 *   E. Bark urlError（#8）：本机/内网地址被拒，公网地址放行
 *   F. 用药 PUT 补锚（#4）：改成「隔天」不丢锚点；显式 start_date:null 也补
 *   G. 每周指定（#5）：weekdays 空数组前后端都拒绝
 *
 * 用法：node verify_path_guard.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const { SERVER_DIR, SERVER_ENTRY, UI_DIR, TMP, NODE } = require('./_env');
const SHIM = path.join(__dirname, 'tcp_shim.js');

const PORT = 38677;
const PREFIX = '/app/pregnancyjournal';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}/api/v1`;
const PG = 'guard-pg-1';
const CK = 'guard-ck-1';

let pass = 0, fail = 0;
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  🔴 ' + name + (extra ? '  → ' + extra : '')); }
}

function waitPort(port, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(tick, 60);
      });
    };
    tick();
  });
}

async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, raw: text };
}

/** 用产品自己的 SCHEMA 建空库，放一条孕期档案 + 一条产检记录（file_path 类行的外键父记录） */
async function seed(dbPath) {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules/sql.js'));
  const SQL = await initSqlJs();
  const d = new SQL.Database();
  const src = fs.readFileSync(path.join(SERVER_DIR, 'db.js'), 'utf8');
  const block = (src.match(/const SCHEMA = `([\s\S]*?)`;/) || [])[1] || '';
  let n = 0;
  for (const raw of block.split(';')) {
    const stmt = raw.replace(/--[^\n]*/g, '').trim();
    if (!/^CREATE (TABLE|UNIQUE INDEX|INDEX)/i.test(stmt)) continue;
    try { d.run(stmt); n++; } catch {}
  }
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const lmp = new Date(Date.now() - 140 * 86400000).toISOString().slice(0, 10);
  const due = new Date(Date.now() + 140 * 86400000).toISOString().slice(0, 10);
  d.run(
    `INSERT OR REPLACE INTO pregnancy (id, last_period_date, due_date, is_active, baby_name, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
    [PG, lmp, due, '锚定探针', now, now]
  );
  d.run(
    `INSERT OR REPLACE INTO prenatal_checkup (id, pregnancy_id, checkup_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [CK, PG, lmp, now, now]
  );
  fs.writeFileSync(dbPath, Buffer.from(d.export()));
  return n;
}

/** 往既有库文件里直接插一条记录（模拟修复前遗留的脏数据；必须趁服务停止时用） */
async function poisonDb(dbPath, table, row) {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules/sql.js'));
  const SQL = await initSqlJs();
  const d = new SQL.Database(fs.readFileSync(dbPath));
  const cols = Object.keys(row);
  d.run(
    `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => row[c])
  );
  fs.writeFileSync(dbPath, Buffer.from(d.export()));
  d.close();
}

function startServer(dbPath, tmpData) {
  return spawn(NODE, ['-r', SHIM, SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PJ_TCP_PORT: String(PORT),
      APP_MODE: 'dev',
      STORAGE_DIR: tmpData,
      DATA_DIR: tmpData,
      DATABASE_PATH: dbPath,
      PHOTOS_DIR: path.join(tmpData, 'photos'),
      THUMBNAILS_DIR: path.join(tmpData, 'thumbnails'),
      MEDIA_DIR: path.join(tmpData, 'media'),
      BACKUPS_DIR: path.join(tmpData, 'backups'),
      STATIC_DIR: UI_DIR,
      ASSETS_DIR: path.join(SERVER_DIR, 'data'),
      TRIM_APPDEST: SERVER_DIR,
      TRIM_PKGVAR: tmpData,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmpData = path.join(TMP, 'path_guard_' + Date.now());
  fs.mkdirSync(tmpData, { recursive: true });
  const dbPath = path.join(tmpData, 'pregnancyjournal.db');
  const outsideDir = path.join(os.tmpdir(), 'pj-guard-outside');
  fs.rmSync(outsideDir, { recursive: true, force: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsideFile, 'TOP_SECRET_GUARD_12345');

  const tables = await seed(dbPath);
  assert('SCHEMA 建表数量合理（≥40）', tables >= 40, `实际 ${tables}`);

  let server = startServer(dbPath, tmpData);
  if (!(await waitPort(PORT))) { console.log('❌ 后端没起来'); server.kill('SIGKILL'); process.exit(1); }
  console.log('\n后端就绪');

  try {
    console.log('\n【A】写入侧锚定：import-json 投毒 file_path → 整行被丢弃');
    const evil = await api('POST', '/export/import-json', {
      tables: {
        checkup_report: [{
          id: 'EVIL1', checkup_id: CK, checkup_type: 'routine', filename: 'secret.txt',
          file_path: outsideFile, file_type: 'other', mime_type: 'text/plain', file_size: 24,
        }],
      },
    });
    assert('import-json 请求本身 code 0', evil.json && evil.json.code === 0, JSON.stringify(evil.json));
    assert('投毒行 0 条入库（写入侧锚定）', evil.json && evil.json.data &&
      evil.json.data.results && evil.json.data.results.checkup_report === 0,
      JSON.stringify((evil.json || {}).data));
    const reports = await api('GET', `/checkups/${CK}/reports`);
    assert('列表里没有投毒记录', !(((reports.json || {}).data) || []).some((r) => r.id === 'EVIL1'),
      JSON.stringify((reports.json || {}).data).slice(0, 120));

    console.log('\n【C-1】删除侧对照组：合法路径的照片正常删');
    const inDirFile = path.join(tmpData, 'photos', 'album', 'real.jpg');
    fs.mkdirSync(path.dirname(inDirFile), { recursive: true });
    fs.writeFileSync(inDirFile, 'REAL_PHOTO_BYTES');
    const photos = await api('POST', '/export/import-json', {
      tables: {
        pregnancy_photo: [{ id: 'REAL_PH', pregnancy_id: PG, photo_type: 'album', file_path: inDirFile }],
      },
    });
    assert('合法照片导入 code 0', photos.json && photos.json.code === 0, JSON.stringify(photos.json));
    const delReal = await api('DELETE', '/photos/REAL_PH');
    assert('删除合法记录 code 0', delReal.json && delReal.json.code === 0, JSON.stringify(delReal.json));
    assert('允许目录内的文件被正常删除（不是一刀切全拒）', !fs.existsSync(inDirFile), '文件还在');

    console.log('\n【D】restore-latest 表名白名单（#12）："dose_plan WHERE 1=1" 不再清表');
    const plan = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'medication', name: '现有方案', reminder_times: ['08:00'] });
    assert('建现有用药方案 code 0', plan.json && plan.json.code === 0, JSON.stringify(plan.json));
    const bkDir = path.join(tmpData, 'backups', 'backup_guardtest');
    fs.mkdirSync(bkDir, { recursive: true });
    fs.writeFileSync(path.join(bkDir, 'data.json'), JSON.stringify({
      tables: {
        dose_plan: [{
          id: 'BKP1', pregnancy_id: PG, kind: 'supplement', name: '备份方案', dosage: '',
          reminder_times: '["08:00"]', frequency: 'daily', weekdays: '[]', is_enabled: 1, sort_order: 0,
        }],
        'dose_plan WHERE 1=1': [{ id: 'X' }],
        evil_table: [{ id: 'Y' }],
      },
    }));
    const rstr = await api('POST', '/restore-latest', {});
    assert('restore-latest 执行成功（未知表被跳过而不是崩）', rstr.json && rstr.json.code === 0,
      JSON.stringify(rstr.json).slice(0, 200));
    const after = await api('GET', `/dose-plans?pregnancy_id=${PG}`);
    const names = (((after.json || {}).data || {}).items || (after.json || {}).data || []).map((p) => p.name);
    assert('dose_plan 被备份行替换（BKP1 在）', names.includes('备份方案'), JSON.stringify(names));
    assert('现有方案未被 "WHERE 1=1" 投毒清掉后再丢（只剩备份行）', !names.includes('现有方案') && names.length === 1,
      JSON.stringify(names));

    console.log('\n【E】Bark urlError（#8）：本机/内网拒、公网放');
    const pushEngine = require(path.join(SERVER_DIR, 'services/push-engine.js'));
    const bark = pushEngine.getChannel('bark');
    assert('拒绝 localhost', typeof bark.urlError('http://localhost:8080/key') === 'string');
    assert('拒绝 127.0.0.1', typeof bark.urlError('http://127.0.0.1/key') === 'string');
    assert('拒绝 10.x', typeof bark.urlError('http://10.0.0.8:8080/key') === 'string');
    assert('拒绝 192.168.x', typeof bark.urlError('http://192.168.1.10/key') === 'string');
    assert('拒绝 172.16-31.x', typeof bark.urlError('http://172.20.0.5/key') === 'string');
    assert('拒绝 169.254.x（云元数据）', typeof bark.urlError('http://169.254.169.254/key') === 'string');
    assert('放行公网 Bark 官方地址', bark.urlError('https://api.day.app/abc123key') === null,
      String(bark.urlError('https://api.day.app/abc123key')));

    console.log('\n【F/G】用药：PUT 改「隔天」补锚（#4）；「每周指定」空数组拒绝（#5）');
    const dp = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'medication', name: '锚点药', reminder_times: ['08:00'] });
    const dpId = dp.json && dp.json.data && dp.json.data.id;
    assert('建 daily 方案 code 0', !!dpId, JSON.stringify(dp.json));
    const pad = (n) => String(n).padStart(2, '0');
    const nd = new Date();
    const todayStr = `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`;
    const tmr = new Date(nd.getTime() + 86400000);
    const tmrStr = `${tmr.getFullYear()}-${pad(tmr.getMonth() + 1)}-${pad(tmr.getDate())}`;
    const listPlans = async () => {
      const r = await api('GET', `/dose-plans?pregnancy_id=${PG}`);
      return (((r.json || {}).data || {}).items || (r.json || {}).data || []);
    };

    const put1 = await api('PUT', `/dose-plans/${dpId}`, { frequency: 'interval2' });
    assert('PUT 改成隔天 code 0', put1.json && put1.json.code === 0, JSON.stringify(put1.json));
    let row = (await listPlans()).find((p) => p.id === dpId);
    assert('PUT 后 start_date 钉为今天（#4 修复）', row && row.start_date === todayStr, `实际=${row && row.start_date}`);
    const t0 = await api('GET', `/dose-today?pregnancy_id=${PG}&date=${todayStr}`);
    const t1 = await api('GET', `/dose-today?pregnancy_id=${PG}&date=${tmrStr}`);
    assert('锚定今天：今天 due', ((((t0.json || {}).data || {}).items) || []).some((i) => i.id === dpId));
    assert('锚定今天：明天不 due（不再每天提醒）', !((((t1.json || {}).data || {}).items) || []).some((i) => i.id === dpId));

    const put2 = await api('PUT', `/dose-plans/${dpId}`, { frequency: 'interval2', start_date: null });
    assert('PUT 显式 start_date:null code 0', put2.json && put2.json.code === 0, JSON.stringify(put2.json));
    row = (await listPlans()).find((p) => p.id === dpId);
    assert('显式 start_date:null 也补锚（前端每次保存都带 null）', row && row.start_date === todayStr,
      `实际=${row && row.start_date}`);

    const bad1 = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'medication', name: '坏方案', reminder_times: ['08:00'], frequency: 'weekdays', weekdays: [] });
    assert('POST 每周指定空数组被拒绝（#5 修复）', bad1.json && bad1.json.code !== 0, JSON.stringify(bad1.json));
    const bad2 = await api('PUT', `/dose-plans/${dpId}`, { frequency: 'weekdays', weekdays: [] });
    assert('PUT 每周指定空数组被拒绝', bad2.json && bad2.json.code !== 0, JSON.stringify(bad2.json));
    const bad3 = await api('PUT', `/dose-plans/${dpId}`, { frequency: 'weekdays' });
    assert('PUT 改每周指定但不传 weekdays（旧值空）也被拒绝', bad3.json && bad3.json.code !== 0, JSON.stringify(bad3.json));
    const okW = await api('PUT', `/dose-plans/${dpId}`, { frequency: 'weekdays', weekdays: [1] });
    assert('PUT 每周指定周一（合法）code 0', okW.json && okW.json.code === 0, JSON.stringify(okW.json));
    const m1 = await api('GET', `/dose-today?pregnancy_id=${PG}&date=2026-10-05`);
    const m2 = await api('GET', `/dose-today?pregnancy_id=${PG}&date=2026-10-06`);
    assert('周一 due', ((((m1.json || {}).data || {}).items) || []).some((i) => i.id === dpId));
    assert('周二不 due', !((((m2.json || {}).data || {}).items) || []).some((i) => i.id === dpId));
  } finally {
    server.kill('SIGKILL');
  }
  await sleep(800);

  // ---------- 运行 2：读取侧 + 删除侧（库里已有投毒遗留记录，模拟修复前数据） ----------
  console.log('\n【B/C-2】遗留投毒记录：下载 403/404、内容不泄露、删除不动文件；合法文件正常');
  await poisonDb(dbPath, 'checkup_report', {
    id: 'LEGACY_R', checkup_id: CK, checkup_type: 'routine', filename: 'secret.txt',
    file_path: outsideFile, file_type: 'other', mime_type: 'text/plain', file_size: 24, created_at: '2026-09-30 00:00:00',
  });
  await poisonDb(dbPath, 'pregnancy_photo', {
    id: 'LEGACY_PH', pregnancy_id: PG, photo_type: 'album', file_path: outsideFile, created_at: '2026-09-30 00:00:00',
  });
  const okReport = path.join(tmpData, 'photos', 'checkups', CK, 'reports', 'ok.pdf');
  fs.mkdirSync(path.dirname(okReport), { recursive: true });
  fs.writeFileSync(okReport, 'OK_PDF_BYTES');
  await poisonDb(dbPath, 'checkup_report', {
    id: 'OK_R', checkup_id: CK, checkup_type: 'routine', filename: 'ok.pdf',
    file_path: okReport, file_type: 'pdf', mime_type: 'application/pdf', file_size: 12, created_at: '2026-09-30 00:00:00',
  });

  server = startServer(dbPath, tmpData);
  if (!(await waitPort(PORT))) { console.log('❌ 后端第二次启动失败'); server.kill('SIGKILL'); process.exit(1); }
  try {
    const dl = await api('GET', '/checkups/reports/LEGACY_R/download');
    assert('下载投毒报告被拒（非 200）', dl.status !== 200, `status=${dl.status}`);
    assert('响应不含目录外文件内容', !dl.raw.includes('TOP_SECRET_GUARD_12345'), '内容泄露！');
    const dlOk = await api('GET', '/checkups/reports/OK_R/download');
    assert('允许目录内报告仍可正常下载（对照组）', dlOk.status === 200 && dlOk.raw === 'OK_PDF_BYTES',
      `status=${dlOk.status}`);

    const delR = await api('DELETE', '/checkups/reports/LEGACY_R');
    assert('删除投毒报告 code 0', delR.json && delR.json.code === 0, JSON.stringify(delR.json));
    const delPh = await api('DELETE', '/photos/LEGACY_PH');
    assert('删除投毒照片 code 0', delPh.json && delPh.json.code === 0, JSON.stringify(delPh.json));
    assert('目录外文件仍完好（删除侧锚定）', fs.existsSync(outsideFile) &&
      fs.readFileSync(outsideFile, 'utf8') === 'TOP_SECRET_GUARD_12345');
  } finally {
    server.kill('SIGKILL');
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('❌ FATAL: ' + (e && e.message)); process.exit(1); });
