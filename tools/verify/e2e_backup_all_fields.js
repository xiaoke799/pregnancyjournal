/**
 * 全字段备份 / 恢复往返（真后端）
 *
 * 【背景】用户问：「所有记录和前几天新增的记录，进去备份没有？」
 * 已有 `e2e_backup_field_coverage` 只覆盖了 bust/waist/hip/edema_level/urination_frequency
 * 五个较新字段；**用药（medication）、宫缩、胎动、补充剂、爱爱、饮水、好习惯、计划、
 * 症状、服药、饮食备注**等它都没有验证。
 *
 * 本脚本把 daily_record 的**所有列一次填满**，然后：
 *   ① 备份 → 直接读备份目录里的 data.json，逐字段确认「确实写进了备份」；
 *   ② 把记录删掉（模拟数据丢失）→ 从最近备份恢复 → 逐字段比对「恢复回来的值一致」。
 * 两条都过，才算真的"进备份了"。
 *
 * 用法：node e2e_backup_all_fields.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const env = require('./_env');
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38551);
const T = path.join(env.TMP, 'backup-all-fields');
const AUTH_DIR = path.join(T, 'authorized');
const STAMP = Date.now();
const DATE = '2026-09-25';

fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

const serverEnv = {
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
  TRIM_DATA_ACCESSIBLE_PATHS: AUTH_DIR,
};

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) {
  if (!pid) return;
  try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

// 把 daily_record 的所有用户可见列一次填满（值都带 STAMP 便于识别是本次写入的）
const REC = {
  weight: 64.2,
  blood_pressure_systolic: '118',
  blood_pressure_diastolic: '76',
  fetal_heart_rate: 145,
  body_temperature: 36.6,
  bust: 88, waist: 92, hip: 96,
  blood_glucose_fasting: 4.8, blood_glucose_1h: 7.2, blood_glucose_2h: 6.1,
  mood: '4',
  mood_note: `心情备注${STAMP}`,
  sleep_hours: 7.5,
  sleep_quality: 'good',
  water_intake: 1800,
  exercise_type: `散步${STAMP}`,
  exercise_duration: 30,
  edema_level: 'mild',
  vaginal_discharge: 'normal',
  skin_condition: 'normal',
  urination_frequency: 'normal',
  hcg_value: 50000, hcg_weeks: 6,
  uric_acid: 250, uric_acid_period: '空腹',
  habit_text: `早睡${STAMP}`,
  plan_text: `下次产检${STAMP}`,
  plan_date: '2026-10-08',
  is_plan_done: 0,
  note: `当天备注${STAMP}`,
  // —— 下面这些是「较新 / 容易被漏」的记录项，重点核对 ——
  medication: JSON.stringify([{ name: `叶酸片${STAMP}`, dosage: '0.4mg', frequency: '一日一次' }]),
  supplement_record: JSON.stringify([{ name: `叶酸${STAMP}` }]),
  symptoms: JSON.stringify([`腰痛${STAMP}`]),
  stool_record: JSON.stringify({ count: 1, consistency: 'normal', color: 'brown' }),
  diet_note: JSON.stringify([{ type: '早餐', content: `小米粥${STAMP}` }]),
  intimacy_record: JSON.stringify({ count: 1, has_protection: 'yes', protection_type: 'condom' }),
  contraction_count: 2, contraction_interval: 8, contraction_duration: 45, contraction_pain: '明显',
  fetal_movement_count: 12, fetal_movement_duration: 20,
};
// 这些列不参与"值相等"比对（由服务端维护）
const SKIP = new Set(['id', 'pregnancy_id', 'record_date', 'created_at', 'updated_at']);

(async () => {
  const SHIM = path.join(env.VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => killTree(child.pid);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const h = await req('GET', '/app/pregnancyjournal/api/health'); if (h.json && h.json.status === 'ok') { ready = true; break; } } catch (e) { /* 等 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1000)); cleanup(); process.exit(2); }

  const GW = '/app/pregnancyjournal';
  const p = await req('POST', GW + '/api/v1/pregnancies', { last_period_date: '2026-01-01', baby_name: `全字段备份${STAMP}` });
  const pid = p.json && p.json.data && p.json.data.id;
  check('建孕期', !!pid, JSON.stringify(p.json && p.json.message));
  if (!pid) { cleanup(); process.exit(2); }

  console.log('\n########## 1. 写入全字段记录 ##########');
  const w = await req('POST', GW + '/api/v1/daily-records', { pregnancy_id: pid, record_date: DATE, ...REC });
  check('全字段记录写入成功', w.json && w.json.code === 0, JSON.stringify(w.json && w.json.message));

  console.log('\n########## 2. 备份，并直接检查备份内容 ##########');
  const bk = await req('POST', GW + '/api/v1/backup', { dir: AUTH_DIR });
  check('备份成功', bk.json && bk.json.code === 0, JSON.stringify(bk.json && bk.json.message));
  const bkDir = bk.json && bk.json.data && bk.json.data.dir;
  const dataJson = path.join(bkDir || '', 'data.json');
  check('备份产物存在（data.json）', fs.existsSync(dataJson), dataJson);

  let backupRow = null;
  if (fs.existsSync(dataJson)) {
    const raw = JSON.parse(fs.readFileSync(dataJson, 'utf-8'));
    // ⚠️ 表数据在 `tables` 下面（顶层是 {version, exported_at, app_name, tables, file_manifest}），
    //    直接取 raw.daily_record 会全部读成 undefined ⇒ 43 个字段「没进备份」的假红。
    const rows = (raw && raw.tables && raw.tables.daily_record) || [];
    backupRow = rows.find((r) => r.record_date === DATE) || null;
  }
  check('备份里找得到这条记录', !!backupRow);

  console.log('\n【备份内容逐字段核对】');
  let missInBackup = 0;
  for (const [k, v] of Object.entries(REC)) {
    if (SKIP.has(k)) continue;
    const has = backupRow && backupRow[k] !== undefined && backupRow[k] !== null;
    if (!has) { missInBackup++; out.push(`  ✘ ${k}: 备份里没有（值应为 ${String(v).slice(0, 24)}）`); }
  }
  check(`${Object.keys(REC).length} 个字段全部出现在备份里`, missInBackup === 0,
    missInBackup + ' 个字段没进备份');

  console.log('\n########## 3. 删掉记录 → 从备份恢复 → 逐字段比对 ##########');
  const recId = w.json && w.json.data && w.json.data.id;
  await req('DELETE', `${GW}/api/v1/daily-records/${recId}`);
  const gone = await req('GET', `${GW}/api/v1/daily-records/${DATE}?pregnancy_id=${pid}`);
  check('记录已删除（制造丢失现场）', !(gone.json && gone.json.data), '删除没生效，后面的恢复验证无意义');

  const rl = await req('POST', GW + '/api/v1/restore-latest', {});
  check('从最近备份恢复成功', rl.json && rl.json.code === 0, JSON.stringify(rl.json && rl.json.message));

  // 恢复会重置数据库连接，等落盘/重载
  await sleep(800);
  const back = await req('GET', `${GW}/api/v1/daily-records/${DATE}?pregnancy_id=${pid}`);
  const row = back.json && back.json.data;
  check('恢复后这条记录回来了', !!row);

  console.log('\n【恢复结果逐字段比对】');
  let mismatched = 0;
  if (row) {
    for (const [k, v] of Object.entries(REC)) {
      if (SKIP.has(k)) continue;
      const got = row[k];
      // 统一按字符串比：库里可能是数字/字符串，JSON 列两边都是字符串
      const a = String(got === undefined || got === null ? '' : got).trim();
      const b = String(v).trim();
      if (a !== b) {
        mismatched++;
        out.push(`  ✘ ${k}: 恢复后 ${a.slice(0, 30)} ≠ 写入时 ${b.slice(0, 30)}`);
      }
    }
  }
  check(`${Object.keys(REC).length} 个字段恢复后值全部一致`, row ? mismatched === 0 : false,
    row ? mismatched + ' 个字段不一致' : '记录没回来');

  console.log(out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
