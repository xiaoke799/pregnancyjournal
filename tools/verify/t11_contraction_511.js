// 测试 #1：宫缩 5-1-1 判定修正（routes/contraction.js）端到端验证
// 用真实 db.js + 真实 routes/contraction.js + 真实 HTTP 请求。
//
// 反例验证原则（铁律 #11）：每个用例都给出「应当成立」与「应当不成立」两侧，
// 若跑出全绿但其实是逻辑恒返回同一值，用「对照组」就能暴露。
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_k');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

process.env.STORAGE_DIR = TMP;
process.env.DATA_DIR = TMP;
process.env.PHOTOS_DIR = path.join(TMP, 'photos');
process.env.MEDIA_DIR = path.join(TMP, 'media');
process.env.DATABASE_PATH = path.join(TMP, 'pj.db');
process.env.APP_MODE = 'dev';

const express = require('express');
const db = require(path.join(SERVER_DIR, 'db.js'));
const contractionRouter = require(path.join(SERVER_DIR, 'routes', 'contraction.js'));

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

function get(port, p) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, raw: d, json: j }); });
    });
    req.on('error', e => resolve({ status: 0, raw: 'ERR ' + e.message, json: null }));
    req.end();
  });
}

const hhmmss = (baseSeconds) => {
  const h = Math.floor(baseSeconds / 3600) % 24;
  const m = Math.floor((baseSeconds % 3600) / 60);
  const s = baseSeconds % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
};

