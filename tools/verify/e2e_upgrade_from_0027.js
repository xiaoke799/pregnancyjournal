/**
 * 「线上老库 → 最新版」升级闸门（发布前必跑）。
 *
 * 背景：线上是 **v0.0.27**（2026-09-03），下一版要跨 6 个版本直升。
 * 静态看结构差异（新列是否都在补列白名单、索引是否幂等）只是"看起来没问题"，
 * **结构检查 ≠ 升级成功** —— 0.0.31 就吃过这个亏。本套件真跑：
 *
 *   ① 用 fixtures/schema-v0.0.27.sql 造一个**真老结构**的库 + 灌典型老数据
 *   ② 用**当前工作区代码**启动服务（真实迁移逻辑）
 *   ③ 断言：结构补全 / 老数据可读 / 迁移幂等 / 新功能在老库上可用
 *
 * ⚠️ 两条防假绿设计（否则这套件会变成"永远绿"）：
 *   · 开头**先断言老库确实是老结构**（缺 waist 列等）—— 夹具被误改会立刻暴露；
 *   · 幂等段**真的重启一次**比对，不是"再读一遍"。
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const { SERVER_DIR, SERVER_ENTRY, UI_DIR, FIXTURES, TMP, NODE } = require('./_env');
const SCHEMA_0027 = path.join(FIXTURES, 'schema-v0.0.27.sql');

const PORT = 38651;
const PREFIX = '/app/pregnancyjournal';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}/api/v1`;
const PG = 'upgrade-pg-1';

let pass = 0;
let failed = 0;
const assert = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  🔴 ' + name + (extra ? '  → ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 造「真实老库」：0.0.27 的结构 + 一批那个年代会有的数据 */
async function seedLegacyDb(dbPath) {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs();
  const d = new SQL.Database();

  const sql = fs.readFileSync(SCHEMA_0027, 'utf8');
  d.exec(sql);            // 夹具里已是纯 SQL + `--` 注释（SQLite 自己能认）

  // ---- 防假绿①：确认拿到的确实是「老结构」 ----
  const cols = (t) => {
    const r = d.exec(`PRAGMA table_info(${t})`);
    return r.length ? r[0].values.map((v) => v[1]) : [];
  };
  const drCols = cols('daily_record');
  const plCols = cols('push_log');
  if (drCols.includes('waist')) throw new Error('夹具不是老结构：daily_record 已有 waist 列');
  if (plCols.includes('channel')) throw new Error('夹具不是老结构：push_log 已有 channel 列');
  if (cols('dose_plan').length) throw new Error('夹具不是老结构：竟然已有 dose_plan 表');

  // ---- 灌典型老数据（列集按 0.0.27，不含任何新列）----
  const now = '2026-09-03 10:00:00';
  d.run(`INSERT INTO pregnancy (id, last_period_date, conception_date, due_date, is_active, baby_name, created_at, updated_at)
         VALUES (?,?,?,?,1,?,?,?)`,
    [PG, '2026-05-12', '2026-05-26', '2027-02-16', '老库宝宝', now, now]);

  // 每日记录：含 6 天，睡眠质量用 0.0.27 时代的**英文**取值；其中一天混入**中文**老值（更早版本遗留）
  // 列集严格按 0.0.27（该版本 daily_record 没有 remark 列，当天备注存在 note）
  const daily = [
    ['2026-08-29', 58.2, 7.5, 'good', null],
    ['2026-08-30', 58.4, 6.0, 'fair', null],
    ['2026-08-31', 58.5, 8.0, '好', null],
    ['2026-09-01', 58.6, 5.5, 'poor', null],
    ['2026-09-02', 58.7, 7.0, 'fair', '孕期日记老数据'],
    ['2026-09-03', 58.8, 6.5, 'good', '老库的当天备注'],
  ];
  for (const [dt, w, hrs, q, note] of daily) {
    d.run(`INSERT INTO daily_record (id, pregnancy_id, record_date, weight, sleep_hours, sleep_quality, note, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
      ['dr-' + dt, PG, dt, w, hrs, q, note, now, now]);
  }

  // 产检记录（列集严格按 0.0.27：字段是 checkup_type / is_completed，没有 checkup_name / status）
  d.run(`INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, checkup_type, notes, is_completed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
    ['ck-1', PG, '2026-08-20', 14, 'NT 检查', '老库产检记录', 1, now, now]);
  d.run(`INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, checkup_type, notes, is_completed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
    ['ck-2', PG, '2026-09-20', 19, '四维彩超', '', 0, now, now]);

  // 自定义产检 + 待办 + 清单
  d.run(`INSERT INTO custom_checkup (id, pregnancy_id, name, items, checkup_date, notes, is_completed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,0,?,?)`, ['cc-1', PG, '自费糖筛', '[]', '2026-10-01', '', now, now]);
  d.run(`INSERT INTO reminder (id, pregnancy_id, title, trigger_date, reminder_type, is_completed, created_at, updated_at)
         VALUES (?,?,?,?,?,0,?,?)`, ['rm-1', PG, '老库待办', '2026-09-15', 'custom', now, now]);
  d.run(`INSERT INTO checklist (id, pregnancy_id, type, name, created_at) VALUES (?,?,?,?,?)`,
    ['cl-1', PG, 'hospital', '待产包', now]);
  d.run(`INSERT INTO checklist_item (id, checklist_id, name, category, is_checked, is_custom, is_mandatory, sort_order, created_at)
         VALUES (?,?,?,?,1,0,1,0,?)`, ['cli-1', 'cl-1', '产褥垫', '妈妈', now]);

  // 推送记录：老结构（没有 payload / channel 列）
  d.run(`INSERT INTO push_log (id, push_type, push_content, status, pushed_at, created_at)
         VALUES (?,?,?,?,?,?)`, ['pl-1', 'daily', '老库推送记录', 'success', now, now]);

  // 习惯 / 补剂打卡
  d.run(`INSERT INTO habit_checkin (id, pregnancy_id, date, items, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    ['hc-1', PG, '2026-09-02', '["喝水"]', '', now, now]);
  d.run(`INSERT INTO supplement_checkin (id, pregnancy_id, date, items, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    ['sc-1', PG, '2026-09-02', '[{"name":"叶酸"}]', '', now, now]);

  fs.writeFileSync(dbPath, Buffer.from(d.export()));
  return { dailyCount: daily.length, tables: d.exec("SELECT name FROM sqlite_master WHERE type='table'").length };
}

const api = async (method, url, body) => {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await r.json();
};

/** 起一次服务；返回子进程与收集到的 stderr 文本（迁移日志里有"迁移失败"就看这里） */
function startServer(tmpData, dbPath, logFile) {
  const out = fs.openSync(logFile, 'w');
  const child = spawn(NODE, ['-r', path.join(__dirname, 'tcp_shim.js'), SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PJ_TCP_PORT: String(PORT), APP_MODE: 'dev',
      STORAGE_DIR: tmpData, DATA_DIR: tmpData, DATABASE_PATH: dbPath,
      STATIC_DIR: UI_DIR, ASSETS_DIR: path.join(SERVER_DIR, 'data'),
      TRIM_APPDEST: SERVER_DIR, TRIM_PKGVAR: tmpData,
      LOG_DIR: path.join(tmpData, 'logs'),
    },
    stdio: ['ignore', out, out],
  });
  return child;
}

async function stopServer(child) {
  try { child.kill('SIGKILL'); } catch (e) { /* 已退出 */ }
  await sleep(600);
}

(async () => {
  if (!fs.existsSync(SCHEMA_0027)) {
    console.log('❌ 缺少夹具 fixtures/schema-v0.0.27.sql');
    process.exit(1);
  }
  fs.mkdirSync(TMP, { recursive: true });
  const tmpData = path.join(TMP, 'upgrade_0027_' + Date.now());
  fs.mkdirSync(tmpData, { recursive: true });
  const dbPath = path.join(tmpData, 'pregnancyjournal.db');
  const logFile = path.join(tmpData, 'server.log');

  console.log('【准备】用线上版本结构造老库');
  const seeded = await seedLegacyDb(dbPath);
  console.log(`  老结构表 ${seeded.tables} 张 + 老数据 ${seeded.dailyCount} 天记录（含中/英两套睡眠取值）`);
  assert('夹具确认是老结构（无 waist / channel 列、无 dose_plan 表）', true);

  // ================= 第一次启动（真实迁移） =================
  console.log('\n【1】用当前代码启动（触发真实迁移）');
  let child = startServer(tmpData, dbPath, logFile);
  if (!(await waitPort(PORT))) {
    console.log('❌ 后端没起来');
    console.log(fs.readFileSync(logFile, 'utf8').slice(-1500));
    await stopServer(child);
    process.exit(1);
  }
  console.log('  后端就绪');

  const migratedCols = await api('GET', '/daily-records?pregnancy_id=' + PG).then(() => true).catch(() => false);
  assert('接口可用（迁移后没崩）', migratedCols);

  // ---- 结构层：新列 / 新表 / 新索引 ----
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs();
  const live = new SQL.Database(fs.readFileSync(dbPath));
  const liveCols = (t) => {
    const r = live.exec(`PRAGMA table_info(${t})`);
    return r.length ? r[0].values.map((v) => v[1]) : [];
  };
  const tableNames = (() => {
    const r = live.exec("SELECT name FROM sqlite_master WHERE type='table'");
    return r.length ? r[0].values.map((v) => v[0]) : [];
  })();
  const indexNames = (() => {
    const r = live.exec("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
    return r.length ? r[0].values.map((v) => v[0]) : [];
  })();

  console.log('\n【2】结构补全');
  assert('daily_record 补上 waist/bust/hip', ['waist', 'bust', 'hip'].every((c) => liveCols('daily_record').includes(c)),
    liveCols('daily_record').filter((c) => ['waist', 'bust', 'hip'].includes(c)).join(','));
  // 0.0.33 新增：运动「强度感受」此前根本没有列（小弹窗收了值却从不提交）
  assert('daily_record 补上 exercise_intensity', liveCols('daily_record').includes('exercise_intensity'));
  assert('push_log 补上 payload/channel', ['payload', 'channel'].every((c) => liveCols('push_log').includes(c)));
  assert('reminder 补上 priority', liveCols('reminder').includes('priority'));
  assert('新表 dose_plan 已建', tableNames.includes('dose_plan'));
  assert('新表 dose_checkin 已建', tableNames.includes('dose_checkin'));
  assert('新表 schedule_dates 已建', tableNames.includes('schedule_dates'));
  assert('索引已建（≥15 个）', indexNames.length >= 15, `实际 ${indexNames.length}`);
  assert('老库遗留的废弃列仍在（只加不删，残留无害）',
    liveCols('daily_record').includes('contraction_record'));

  // ---- 数据层：老数据必须读得出来 ----
  console.log('\n【3】老数据可读（这是升级最容易出事的地方）');
  const dailyRes = await api('GET', `/daily-records?pregnancy_id=${PG}`);
  const rows = (dailyRes.data && (dailyRes.data.items || dailyRes.data)) || [];
  assert('每日记录条数与老库一致', Array.isArray(rows) && rows.length >= 6, `实际 ${Array.isArray(rows) ? rows.length : 'N/A'}`);
  if (Array.isArray(rows) && rows.length) {
    const withWaist = rows.filter((r) => r.weight != null);
    assert('老记录的体重值没丢', withWaist.length >= 6, `带体重 ${withWaist.length} 条`);
    const qs = rows.map((r) => r.sleep_quality).filter(Boolean);
    assert('老库英文睡眠取值原样保留', qs.includes('good') && qs.includes('fair') && qs.includes('poor'), qs.join(','));
    assert('更早版本的中文睡眠取值也还在（读时归一由前端负责）', qs.includes('好'), qs.join(','));
    const noteRow = rows.find((r) => r.record_date === '2026-09-03');
    assert('当天备注（note）没被迁移清掉', noteRow && noteRow.note === '老库的当天备注',
      noteRow && noteRow.note);
  }

  const ckRes = await api('GET', `/checkups?pregnancy_id=${PG}`);
  const cks = (ckRes.data && (ckRes.data.items || ckRes.data)) || [];
  assert('老产检记录还在（2 条）', Array.isArray(cks) && cks.length >= 2, `实际 ${Array.isArray(cks) ? cks.length : 'N/A'}`);

  const clRes = await api('GET', `/checklists?pregnancy_id=${PG}`);
  const cls = (clRes.data && (clRes.data.items || clRes.data)) || [];
  assert('老清单还在', Array.isArray(cls) && cls.length >= 1, `实际 ${Array.isArray(cls) ? cls.length : 'N/A'}`);

  const rmRes = await api('GET', `/reminders?pregnancy_id=${PG}`);
  const rms = (rmRes.data && (rmRes.data.items || rmRes.data)) || [];
  assert('老待办还在', Array.isArray(rms) && rms.length >= 1, `实际 ${Array.isArray(rms) ? rms.length : 'N/A'}`);

  // ---- 新功能在老库上可用 ----
  console.log('\n【4】新功能在老库上可用（新表建对了）');
  const mk = await api('POST', '/dose-plans', {
    pregnancy_id: PG, kind: 'medication', name: '优甲乐', dosage: '50μg', reminder_times: ['08:00'],
  });
  assert('老库上能建用药方案', mk.code === 0, JSON.stringify(mk).slice(0, 160));
  if (mk.code === 0) {
    const ck = await api('POST', '/dose-checkins', { pregnancy_id: PG, plan_id: mk.data.id });
    assert('老库上能打卡', ck.code === 0, JSON.stringify(ck).slice(0, 160));
  }

  // ---- 幂等 + 持久化 ----
  console.log('\n【5】迁移幂等 + 新数据持久化（真的重启一次再比对）');
  // ⚠️ 先**等一个完整落盘周期**（db.js 是 setInterval(saveDb, 30000)）再硬杀，
  //    否则测的是「落盘周期」而不是「迁移是否正确」，会得到误导性的红。
  const SAVE_CYCLE_MS = 31000;
  console.log(`  等待一个落盘周期（${SAVE_CYCLE_MS / 1000}s）后再重启…`);
  await sleep(SAVE_CYCLE_MS);

  const before = { daily: rows.length, cks: cks.length };
  await stopServer(child);
  child = startServer(tmpData, dbPath, logFile + '.2');
  if (!(await waitPort(PORT))) {
    console.log('❌ 第二次启动失败');
    console.log(fs.readFileSync(logFile + '.2', 'utf8').slice(-1500));
    await stopServer(child);
    process.exit(1);
  }
  await sleep(500);
  const dailyRes2 = await api('GET', `/daily-records?pregnancy_id=${PG}`);
  const rows2 = (dailyRes2.data && (dailyRes2.data.items || dailyRes2.data)) || [];
  assert('重启后每日记录条数不变（未重复插入）', Array.isArray(rows2) && rows2.length === before.daily,
    `${before.daily} → ${Array.isArray(rows2) ? rows2.length : 'N/A'}`);
  const dose2 = await api('GET', `/dose-plans?pregnancy_id=${PG}`);
  assert('等过落盘周期后重启：老库上新建的用药方案仍在（持久化正常）',
    (dose2.data || []).some((p) => p.name === '优甲乐'), JSON.stringify(dose2).slice(0, 160));

  // ---- 已知阻塞项 D1 的复现（不判红，但要说清楚）----
  console.log('\n【6】顺带复现「上线前检查 D1：业务写入不落盘」');
  const mk2 = await api('POST', '/dose-plans', {
    pregnancy_id: PG, kind: 'supplement', name: '钙片-未落盘', reminder_times: ['20:00'],
  });
  if (mk2.code === 0) {
    await stopServer(child);                       // 不给落盘机会，直接硬杀
    child = startServer(tmpData, dbPath, logFile + '.3');
    if (await waitPort(PORT)) {
      await sleep(400);
      const dose3 = await api('GET', `/dose-plans?pregnancy_id=${PG}`);
      const survived = (dose3.data || []).some((p) => p.name === '钙片-未落盘');
      if (survived) {
        console.log('  ✅ 未落盘的写入也保住了 —— D1 看来已修好（可以把本段升成断言）');
      } else {
        console.log('  ⚠️ 复现 D1：新建后不等落盘就硬杀 ⇒ 该记录丢失（`data` 里已无「钙片-未落盘」）');
        console.log('     这是**已知发布阻塞项**（上线前检查 §4 D1），由该修复负责；本套件不据此判红。');
      }
    }
  }

  const log2 = fs.readFileSync(logFile + '.2', 'utf8');
  assert('第二次启动不再重复补列（日志显示无需迁移或无迁移记录）',
    !/添加列 .* → daily_record/.test(log2), log2.match(/添加列[^\n]*/g)?.join(' | ') || '');

  // ---- 迁移过程无错误 ----
  const logAll = fs.readFileSync(logFile, 'utf8');
  const failLines = (logAll.match(/\[ERROR\][^\n]*/g) || []).filter((l) => !/没有可用的推送渠道/.test(l));
  assert('首次启动日志里没有迁移相关错误', failLines.length === 0, failLines.slice(0, 3).join(' | '));

  console.log(`\n==== 结果：${pass} 通过 / ${failed} 失败 ====`);
  await stopServer(child);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('套件出错:', e.stack || e.message);
  process.exit(1);
});
