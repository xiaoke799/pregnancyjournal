// 测试 E：用**真实的** routes/habit-checkin.js + 真实 db.js，跑真实并发 HTTP 请求
// 目的1：确认报告 #8「并发请求导致 BEGIN 冲突」在真实环境下是否可达
// 目的2：顺带实测报告 #3 在真实应用里的后果（首次落盘后外键约束是否消失）
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_e');
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
const habitRouter = require(path.join(SERVER_DIR, 'routes', 'habit-checkin.js'));

function post(port, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/v1/habit-checkins',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.write(payload); req.end();
  });
}

(async () => {
  await db.initDb();

  // 建一条 pregnancy，避免外键把测试本身挡掉
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date) VALUES ('pg1','2026-01-01','2026-10-08')");

  const app = express();
  app.use(express.json());
  app.use('/api/v1', habitRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  console.log('=== E1：真实并发 20 个 POST /habit-checkins（同 pregnancy+date，不同 items）===');
  const reqs = [];
  for (let i = 0; i < 20; i++) reqs.push(post(port, { pregnancy_id: 'pg1', date: '2026-09-28', items: { n: i } }));
  const res = await Promise.all(reqs);
  const fails = res.filter(r => !r.body.includes('"code":0'));
  console.log('成功:', res.length - fails.length, '/ 20');
  console.log('失败样例:', fails.length ? fails[0].body.slice(0, 200) : '(无)');
  const beginConflicts = res.filter(r => /transaction within a transaction/i.test(r.body));
  console.log('其中「cannot start a transaction within a transaction」:', beginConflicts.length);

  console.log('');
  console.log('=== E2：实测 #3 —— saveDb() 之后外键约束是否失效 ===');
  const fk = () => { const r = db.getDb().exec('PRAGMA foreign_keys'); return r[0].values[0][0]; };
  console.log('落盘前 PRAGMA foreign_keys :', fk());
  let before;
  try { db.run("INSERT INTO habit_checkin (id, pregnancy_id, date) VALUES ('x1','NOT-EXIST','2026-09-28')"); before = 'ACCEPTED'; }
  catch (e) { before = 'REJECTED: ' + e.message; }
  console.log('落盘前 孤儿 pregnancy_id 插入:', before);

  db.saveDb();   // 真实业务落盘（备份/导出/退出前都会调它）
  console.log('调用 saveDb() 后 PRAGMA   :', fk());
  let after;
  try { db.run("INSERT INTO habit_checkin (id, pregnancy_id, date) VALUES ('x2','NOT-EXIST','2026-09-28')"); after = 'ACCEPTED ← 外键已失效'; }
  catch (e) { after = 'REJECTED: ' + e.message; }
  console.log('落盘后 孤儿 pregnancy_id 插入:', after);

  console.log('');
  console.log('=== E3：真删 pregnancy，看子表是否被级联清掉 ===');
  db.run("DELETE FROM pregnancy WHERE id = 'pg1'");
  const left = db.queryOne('SELECT COUNT(*) AS n FROM habit_checkin');
  console.log('删除 pregnancy 后 habit_checkin 剩余行数:', left.n, '（期望 0 = 级联生效）');

  server.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
