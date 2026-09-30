/**
 * 首页时间轴「血压 / 血糖偏高」告警的**边界值** —— 与记录列表口径打架
 *
 * 【症状】同一个数值，两处判定不一致：
 *   · 记录列表 `RecordList.vue`：  `(s >= 140) || (d >= 90)` → 标「偏高」；
 *                                 空腹 `v < 5.1` 才算「正常」⇒ **≥5.1 即偏高**
 *   · 首页时间轴 `routes/dashboard.js`： `> 140` / `> 90` / `> 5.1` / `> 6.7`
 *   ⇒ 血压正好 140/90、空腹正好 5.1 时：**记录列表标红「偏高」，首页时间轴一声不响**。
 *
 * 【为什么 `>=` 才对】临床阈值一律是「≥」：
 *   · 妊娠期高血压 = 收缩压 **≥140** 和/或 舒张压 **≥90** mmHg；
 *   · 孕期空腹血糖 **≥5.1** mmol/L（75g OGTT，IADPSG/中国 2022 指南）；
 *   · 餐后 2h 控制目标上限 **6.7** mmol/L —— 达到上限即应提示。
 *   用 `>` 会让恰好压线的值整体漏报（而血糖仪/血压计读数常常正好是整数或一位小数）。
 *
 * 【本脚本覆盖】
 *   A. 压线值必须告警（140/90、空腹 5.1、餐后2h 6.7）
 *   B. 刚好低一档的值**不**告警（139/89、5.0、6.6）—— 反例，防止把阈值改成「一律告警」也能蒙混过关
 *   C. 明显高于阈值仍要告警（保证改 `>=` 没把正常逻辑改坏）
 *
 * 用法：node probe_alert_threshold.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env0 = require('./_env');
const ROOT = env0.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(env0.VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-alert-threshold');
const PORT = Number(process.env.PJ_TCP_PORT || 38579);
const GW = '/app/pregnancyjournal';

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev', FNOS_SOCKET_PATH: path.join(T, 'a.sock'), PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
  ASSETS_DIR: path.join(NODE_DIR, 'data'),
};

function req(m, p, b = null) {
  return new Promise((resolve, reject) => {
    const pay = b ? JSON.stringify(b) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, headers: pay ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pay) } : {} }, (res) => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (pay) r.write(pay);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ← ' + extra : '')); }
}

const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

(async () => {
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', GW + '/api/health'); if (r.status === 200) { ready = true; break; } } catch (e) {}
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

  const API = GW + '/api/v1';
  const today = dstr(0);

  const newPreg = async () => {
    const r = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
    return r.json && r.json.data && r.json.data.id;
  };
  /** 写一条当日记录，返回该孕期的时间轴告警标题数组 */
  const alertsFor = async (rec) => {
    const pid = await newPreg();
    const r = await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: today, ...rec });
    if (!r.json || r.json.code !== 0) return { pid, titles: [], writeErr: JSON.stringify(r.json) };
    const ev = await req('GET', `${API}/dashboard/events?pregnancy_id=${pid}`);
    const list = (ev.json && ev.json.data) || [];
    return {
      pid,
      titles: list.filter((e) => e.event_type === 'record_alert').map((e) => String(e.title || '')),
    };
  };
  const has = (titles, kw) => titles.some((t) => t.indexOf(kw) !== -1);

  console.log('===== 场景 A：压线值必须告警（临床口径是「≥」）=====');
  {
    const a = await alertsFor({ blood_pressure_systolic: 140, blood_pressure_diastolic: 90 });
    check('A1 血压 140/90 ⇒ 报「血压偏高」', has(a.titles, '血压偏高'), a.writeErr || JSON.stringify(a.titles));

    const b = await alertsFor({ blood_glucose_fasting: 5.1 });
    check('A2 空腹血糖 5.1 ⇒ 报「空腹血糖偏高」', has(b.titles, '空腹血糖偏高'), b.writeErr || JSON.stringify(b.titles));

    const c = await alertsFor({ blood_glucose_2h: 6.7 });
    check('A3 餐后2h 6.7 ⇒ 报「餐后血糖偏高」', has(c.titles, '餐后血糖偏高'), c.writeErr || JSON.stringify(c.titles));

    // 只压一条边（收缩压压线、舒张压正常）也要报
    const d = await alertsFor({ blood_pressure_systolic: 140, blood_pressure_diastolic: 70 });
    check('A4 收缩压单侧压线 140 ⇒ 仍报「血压偏高」', has(d.titles, '血压偏高'), JSON.stringify(d.titles));
    const e = await alertsFor({ blood_pressure_systolic: 110, blood_pressure_diastolic: 90 });
    check('A5 舒张压单侧压线 90 ⇒ 仍报「血压偏高」', has(e.titles, '血压偏高'), JSON.stringify(e.titles));
  }

  console.log('\n===== 场景 B：刚好低一档不该告警（反例，防「一律告警」蒙混过关）=====');
  {
    const a = await alertsFor({ blood_pressure_systolic: 139, blood_pressure_diastolic: 89 });
    check('B1 血压 139/89 ⇒ 不报', !has(a.titles, '血压偏高'), JSON.stringify(a.titles));

    const b = await alertsFor({ blood_glucose_fasting: 5.0 });
    check('B2 空腹血糖 5.0 ⇒ 不报', !has(b.titles, '空腹血糖偏高'), JSON.stringify(b.titles));

    const c = await alertsFor({ blood_glucose_2h: 6.6 });
    check('B3 餐后2h 6.6 ⇒ 不报', !has(c.titles, '餐后血糖偏高'), JSON.stringify(c.titles));

    const d = await alertsFor({ weight: 60 });
    check('B4 只有正常指标 ⇒ 一条告警都没有', d.titles.length === 0, JSON.stringify(d.titles));
  }

  console.log('\n===== 场景 C：明显高于阈值仍要告警（别把正常逻辑改坏）=====');
  {
    const a = await alertsFor({ blood_pressure_systolic: 155, blood_pressure_diastolic: 100, blood_glucose_fasting: 6.2, blood_glucose_2h: 8.0 });
    check('C1 明显偏高 ⇒ 三类告警齐全', has(a.titles, '血压偏高') && has(a.titles, '空腹血糖偏高') && has(a.titles, '餐后血糖偏高'), JSON.stringify(a.titles));
  }

  console.log(`\n==================================================`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log(`==================================================`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
