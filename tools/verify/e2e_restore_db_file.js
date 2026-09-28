/**
 * 「整库文件替换」式恢复（/export/restore-db）的端到端测试
 *
 * 防的是什么：
 *   本应用是「内存 SQLite + 每 30 秒整库落盘」（db.js 的 setInterval(saveDb, 30000)）。
 *   如果只把备份 .db 覆盖到 DATABASE_PATH 而不重载内存，
 *   最迟 30 秒后 saveDb() 就会把**恢复前的旧数据**写回去 ⇒ 恢复被静默撤销，
 *   而接口却回报「恢复成功」 —— 用户只会以为备份文件有问题。
 *
 * 判定点：恢复后先**立即**看一次，再**等一个落盘周期**看一次；两次都必须还是旧数据。
 * 用法：node e2e_restore_db_file.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-restoredb-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38486);
const SAVE_TICK_MS = 31000; // 比 db.js 的 30 秒多一点

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

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
};

function req(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, json: null, raw: data }); } });
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
    const p = await req('POST', '/api/v1/pregnancies', { last_period_date: '2026-01-01', baby_name: '整库恢复测试' });
    const pid = p.json && p.json.data && p.json.data.id;
    if (!pid) throw new Error('建孕期失败: ' + JSON.stringify(p.json));
    const DATE = '2026-09-25';
    const MARK_OLD = '旧数据_' + Date.now();
    const MARK_NEW = '新数据_' + Date.now();

    console.log('\n########## 1. 造「备份时刻」的数据 ##########');
    const w1 = await req('POST', '/api/v1/daily-records', { pregnancy_id: pid, record_date: DATE, note: MARK_OLD, bust: 92, waist: 85, hip: 95 });
    check('写入旧数据成功', w1.json && w1.json.code === 0, JSON.stringify(w1.json && w1.json.message));

    console.log('\n########## 2. 做一次整库备份 ##########');
    const bk = await req('POST', '/api/v1/export/backup-db', {});
    const bkPath = bk.json && bk.json.data && bk.json.data.backup_path;
    check('整库备份成功', bk.json && bk.json.code === 0 && !!bkPath, bkPath || JSON.stringify(bk.json));
    check('备份文件确实落盘', !!bkPath && fs.existsSync(bkPath) && fs.statSync(bkPath).size > 0,
      bkPath && fs.existsSync(bkPath) ? fs.statSync(bkPath).size + ' 字节' : '文件不存在');

    console.log('\n########## 3. 备份之后又改了数据（模拟「备份之后用户继续用」）##########');
    const w2 = await req('POST', '/api/v1/daily-records', { pregnancy_id: pid, record_date: DATE, note: MARK_NEW, waist: 88 });
    const now = await req('GET', `/api/v1/daily-records/${DATE}?pregnancy_id=${pid}`);
    check('当前数据已是「新数据」', ((now.json && now.json.data) || {}).note === MARK_NEW,
      JSON.stringify(((now.json && now.json.data) || {}).note));

    console.log('\n########## 4. 用整库备份恢复 ##########');
    const rs = await req('POST', '/api/v1/export/restore-db', { backup_path: bkPath });
    check('恢复接口返回成功', rs.json && rs.json.code === 0, JSON.stringify(rs.json && rs.json.message));

    console.log('\n########## 5. 立即验证（恢复应马上生效，不需重启）##########');
    const r1 = await req('GET', `/api/v1/daily-records/${DATE}?pregnancy_id=${pid}`);
    const d1 = (r1.json && r1.json.data) || {};
    check('立即读到的就是「旧数据」', d1.note === MARK_OLD, `note=${JSON.stringify(d1.note)}`);
    check('腰围也回到备份时的值', Number(d1.waist) === 85, `waist=${JSON.stringify(d1.waist)}`);
    check('三围齐全（胸/腰/臀）', Number(d1.bust) === 92 && Number(d1.hip) === 95,
      `bust=${d1.bust} hip=${d1.hip}`);

    console.log(`\n########## 6. 等一个落盘周期（${Math.round(SAVE_TICK_MS / 1000)} 秒）后再看 ##########`);
    console.log('（这一步是判定点：修复前，30 秒后自动落盘会把「新数据」写回去）');
    await sleep(SAVE_TICK_MS);
    const r2 = await req('GET', `/api/v1/daily-records/${DATE}?pregnancy_id=${pid}`);
    const d2 = (r2.json && r2.json.data) || {};
    check('落盘周期后仍是「旧数据」（恢复没有被写回）', d2.note === MARK_OLD, `note=${JSON.stringify(d2.note)}`);

    // 直接查磁盘上的库文件，确认内存与磁盘一致
    const raw = fs.readFileSync(path.join(T, 'pj.db'));
    check('磁盘上的库文件里也含「旧数据」标记',
      raw.includes(Buffer.from(MARK_OLD)), '（内存与磁盘一致）');
    check('磁盘上的库文件里不含「新数据」标记',
      !raw.includes(Buffer.from(MARK_NEW)), '');

    console.log('\n########## 7. 恢复一个非法文件（应失败且回滚）##########');
    const junk = path.join(T, 'backups', 'backup_20990101-000000.db');
    fs.writeFileSync(junk, Buffer.from('这不是一个 SQLite 文件'));
    const bad = await req('POST', '/api/v1/export/restore-db', { backup_path: junk });
    check('非法备份文件被拒绝', !!(bad.json && bad.json.code === 1001), JSON.stringify(bad.json && bad.json.message));
    const r3 = await req('GET', `/api/v1/daily-records/${DATE}?pregnancy_id=${pid}`);
    const d3 = (r3.json && r3.json.data) || {};
    check('被拒绝后数据仍是「旧数据」（回滚成功、应用没坏）', d3.note === MARK_OLD, `note=${JSON.stringify(d3.note)}`);
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.join('').slice(-1500));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();
