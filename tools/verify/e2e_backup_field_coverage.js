/**
 * 「备份 → 恢复」字段覆盖度往返测试
 *
 * 防的是什么：
 *   恢复走的是 TABLE_COLUMNS 白名单（/restore-latest 先 DELETE FROM 表 再按白名单插入），
 *   所以**白名单里没有的列会在恢复时被永久丢掉** —— 备份里有也白搭。
 *   曾经漏掉：daily_record 的 bust/waist/hip（三围）、diary_entry.title、reminder.priority，
 *   以及整张 schedule_dates 表（用户改过的产检日期）压根不在备份范围内。
 *
 * 做法：写真数据 → 备份 → 删掉源数据 → 恢复 → 逐字段核对是否原样回来。
 * 用法：node e2e_backup_field_coverage.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-coverage-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38485);
const AUTH_DIR = path.join(T, 'authorized');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

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

  // 等服务就绪
  for (let i = 0; i < 40; i++) {
    try { const h = await req('GET', '/api/health'); if (h.json && h.json.status === 'ok') break; } catch {}
    await sleep(500);
  }

  try {
    const p = await req('POST', '/api/v1/pregnancies', { last_period_date: '2026-01-01', baby_name: '覆盖度测试' });
    const pid = p.json && p.json.data && p.json.data.id;
    if (!pid) throw new Error('建孕期失败: ' + JSON.stringify(p.json));

    console.log('\n########## 1. 写入各类数据 ##########');
    const STAMP = Date.now();
    const w = await req('POST', '/api/v1/daily-records', {
      pregnancy_id: pid, record_date: '2026-09-25',
      weight: 62.5, bust: 92, waist: 85, hip: 95,
      edema_level: 'mild', urination_frequency: 'frequent',
    });
    check('三围 + 新记录项写入成功', w.json && w.json.code === 0, JSON.stringify(w.json && w.json.message));

    const d = await req('POST', '/api/v1/diaries', {
      pregnancy_id: pid, entry_date: '2026-09-25', title: '标题_' + STAMP, content: '正文内容', mood: 4,
    });
    check('日记（含标题）写入成功', d.json && d.json.code === 0, JSON.stringify(d.json && d.json.message));

    const rm = await req('POST', '/api/v1/reminders', {
      pregnancy_id: pid, title: '提醒_' + STAMP, trigger_date: '2026-10-01', trigger_time: '09:00',
      reminder_type: 'custom', priority: 'high',
    });
    const remId = rm.json && rm.json.data && rm.json.data.id;
    // 注：POST /reminders 目前**不接收** priority（该列一直是默认值），
    // 所以这里只断言提醒本身写进去了；priority 走「往返一致」而不是「等于 high」。
    const remPriorityBefore = rm.json && rm.json.data && rm.json.data.priority;
    check('提醒写入成功', rm.json && rm.json.code === 0, JSON.stringify(rm.json && rm.json.message));

    // 日记插图：直接放一个文件到 PHOTOS_DIR/diary（相当于用户此前上传的插图），
    // 日记正文里存的就是文件名 —— 备份/恢复必须原样带回，否则插图全 404。
    const diaryImgName = `img_${STAMP}.jpg`;
    const diaryImgPath = path.join(T, 'photos', 'diary', diaryImgName);
    fs.mkdirSync(path.dirname(diaryImgPath), { recursive: true });
    fs.writeFileSync(diaryImgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    check('日记插图已就位（模拟此前上传）', fs.existsSync(diaryImgPath));

    console.log('\n########## 2. 备份 ##########');
    const bk = await req('POST', '/api/v1/backup', { dir: AUTH_DIR });
    check('备份成功', bk.json && bk.json.code === 0, JSON.stringify(bk.json && bk.json.message));
    const bkDir = bk.json && bk.json.data && bk.json.data.dir;
    const dataJson = path.join(bkDir || '', 'data.json');
    const backupRaw = fs.existsSync(dataJson) ? JSON.parse(fs.readFileSync(dataJson, 'utf-8')) : null;
    check('备份文件可解析', !!backupRaw);
    if (backupRaw) {
      const dr = (backupRaw.tables.daily_record || [])[0] || {};
      check('备份里带上了三围（导出侧本来就是 SELECT *）',
        dr.bust === 92 && dr.waist === 85 && dr.hip === 95, JSON.stringify({ bust: dr.bust, waist: dr.waist, hip: dr.hip }));
      check('备份里带上了日记标题', ((backupRaw.tables.diary_entry || [])[0] || {}).title === '标题_' + STAMP);
      check('备份里带上了提醒优先级列（值可空，但列必须在）',
        'priority' in ((backupRaw.tables.reminder || [])[0] || {}),
        JSON.stringify((backupRaw.tables.reminder || [])[0] || {}).slice(0, 120));
      check('备份里包含 schedule_dates 表', Array.isArray(backupRaw.tables.schedule_dates));
    }

    console.log('\n########## 3. 删掉源数据（制造「恢复前是空的」场景）##########');
    // 删除接口是 /daily-records/:record_id
    const recId = w.json && w.json.data && w.json.data.id;
    const delRec = await req('DELETE', `/api/v1/daily-records/${recId}`);
    check('删除日常记录成功', delRec.json && delRec.json.code === 0, JSON.stringify(delRec.json && delRec.json.message));
    const diaries = await req('GET', `/api/v1/diaries?pregnancy_id=${pid}`);
    for (const it of ((diaries.json && diaries.json.data && (diaries.json.data.items || diaries.json.data.list)) || [])) {
      await req('DELETE', `/api/v1/diaries/${it.id}`);
    }
    const gone = await req('GET', `/api/v1/daily-records/2026-09-25?pregnancy_id=${pid}`);
    check('源数据已清空（恢复前确实是空的）', !(gone.json && gone.json.data), 'code=' + (gone.json && gone.json.code));
    // 连插图文件一起删掉，才能验证恢复真的把它带回来了
    fs.rmSync(diaryImgPath, { force: true });
    check('日记插图也已删除（制造「恢复前不存在」）', !fs.existsSync(diaryImgPath));

    console.log('\n########## 4. 恢复备份 ##########');
    const rl = await req('POST', '/api/v1/restore-latest', {});
    check('恢复成功', rl.json && rl.json.code === 0, JSON.stringify(rl.json && rl.json.message));

    console.log('\n########## 5. 逐字段核对恢复结果 ##########');
    const back = await req('GET', `/api/v1/daily-records/2026-09-25?pregnancy_id=${pid}`);
    const r = (back.json && back.json.data) || {};
    check('三围回来了：bust', r.bust === 92, `实际 ${JSON.stringify(r.bust)}`);
    check('三围回来了：waist', r.waist === 85, `实际 ${JSON.stringify(r.waist)}`);
    check('三围回来了：hip', r.hip === 95, `实际 ${JSON.stringify(r.hip)}`);
    check('其他记录项照常（体重）', r.weight === 62.5, `实际 ${JSON.stringify(r.weight)}`);
    check('新增记录项照常（水肿/排尿）', r.edema_level === 'mild' && r.urination_frequency === 'frequent');

    const d2 = await req('GET', `/api/v1/diaries?pregnancy_id=${pid}`);
    const dlist = (d2.json && d2.json.data && (d2.json.data.items || d2.json.data.list)) || [];
    const restoredDiary = dlist.find((x) => String(x.title || '') === '标题_' + STAMP);
    check('日记标题回来了', !!restoredDiary, restoredDiary ? '' : JSON.stringify(dlist.map((x) => x.title)));

    const r2 = await req('GET', `/api/v1/reminders?pregnancy_id=${pid}`);
    const rlist = (r2.json && r2.json.data && (r2.json.data.items || r2.json.data.list)) || (Array.isArray(r2.json && r2.json.data) ? r2.json.data : []);
    check('日记插图文件被恢复（一键恢复也带回来了）', fs.existsSync(diaryImgPath),
      fs.existsSync(diaryImgPath) ? '' : '缺失: ' + diaryImgPath);

    const restoredRem = rlist.find((x) => String(x.title || '') === '提醒_' + STAMP);
    check('提醒回来了且优先级值往返一致',
      !!restoredRem && String(restoredRem.priority) === String(remPriorityBefore),
      restoredRem ? `恢复前=${remPriorityBefore} 恢复后=${restoredRem.priority}` : '未找到该提醒');
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.join('').slice(-1200));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();
