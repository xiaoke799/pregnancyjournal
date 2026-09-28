// 测试 F：拆解 E1 的 20 个并发请求到底发生了什么（created / updated 分布、最终行数）
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_f');
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

function post(port, body, tag) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST',
      path: (tag % 2 === 0 ? '/api/v1/habit-checkins' : '/api/v1/habit-checkins'),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ tag, body: d }));
    });
    req.on('error', e => resolve({ tag, body: 'ERR ' + e.message }));
    req.write(payload); req.end();
  });
}

(async () => {
  await db.initDb();
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date) VALUES ('pg1','2026-01-01','2026-10-08')");

  const app = express();
  app.use(express.json());
  app.use('/api/v1', habitRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  for (const N of [2, 5, 20]) {
    db.run('DELETE FROM habit_checkin');
    const reqs = [];
    for (let i = 0; i < N; i++) reqs.push(post(port, { pregnancy_id: 'pg1', date: '2026-09-28', items: { n: i } }, i));
    const res = await Promise.all(reqs);
    let created = 0, updated = 0, other = [];
    for (const r of res) {
      let j = null; try { j = JSON.parse(r.body); } catch {}
      if (j && j.code === 0) { if (j.data.created) created++; else if (j.data.updated) updated++; }
      else other.push(r.body.slice(0, 160));
    }
    const cnt = db.queryOne('SELECT COUNT(*) AS n FROM habit_checkin').n;
    console.log(`N=${String(N).padStart(2)} → created=${created} updated=${updated} 最终表内行数=${cnt} 报错数=${other.length}`);
    if (other.length) console.log('   报错样例:', other[0]);
  }

  console.log('');
  console.log('最终表内容:', JSON.stringify(db.queryAll('SELECT id, date, items FROM habit_checkin')));
  server.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
