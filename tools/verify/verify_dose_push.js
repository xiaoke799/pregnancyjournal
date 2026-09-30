/**
 * 用药 / 补充「到点提醒」真链路 —— 重点验证用户最在意的一条：
 * **打完卡，当天就不再提醒**。
 *
 * 做法：本地起一个假 Webhook（按企业微信约定返回 {errcode:0}），
 *       然后直接 require push-engine，手动调 doseReminderTick（不用等 60 秒心跳）。
 *
 * ⚠️ `await db.initDb()` 别写成 `await db.initDb ? db.initDb() : db.init()`：
 *    后者会被解析成 `(await db.initDb) ? ... : ...`，initDb() 根本没等
 *    （第一版就栽在这，表现为 "Database not initialized"）。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const { SERVER_DIR, TMP } = require('./_env');

const received = [];
let pass = 0;
let failed = 0;
function assert(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    failed++;
    console.log('  🔴 ' + name + (extra ? '  → ' + extra : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- 1. 假 Webhook ----
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));   // 企业微信成功约定
    });
  });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const hookPort = hook.address().port;
  console.log(`假 Webhook: http://127.0.0.1:${hookPort}/hook`);

  // ---- 2. 数据目录 + 环境 ----
  fs.mkdirSync(TMP, { recursive: true });
  const tmpData = path.join(TMP, 'dose_push_' + Date.now());
  fs.mkdirSync(path.join(tmpData, 'config'), { recursive: true });
  process.env.STORAGE_DIR = tmpData;
  process.env.DATA_DIR = tmpData;
  process.env.TRIM_PKGVAR = tmpData;
  process.env.TRIM_APPDEST = SERVER_DIR;
  process.env.APP_MODE = 'dev';

  const config = require(path.join(SERVER_DIR, 'config'));
  console.log('DATA_DIR =', config.DATA_DIR, '\n');

  // 直接写渠道配置（绕过 saveChannelConfig 的地址白名单，才能指向本地假服务）
  const cfgFile = path.join(config.DATA_DIR, 'wecom.json');
  fs.writeFileSync(cfgFile, JSON.stringify({
    webhook_url: `http://127.0.0.1:${hookPort}/hook`,
    secret: '',
    configured: true,
    enabled: true,
    push_checkup: false,
    push_daily: false,
    push_reminder: false,
    push_dose: true,
    push_time: '23:59',      // 让每日看板不要抢戏
  }, null, 2));

  // ---- 3. 初始化数据库 ----
  const db = require(path.join(SERVER_DIR, 'db'));
  await db.initDb();
  const health = db.getDbHealth();
  console.log('数据库已初始化, ok =', health && health.ok);
  if (!health || !health.ok) {
    console.log('❌ 数据库未就绪:', health && health.reason);
    hook.close();
    process.exit(1);
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowHm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const lmp = new Date(Date.now() - 140 * 86400000).toISOString().slice(0, 10);

  db.run(
    `INSERT OR REPLACE INTO pregnancy (id, last_period_date, due_date, is_active, baby_name, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ['dose-push-1', lmp, new Date(Date.now() + 140 * 86400000).toISOString().slice(0, 10), '推送探针']
  );

  const pushEngine = require(path.join(SERVER_DIR, 'services/push-engine'));

  const mkPlan = (name, kind, times, extra = {}) => {
    const id = 'plan-' + name;
    db.run(
      `INSERT OR REPLACE INTO dose_plan (id, pregnancy_id, kind, name, dosage, reminder_times, frequency, note, is_enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, 'dose-push-1', kind, name, '50μg', JSON.stringify(times), extra.frequency || 'daily', extra.note || '']
    );
    return id;
  };

  try {
    // ---- 4. 只推到点的那个 ----
    console.log(`【1】建方案：优甲乐（提醒时间 = 现在 ${nowHm}）、钙片（23:00，还没到点）`);
    const euthyrox = mkPlan('优甲乐', 'medication', [nowHm], { note: '早餐前空腹' });
    mkPlan('钙片', 'supplement', ['23:00']);

    console.log('\n【2】触发一次提醒调度');
    received.length = 0;
    await pushEngine.doseReminderTick(now, today, nowMinutes);
    await sleep(400);
    assert('收到 1 条推送', received.length === 1, `实际 ${received.length} 条`);
    const text1 = ((JSON.parse(received[0] || '{}').text || {}).content) || '';
    assert('推送的是优甲乐', text1.includes('优甲乐'), text1.slice(0, 60));
    assert('带上了医嘱备注（空腹）', text1.includes('空腹'), text1.slice(0, 80));
    assert('没推还没到点的钙片', !text1.includes('钙片'), text1.slice(0, 80));
    assert('提示打完卡不再提醒', text1.includes('打卡'), text1.slice(0, 120));
    console.log('  推送正文：\n' + text1.split('\n').map((l) => '    ' + l).join('\n'));

    // ---- 5. 同一顿不重复推 ----
    console.log('\n【3】同一顿再触发一次（幂等）');
    received.length = 0;
    await pushEngine.doseReminderTick(now, today, nowMinutes);
    await sleep(300);
    assert('未重复推送', received.length === 0, `实际又推了 ${received.length} 条`);

    // ---- 6. 打卡后不再推（用户最在意的一条）----
    console.log('\n【4】打卡后再触发 ⇒ 应当不再提醒');
    db.run(
      'INSERT OR REPLACE INTO dose_checkin (id, pregnancy_id, plan_id, date, taken_at, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      ['ck-1', 'dose-push-1', euthyrox, today]
    );
    received.length = 0;
    await pushEngine.doseReminderTick(now, today, nowMinutes);
    await sleep(300);
    assert('打卡后不再推送', received.length === 0, `实际又推了 ${received.length} 条`);

    // ---- 7. 关开关 ----
    console.log('\n【5】关掉「用药提醒」开关 ⇒ 应当不推');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    cfg.push_dose = false;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
    db.run('DELETE FROM dose_checkin WHERE plan_id = ?', [euthyrox]);
    mkPlan('优甲乐2号', 'medication', [nowHm]);       // 新方案名，绕开"已推送"状态
    received.length = 0;
    await pushEngine.doseReminderTick(now, today, nowMinutes);
    await sleep(300);
    assert('开关关闭后不推送', received.length === 0, `实际推了 ${received.length} 条`);

    // ---- 8. 恢复开关后应能推（反例：证明上面不是别的原因没推）----
    console.log('\n【6】恢复开关后应能正常推（反向验证）');
    const cfg2 = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    cfg2.push_dose = true;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg2, null, 2));
    received.length = 0;
    await pushEngine.doseReminderTick(now, today, nowMinutes);
    await sleep(400);
    assert('恢复开关后能推送', received.length === 1, `实际 ${received.length} 条`);
    const t2 = ((JSON.parse(received[0] || '{}').text || {}).content) || '';
    assert('推的是优甲乐2号', t2.includes('优甲乐2号'), t2.slice(0, 60));

    // ---- 9. 推送记录落库 ----
    console.log('\n【7】推送记录');
    const logs = db.queryAll("SELECT push_type, status, push_content FROM push_log WHERE push_type='dose'");
    assert('dose 类型记录已落库', logs.length >= 2, JSON.stringify(logs.slice(0, 3)));
    assert(
      '记录内容是可机读格式（重启后可恢复状态）',
      logs.every((l) => /^用药\/补充提醒\|[^|]+\|\d{2}:\d{2}$/.test(l.push_content)),
      JSON.stringify(logs.map((l) => l.push_content))
    );
    assert('状态为 success', logs.every((l) => l.status === 'success'));
  } catch (e) {
    failed++;
    console.log('  🔴 用例执行异常: ' + (e.stack || e.message));
  }

  console.log(`\n==== 结果：${pass} 通过 / ${failed} 失败 ====`);
  hook.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('套件出错:', e.stack || e.message);
  process.exit(1);
});
