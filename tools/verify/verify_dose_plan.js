/**
 * 用药 / 营养补充「医嘱计划」+ 每日打卡 —— 真后端 E2E。
 *
 * 覆盖：建方案 / 非法入参 / 今日待办（孕周·日期·频率约束）/ 打卡幂等 /
 *       撤销 / 停用 / 删方案连带删打卡。
 *
 * ⚠️ 起真 server.js（tcp_shim 转 TCP），不是 mock。
 * ⚠️ 建表语句必须**先剥 `--` 注释**再匹配 CREATE，否则带注释的那几条会被整条跳过
 *    （表现为「建表跳过: no such table: main.dose_plan」，第一版就踩过）。
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const { SERVER_DIR, SERVER_ENTRY, UI_DIR, TMP, NODE } = require('./_env');
const SHIM = path.join(__dirname, 'tcp_shim.js');

const PORT = 38631;
const PREFIX = '/app/pregnancyjournal';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}/api/v1`;
const PG = 'dose-pg-1';

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

/** 用产品自己的 SCHEMA 建空库，并放一条 LMP = 今天-140天（今天正好孕 20 周）的档案 */
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
    try { d.run(stmt); n++; } catch (e) { console.log('  建表失败:', String(e.message).slice(0, 80)); }
  }
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const lmp = new Date(Date.now() - 140 * 86400000).toISOString().slice(0, 10);
  const due = new Date(Date.now() + 140 * 86400000).toISOString().slice(0, 10);
  d.run(
    `INSERT OR REPLACE INTO pregnancy (id, last_period_date, due_date, is_active, baby_name, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
    [PG, lmp, due, '打卡探针', now, now]
  );
  fs.writeFileSync(dbPath, Buffer.from(d.export()));
  console.log(`已建表 ${n} 张；LMP=${lmp}（今天约孕 20 周）`);
  return { tables: n, lmp };
}

async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await r.json();
}

async function todayList() {
  return await api('GET', `/dose-today?pregnancy_id=${PG}`);
}
const namesOf = (res) => ((res.data && res.data.items) || []).map((i) => i.name);

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const tmpData = path.join(TMP, 'dose_api_' + Date.now());
  fs.mkdirSync(tmpData, { recursive: true });
  const dbPath = path.join(tmpData, 'pregnancyjournal.db');

  const info = await seed(dbPath);
  assert('SCHEMA 建表数量合理（≥40）', info.tables >= 40, `实际 ${info.tables}`);

  const server = spawn(NODE, ['-r', SHIM, SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PJ_TCP_PORT: String(PORT),
      APP_MODE: 'dev',
      STORAGE_DIR: tmpData,
      DATA_DIR: tmpData,
      DATABASE_PATH: dbPath,
      STATIC_DIR: UI_DIR,
      ASSETS_DIR: path.join(SERVER_DIR, 'data'),
      TRIM_APPDEST: SERVER_DIR,
      TRIM_PKGVAR: tmpData,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (!(await waitPort(PORT))) {
    console.log('❌ 后端没起来');
    server.kill('SIGKILL');
    process.exit(1);
  }
  console.log('后端就绪\n');

  try {
    // ---- 1. 建方案 ----
    console.log('【1】建四个方案（优甲乐/叶酸/钙片孕20周起/铁剂隔天）');
    const a = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'medication', name: '优甲乐', dosage: '50μg', reminder_times: ['08:00'], note: '早餐前空腹，与钙片间隔2小时' });
    const b = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'supplement', name: '叶酸', dosage: '400μg', reminder_times: ['08:00'] });
    const c = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'supplement', name: '钙片', dosage: '600mg', reminder_times: ['20:00'], start_week: 20 });
    const d = await api('POST', '/dose-plans', { pregnancy_id: PG, kind: 'supplement', name: '铁剂(隔天)', dosage: '1片', reminder_times: ['12:00'], frequency: 'interval2' });
    assert('优甲乐建成功', a.code === 0, JSON.stringify(a));
    assert('叶酸建成功', b.code === 0, JSON.stringify(b));
    assert('钙片建成功（孕20周起）', c.code === 0, JSON.stringify(c));
    assert('铁剂(隔天)建成功', d.code === 0, JSON.stringify(d));
    const planId = a.data && a.data.id;
    const calciumId = c.data && c.data.id;
    assert('拿到了方案 id', !!planId && !!calciumId);

    // ⚠️ 回归点：隔天方案必须**在创建时就钉一个本地起始日**。
    //    若只靠 created_at（SQLite 的 CURRENT_TIMESTAMP 是 UTC）兜底，
    //    UTC+8 在 00:00~08:00 建的方案锚点会落在"昨天" ⇒ 今天被当成不吃的那天。
    const pad = (n) => String(n).padStart(2, '0');
    const nd = new Date();
    const todayStr = `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`;
    const all = await api('GET', `/dose-plans?pregnancy_id=${PG}`);
    const iron = ((all.data && all.data.items) || all.data || []).find((p) => p.name === '铁剂(隔天)');
    assert('隔天方案创建时自动钉了本地起始日', iron && iron.start_date === todayStr,
      `start_date=${iron && iron.start_date} 期望 ${todayStr}`);
    const dailyOne = ((all.data && all.data.items) || all.data || []).find((p) => p.name === '叶酸');
    assert('每天方案不会被强塞起始日（不该污染用户未填的字段）', dailyOne && !dailyOne.start_date,
      `start_date=${dailyOne && dailyOne.start_date}`);

    // ---- 2. 非法入参 ----
    console.log('\n【2】非法入参应被拒（不能 500）');
    assert('空名称被拒', (await api('POST', '/dose-plans', { pregnancy_id: PG, name: '' })).code === 1001);
    assert('非法 kind 被拒', (await api('POST', '/dose-plans', { pregnancy_id: PG, name: 'x', kind: 'xxx' })).code === 1001);
    assert('非法时间被拒', (await api('POST', '/dose-plans', { pregnancy_id: PG, name: 'x', reminder_times: ['25:99'] })).code === 1001);
    assert('非法日期被拒', (await api('POST', '/dose-plans', { pregnancy_id: PG, name: 'x', start_date: '2026/13/45' })).code === 1001);
    assert('起止日期反向被拒', (await api('POST', '/dose-plans', { pregnancy_id: PG, name: 'x', start_date: '2026-09-30', end_date: '2026-09-01' })).code === 1001);
    assert('起止孕周反向被拒', (await api('POST', '/dose-plans', { pregnancy_id: PG, name: 'x', start_week: 30, end_week: 10 })).code === 1001);

    // ---- 3. 今日待办 ----
    console.log('\n【3】今日待办（今天孕20周 ⇒ 钙片应当出现）');
    let today = await todayList();
    assert('今日待办非空', (today.data && today.data.total) > 0, JSON.stringify(today));
    assert('含优甲乐', namesOf(today).includes('优甲乐'), namesOf(today).join('/'));
    assert('含钙片（孕20周已到）', namesOf(today).includes('钙片'), namesOf(today).join('/'));
    assert('初始都未打卡', today.data.taken === 0, `taken=${today.data.taken}`);
    assert('返回了 kind_label', (today.data.items[0] || {}).kind_label === '药品' || (today.data.items[0] || {}).kind_label === '营养补充');
    // ⚠️ 回归点（2026-09-29 修）：隔天方案若用 created_at(UTC) 当锚点，
    //    UTC+8 在 00:00~08:00 建的方案会被算成"昨天建" ⇒ 今天被跳过。
    //    现在创建时会自动补一个本地 start_date，所以建当天必须就该吃。
    assert('隔天方案建当天就在待办里（锚点不能用 UTC 的 created_at）',
      namesOf(today).includes('铁剂(隔天)'), namesOf(today).join('/'));

    // ---- 4. 孕周约束反向验证（反例：不验证"不该出现"就会假绿）----
    console.log('\n【4】把钙片改成孕30周才吃 ⇒ 今天应当消失（反向验证）');
    await api('PUT', `/dose-plans/${calciumId}`, { start_week: 30 });
    assert('钙片已不在今日（孕20 < 30）', !namesOf(await todayList()).includes('钙片'), namesOf(await todayList()).join('/'));
    await api('PUT', `/dose-plans/${calciumId}`, { start_week: 20 });
    assert('改回孕20周后又出现了', namesOf(await todayList()).includes('钙片'));

    // ---- 5. 打卡 + 幂等 ----
    console.log('\n【5】打卡（按种类，一天一条）+ 重复打卡应幂等');
    const ck1 = await api('POST', '/dose-checkins', { pregnancy_id: PG, plan_id: planId });
    assert('首次打卡成功', ck1.code === 0 && !ck1.data.duplicated, JSON.stringify(ck1));
    const ck2 = await api('POST', '/dose-checkins', { pregnancy_id: PG, plan_id: planId });
    assert('重复打卡幂等（不插第二行）', ck2.code === 0 && ck2.data.duplicated === true, JSON.stringify(ck2));
    today = await todayList();
    const item = (today.data.items || []).find((i) => i.id === planId);
    assert('今日列表里优甲乐 taken=true', item && item.taken === true);
    assert('已打卡计数=1', today.data.taken === 1, `taken=${today.data.taken}`);
    assert('不存在的方案打卡被拒', (await api('POST', '/dose-checkins', { pregnancy_id: PG, plan_id: 'nope' })).code === 1001);

    // ---- 6. 撤销 ----
    console.log('\n【6】撤销打卡');
    await api('DELETE', `/dose-checkins?plan_id=${planId}`);
    const item2 = ((await todayList()).data.items || []).find((i) => i.id === planId);
    assert('撤销后 taken=false', item2 && item2.taken === false);

    // ---- 7. 停用 ----
    console.log('\n【7】停用方案应不再出现');
    await api('PUT', `/dose-plans/${planId}`, { is_enabled: 0 });
    assert('停用后优甲乐消失', !namesOf(await todayList()).includes('优甲乐'), namesOf(await todayList()).join('/'));
    await api('PUT', `/dose-plans/${planId}`, { is_enabled: 1 });
    assert('重新启用后又出现', namesOf(await todayList()).includes('优甲乐'));

    // ---- 8. 删方案连带删打卡（不能指望外键级联）----
    console.log('\n【8】删方案应连带删打卡记录');
    await api('POST', '/dose-checkins', { pregnancy_id: PG, plan_id: planId });
    const del = await api('DELETE', `/dose-plans/${planId}`);
    assert('删除成功', del.code === 0, JSON.stringify(del));
    assert('删后不含优甲乐', !((await todayList()).data.items || []).some((i) => i.id === planId));
    assert('删不存在的方案被拒', (await api('DELETE', '/dose-plans/nope')).code === 1001);
  } catch (e) {
    failed++;
    console.log('  🔴 用例执行异常: ' + (e.stack || e.message));
  }

  console.log(`\n==== 结果：${pass} 通过 / ${failed} 失败 ====`);
  server.kill('SIGKILL');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('套件出错:', e.stack || e.message);
  process.exit(1);
});
