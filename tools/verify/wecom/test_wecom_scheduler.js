/**
 * 企业微信定时推送调度器测试（隔离环境）
 * 覆盖：到点才推 / 失败不放弃（会自动重试）/ 成功后不重复推 / 错过太久补推窗口 / 重启不重复推
 * 手法：捕获 setInterval 不真跑定时器，手动调用 tick；用 Date.now 偏移模拟「5分钟后」
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const APP = require('../_env').SERVER_DIR;
const NM = path.join(APP, 'node_modules');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-sched-test-'));
const STORAGE = path.join(TMP, 'storage');
const ASSETS = path.join(TMP, 'assets');
fs.mkdirSync(STORAGE, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });
fs.copyFileSync(path.join(APP, 'data', 'checkup_schedule.json'), path.join(ASSETS, 'checkup_schedule.json'));

process.env.STORAGE_DIR = STORAGE;
process.env.DATA_DIR = STORAGE;
process.env.ASSETS_DIR = ASSETS;
process.env.DATABASE_PATH = path.join(STORAGE, 'pregnancy-journal.db');
process.env.APP_MODE = 'dev';

const express = require(path.join(NM, 'express'));
const db = require(path.join(APP, 'db.js'));
const log = require(path.join(APP, 'logger.js'));

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { pass++; results.push(`  ✔ ${name}`); }
  else { fail++; results.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

// ---- 模拟企业微信 ----
const hits = { ok: 0, perm: 0 };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    if (req.url === '/ok') { hits.ok++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"errcode":0,"errmsg":"ok"}'); }
    if (req.url === '/perm') { hits.perm++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"errcode":93000,"errmsg":"invalid webhook url"}'); }
    res.writeHead(404); res.end('nope');
  });
});
const PORT = 39125;
const BASE = `http://127.0.0.1:${PORT}`;

function writeWecomConfig(extra) {
  fs.writeFileSync(path.join(STORAGE, 'wecom.json'), JSON.stringify({
    webhook_url: BASE + '/ok', configured: true, enabled: true,
    push_checkup: true, push_daily: true, push_reminder: true, push_time: '00:00',
    ...extra,
  }, null, 2));
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

(async () => {
  await new Promise(r => mock.listen(PORT, '127.0.0.1', r));
  await db.initDb();
  log.init(path.join(STORAGE, 'logs'));

  const P1 = 'preg-sched-1';
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, is_active) VALUES (?,?,?,1)', [P1, '2026-01-01', '2026-10-08']);

  // ---- 捕获定时器回调，不让它自己跑 ----
  let tick = null;
  const realSetInterval = global.setInterval;
  global.setInterval = (fn) => { tick = fn; return 0; };

  const WECOM = path.join(APP, 'routes', 'wecom.js');

  // 模拟「应用重启」：推送引擎已抽到 services/push-engine.js，
  // 只清 wecom.js 缓存不够（引擎与路由工厂仍是旧实例），必须整条链路一起清。
  const PUSH_MODULES = [
    path.join(APP, 'routes', 'wecom.js'),
    path.join(APP, 'routes', 'feishu.js'),
    path.join(APP, 'routes', 'push.js'),
    path.join(APP, 'routes', 'push-channel-router.js'),
    path.join(APP, 'services', 'push-engine.js'),
  ];
  function reloadPushModules() {
    for (const m of PUSH_MODULES) {
      try { delete require.cache[require.resolve(m)]; } catch { /* ignore */ }
    }
    global.setInterval = (fn) => { tick = fn; return 0; };
    require(WECOM);
    global.setInterval = realSetInterval;
  }

  reloadPushModules();
  check('调度器已注册定时任务', typeof tick === 'function');

  const realNow = Date.now.bind(Date);
  let offset = 0;

  // ========== 1. 尚未到推送时间 → 不推 ==========
  writeWecomConfig({ push_time: hhmm((nowMinutes() + 60) % 1440) }); // 1 小时后
  hits.ok = 0;
  await tick();
  check('未到推送时间不推送', hits.ok === 0, '实际请求=' + hits.ok);

  // ========== 2. 到点 → 推送一次 ==========
  writeWecomConfig({ push_time: hhmm(nowMinutes()) });
  hits.ok = 0;
  await tick();
  check('到点后自动推送', hits.ok === 1, '实际请求=' + hits.ok);
  let rows = db.queryAll("SELECT status FROM push_log WHERE push_type='daily'");
  check('日志记录成功', rows.length === 1 && rows[0].status === 'success', JSON.stringify(rows));

  // ========== 3. 成功后不再重复推 ==========
  await tick();
  check('同一天成功推送后不重复推送', hits.ok === 1, '实际请求=' + hits.ok);

  // ========== 4. 失败不放弃：失败后 5 分钟自动重试 ==========
  db.run("DELETE FROM push_log");
  writeWecomConfig({ push_time: hhmm(nowMinutes()), webhook_url: BASE + '/perm' });
  // 模拟应用重启，清掉上一个用例留下的「今天已推成功」内存状态
  reloadPushModules();

  hits.perm = 0;
  await tick();
  check('推送失败会记录失败日志', hits.perm === 1
    && db.queryOne("SELECT status FROM push_log WHERE push_type='daily' ORDER BY created_at DESC LIMIT 1").status === 'failed',
    '请求=' + hits.perm);
  check('没有成功记录（不会假装推过）',
    db.queryAll("SELECT id FROM push_log WHERE push_type='daily' AND status='success'").length === 0);

  // 立刻再 tick：处于 5 分钟冷却期 → 不发
  await tick();
  check('失败后 5 分钟内不重复轰炸', hits.perm === 1, '实际请求=' + hits.perm);

  // 模拟「5 分钟后」→ 应自动重试
  Date.now = () => realNow() + (offset += 6 * 60 * 1000);
  await tick();
  check('失败后会自动重试（关键修复）', hits.perm === 2, '实际请求=' + hits.perm);

  // ========== 5. 重试成功 ==========
  writeWecomConfig({ push_time: hhmm(nowMinutes()), webhook_url: BASE + '/ok' });
  hits.ok = 0;
  Date.now = () => realNow() + (offset += 6 * 60 * 1000);
  await tick();
  check('故障恢复后重试成功', hits.ok === 1, '实际请求=' + hits.ok);
  await tick();
  check('成功后当天不再推送', hits.ok === 1, '实际请求=' + hits.ok);

  // ========== 6. 重启后不重复推送 ==========
  reloadPushModules();
  hits.ok = 0;
  await tick();
  check('应用重启后当天不会重复推送', hits.ok === 0, '实际请求=' + hits.ok);

  // ========== 7. 错过太久（>3小时）不再补推 ==========
  if (nowMinutes() >= 240) {
    db.run('DELETE FROM push_log');
    writeWecomConfig({ push_time: hhmm(nowMinutes() - 240) }); // 4 小时前
    reloadPushModules();
    hits.ok = 0;
    await tick();
    check('错过超过 3 小时不补推（避免深夜扰民）', hits.ok === 0, '实际请求=' + hits.ok);
  } else {
    results.push('  － 错过后补推窗口用例跳过（当前时间距零点不足 4 小时）');
  }

  // ========== 8. 关闭开关 / 未配 webhook → 不推 ==========
  writeWecomConfig({ push_time: hhmm(nowMinutes()), enabled: false });
  hits.ok = 0;
  Date.now = () => realNow() + (offset += 6 * 60 * 1000);
  await tick();
  check('推送开关关闭时不推送', hits.ok === 0, '实际请求=' + hits.ok);

  writeWecomConfig({ push_time: hhmm(nowMinutes()), push_daily: false, push_checkup: false, push_reminder: false });
  hits.ok = 0;
  Date.now = () => realNow() + (offset += 6 * 60 * 1000);
  await tick();
  check('三项内容全不勾时不推送', hits.ok === 0, '实际请求=' + hits.ok);

  Date.now = realNow;
  mock.close();

  console.log('\n============ 企业微信定时推送调度器测试 ============');
  console.log(results.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(2); });
