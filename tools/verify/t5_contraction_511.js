// 测试 G：真实调用 routes/contraction.js 的 /analysis，验证报告 #1 的「误报 5-1-1」
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_g');
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

const p2 = n => String(n).padStart(2, '0');
const hms = d => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

function get(port, p) {
  return new Promise(r => http.get({ host: '127.0.0.1', port, path: p }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(d));
  }));
}

(async () => {
  await db.initDb();
  const app = express();
  app.use(express.json());
  app.use('/api/v1', contractionRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  // 场景：12 次宫缩，每次持续 70 秒，从「18 分钟前」开始，间隔 90 秒 —— 真实跨度仅 ≈18 分钟（远不足 1 小时）
  const NOW = new Date();
  const sessId = 'sess-1';
  const firstStart = new Date(NOW.getTime() - 18 * 60 * 1000);
  db.run(`INSERT INTO contraction_session (id, pregnancy_id, session_date, start_time, total_count)
          VALUES (?, 'pg1', ?, ?, 0)`, [sessId, ymd(NOW), hms(firstStart)]);

  let spanMin = 0;
  for (let i = 0; i < 12; i++) {
    const s = new Date(firstStart.getTime() + i * 90 * 1000);
    const e = new Date(s.getTime() + 70 * 1000);          // duration = 70 秒 ≥ 60
    spanMin = (s - firstStart) / 60000;
    db.run(`INSERT INTO contraction (id, session_id, start_time, end_time, duration, interval_from_prev)
            VALUES (?, ?, ?, ?, 70, ?)`, ['c' + i, sessId, hms(s), hms(e), i === 0 ? null : 20]);
  }
  console.log('构造数据：12 次宫缩，每次 70 秒，全部落在最近 18 分钟内');
  console.log('  首次宫缩 → 末次宫缩 的真实跨度 =', spanMin, '分钟（5-1-1 要求 ≥ 60 分钟）');

  const raw = await get(port, `/api/v1/contractions/sessions/${sessId}/analysis`);
  const j = JSON.parse(raw);
  console.log('');
  console.log('接口返回:', JSON.stringify(j.data, null, 2));
  console.log('');
  console.log('⇒ is_511_met =', j.data.is_511_met, j.data.is_511_met ? '（❌ 误报：跨度只有 18 分钟却判定满足 5-1-1）' : '（未误报）');
  server.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