// 造一个会话：contractions 为 [{offsetSec, durationSec}] 相对会话 10:00:00 的偏移
function seedSession(id, sessionDate, list, startTime = '10:00:00') {
  const base = 10 * 3600; // 10:00:00
  db.run(
    `INSERT INTO contraction_session (id, pregnancy_id, session_date, start_time, end_time, total_count, avg_duration, avg_interval, created_at)
     VALUES (?, 'pg1', ?, ?, NULL, 0, NULL, NULL, datetime('now'))`,
    [id, sessionDate, startTime]
  );
  for (let i = 0; i < list.length; i++) {
    const st = base + list[i].offsetSec;
    const et = st + list[i].durationSec;
    db.run(
      `INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [`${id}-c${i}`, id, hhmmss(st), hhmmss(et), list[i].durationSec, null]
    );
  }
}

function lin(n, stepSec, durSec) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ offsetSec: i * stepSec, durationSec: durSec });
  return a;
}

(async () => {
  await db.initDb();
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date) VALUES ('pg1','2026-01-01','2026-10-08')");

  const config = require(path.join(SERVER_DIR, 'config.js'));
  const today = config.localToday();

  // ---- 会话 A：#1 报告里那个误报场景：12 次 × 70s，但只跨 16.5 分钟 ----
  // 10:00 起，每次间隔 90s，第 12 次在 10:16:30
  seedSession('sA', today, lin(12, 90, 70));
  // ---- 会话 B：真正的 5-1-1：12 次 × 70s，每次间隔 5 分钟，跨度正好 55 分钟 ----
  seedSession('sB', today, lin(12, 300, 70));
  // ---- 会话 C：密度够、跨度够，但每次只持续 40s（第二个「1」不满足）----
  seedSession('sC', today, lin(12, 300, 40));
  // ---- 会话 D：只有 11 次、跨度 55 分钟（次数不够）----
  seedSession('sD', today, lin(11, 300, 70));
  // ---- 会话 E：历史会话（5 天前），12 次 × 70s / 间隔 5 分钟 ----
  const d5 = new Date(Date.now() - 5 * 86400000);
  const d5s = `${d5.getFullYear()}-${String(d5.getMonth() + 1).padStart(2, '0')}-${String(d5.getDate()).padStart(2, '0')}`;
  seedSession('sE', d5s, lin(12, 300, 70));

  const app = express();
  app.use(express.json());
  app.use('/api/v1', contractionRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  const analyze = async (id) => {
    const r = await get(port, `/api/v1/contractions/sessions/${id}/analysis`);
    return r.json && r.json.data;
  };

  console.log('=== K1：12 次 × 70s，仅跨 16.5 分钟（报告 #1 的误报场景）===');
  const a = await analyze('sA');
  console.log('   last_hour_count=', a.last_hour_count, ' window_span_minutes=', a.window_span_minutes, ' is_511_met=', a.is_511_met);
  ok(a.last_hour_count === 12, '窗口内识别到 12 次宫缩（时间轴锚点生效）', a.last_hour_count);
  ok(a.window_span_minutes === 16 || a.window_span_minutes === 17, '实测跨度 ≈ 16.5 分钟', a.window_span_minutes);
  ok(a.is_511_met === false, '【关键】不再误判为满足 5-1-1', a.is_511_met);
  ok(/没满1小时|还没满1小时|继续记录/.test(a.recommendation), '给出「密度够但未满 1 小时」的中性提示', a.recommendation);
  ok(!/立即前往医院待产/.test(a.recommendation), '【关键】不含「立即前往医院待产」', a.recommendation);

  console.log('=== K2：真 5-1-1 —— 12 次 × 70s，间隔 5 分钟，跨度 55 分钟 ===');
  const b = await analyze('sB');
  console.log('   last_hour_count=', b.last_hour_count, ' window_span_minutes=', b.window_span_minutes, ' is_511_met=', b.is_511_met);
  ok(b.window_span_minutes >= 55, '实测跨度 ≥ 55 分钟', b.window_span_minutes);
  ok(b.is_511_met === true, '【关键】判定满足 5-1-1（正例，防止恒 false）', b.is_511_met);
  ok(/立即前往医院待产/.test(b.recommendation), '给出「立即前往医院待产」', b.recommendation);

  console.log('=== K3：次数/跨度够，但每次仅 40s（< 1 分钟）===');
  const c = await analyze('sC');
  console.log('   last_hour_count=', c.last_hour_count, ' span=', c.window_span_minutes, ' is_511_met=', c.is_511_met);
  ok(c.is_511_met === false, '【关键】持续时间不足 1 分钟 → 不满足', c.is_511_met);

  console.log('=== K4：仅 11 次宫缩（次数不足 12）===');
  const d = await analyze('sD');
  console.log('   last_hour_count=', d.last_hour_count, ' span=', d.window_span_minutes, ' is_511_met=', d.is_511_met);
  ok(d.last_hour_count === 11, '识别到 11 次', d.last_hour_count);
  ok(d.is_511_met === false, '【关键】次数不足 → 不满足', d.is_511_met);

  console.log('=== K5：历史会话（5 天前）——原 Date.now() 锚点会让它恒为 0 ===');
  const e = await analyze('sE');
  console.log('   last_hour_count=', e.last_hour_count, ' span=', e.window_span_minutes, ' is_511_met=', e.is_511_met);
  ok(e.last_hour_count === 12, '【关键】历史会话仍能正确分析（不再是“暂无足够数据”）', e.last_hour_count);
  ok(e.is_511_met === true, '历史会话判定仍正确', e.is_511_met);
  ok(/小时前的记录/.test(e.recommendation), '追加了「这是历史记录」的提示', e.recommendation);

  console.log('=== K6：跨午夜会话（22:58 起，跨到次日）===');
  // 12 次 × 70s，间隔 5 分钟，从 22:58:00 起 → 最后一次在 23:53:00，未跨日
  // 换成从 23:00 起、间隔 5 分钟 * 12 次 → 最后 23:55，仍未跨日。
  // 跨日用例：start_time 22:50，实际行内 start_time 直接给次日凌晨 00:05 之类会触发“早于会话开始 → +24h”。
  db.run(
    `INSERT INTO contraction_session (id, pregnancy_id, session_date, start_time, end_time, total_count, avg_duration, avg_interval, created_at)
     VALUES ('sF','pg1', ?, '23:50:00', NULL, 0, NULL, NULL, datetime('now'))`, [today]
  );
  // 11 次在 23:5x，第 12 次落在 00:0x（HH:MM:SS 数值上“早于”会话开始 → 应被识别为次日）
  const baseF = 23 * 3600 + 50 * 60;
  for (let i = 0; i < 13; i++) {
    const st = (baseF + i * 300) % 86400;
    db.run(
      `INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev, created_at)
       VALUES (?, 'sF', ?, ?, 70, NULL, datetime('now'))`,
      [`sF-c${i}`, hhmmss(st), hhmmss((st + 70) % 86400)]
    );
  }
  const f = await analyze('sF');
  console.log('   last_hour_count=', f.last_hour_count, ' span=', f.window_span_minutes, ' is_511_met=', f.is_511_met);
  ok(f.last_hour_count >= 12, '跨午夜仍能聚在同一小时窗口', f.last_hour_count);
  ok(f.window_span_minutes >= 55 && f.window_span_minutes <= 61, '跨午夜跨度计算正确（≈60 分钟，非负数/非 1400 分钟）', f.window_span_minutes);
  ok(f.is_511_met === true, '跨午夜会话判定满足 5-1-1', f.is_511_met);

  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  server.close();
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
