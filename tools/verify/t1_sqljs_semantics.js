// 验证报告 #3 / #4 关于 db.export() 的两个副作用，以及 #8/#9 的事件循环假设
const path = require('path');
const initSqlJs = require(path.join(require('./_env').NODE_MODULES, 'sql.js'));

const FAKE_SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS parent (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS child (id TEXT PRIMARY KEY, pid TEXT NOT NULL, FOREIGN KEY (pid) REFERENCES parent(id) ON DELETE CASCADE);
`;

function prf(db) {
  const r = db.exec('PRAGMA foreign_keys');
  return r && r[0] && r[0].values && r[0].values[0] ? r[0].values[0][0] : '(none)';
}
function rows(db, sql) {
  try {
    const r = db.exec(sql);
    return r && r[0] ? JSON.stringify(r[0].values) : '[]';
  } catch (e) { return 'ERR:' + e.message; }
}

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // 逐条执行（模拟 applySchemaAndMigrate）
  for (const s of FAKE_SCHEMA.split(';').map(x => x.trim()).filter(Boolean)) db.run(s);

  console.log('=== 测试 A：db.export() 是否重置 PRAGMA foreign_keys ===');
  console.log('启动后 PRAGMA foreign_keys      :', prf(db));
  db.run("INSERT INTO parent VALUES ('p1')");
  console.log('export 前 孤儿插入 p999          :', rows(db, "INSERT INTO child VALUES ('c0','p999')") , '(空 = 成功插入)');
  db.run("DELETE FROM child WHERE id='c0'");

  const data = db.export();                 // ← saveDb()/saveDbAsync() 都调用它
  console.log('export 后 PRAGMA foreign_keys   :', prf(db));
  console.log('export 后 孤儿插入 p999          :', (() => { try { db.run("INSERT INTO child VALUES ('c1','p999')"); return 'ACCEPTED(外键失效)'; } catch (e) { return 'REJECTED: ' + e.message; } })());
  console.log('export 后 级联删除是否生效       :', (() => { db.run("INSERT INTO child VALUES ('c2','p1')"); db.run("DELETE FROM parent WHERE id='p1'"); return rows(db, 'SELECT * FROM child'); })());
  console.log('export() 返回字节数             :', data.length);

  console.log('');
  console.log('=== 测试 B：事务未提交时调用 db.export() ===');
  const db2 = new SQL.Database();
  db2.run('CREATE TABLE t (v TEXT)');
  db2.run("INSERT INTO t VALUES ('old')");
  db2.run('BEGIN TRANSACTION');
  db2.run("INSERT INTO t VALUES ('mid-tx')");
  console.log('事务内可见行数                  :', rows(db2, 'SELECT v FROM t'));
  db2.export();
  let commitMsg;
  try { db2.run('COMMIT'); commitMsg = 'COMMIT 成功'; }
  catch (e) { commitMsg = 'COMMIT 失败: ' + e.message; }
  console.log(commitMsg);
  console.log('最终表内数据                    :', rows(db2, 'SELECT v FROM t'));

  console.log('');
  console.log('=== 测试 C：await 一个同步值，是否会让出到宏任务（定时器） ===');
  const db3 = new SQL.Database();
  db3.run('CREATE TABLE t (v TEXT)');

  const order = [];
  function q1() { const st = db3.prepare('SELECT 1'); if (st.step()) { st.getAsObject(); } st.free(); return { ok: 1 }; }

  async function handlerA() {
    db3.run('BEGIN IMMEDIATE TRANSACTION');
    order.push('A:BEGIN');
    const existing = await q1();          // ← 与 habit-checkin.js:14 完全同构
    order.push('A:after-await');
    db3.run("INSERT INTO t VALUES ('A')");
    db3.run('COMMIT');
    order.push('A:COMMIT');
  }
  async function handlerB() {
    order.push('B:enter');
    try {
      db3.run('BEGIN IMMEDIATE TRANSACTION');
      order.push('B:BEGIN-ok');
      db3.run("INSERT INTO t VALUES ('B')");
      db3.run('COMMIT');
    } catch (e) { order.push('B:BEGIN-FAIL: ' + e.message); }
  }

  // C-1：同一个 tick 里先后进入两个 handler（= 报告作者的复现姿势）
  const pA = handlerA();
  const pB = handlerB();
  await Promise.allSettled([pA, pB]);
  console.log('同一 tick 并发进入 →执行顺序   :', order.join(' → '));
  console.log('同一 tick 并发进入 →结果       :', rows(db3, 'SELECT v FROM t'));

  // C-2：定时器能否插入到 await 之间
  const order2 = [];
  const db4 = new SQL.Database();
  db4.run('CREATE TABLE t (v TEXT)');
  function q2() { return { ok: 1 }; }
  async function handlerD() {
    db4.run('BEGIN IMMEDIATE TRANSACTION');
    order2.push('D:BEGIN');
    await new Promise(r => setTimeout(r, 0));   // 真实异步：让出到宏任务
    order2.push('D:after-real-async');
    db4.run('COMMIT');
  }
  async function handlerE() {
    order2.push('E:enter');
    try { db4.run('BEGIN IMMEDIATE TRANSACTION'); order2.push('E:BEGIN-ok'); }
    catch (e) { order2.push('E:BEGIN-FAIL'); }
  }
  const pD = handlerD();
  const timerFired = new Promise(r => setTimeout(() => { order2.push('TIMER(模拟30s落盘)'); db4.export(); order2.push('TIMER:export done'); r(); }, 0));
  const pE = handlerE();
  await Promise.allSettled([pD, pE, timerFired]);
  console.log('含真实 await 时 →执行顺序      :', order2.join(' → '));
})();
