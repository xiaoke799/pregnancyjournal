// 测试 D：真实 HTTP 语义下（两次请求 = 两个独立宏任务），handler 内只有「await 同步值」时，
// 两个请求是否可能交错进入同一个事务？（决定报告 #8 / #9 是否在真实环境可达）
const path = require('path');
const initSqlJs = require(path.join(require('./_env').NODE_MODULES, 'sql.js'));

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE habit_checkin (id TEXT, pregnancy_id TEXT, date TEXT)');

  // 与 habit-checkin.js 完全同构：BEGIN IMMEDIATE → await 同步查询 → 写 → COMMIT
  function queryOne(sql) { const st = db.prepare(sql); if (st.step()) { const r = st.getAsObject(); st.free(); return r; } st.free(); return null; }

  const log = [];
  async function handleRequest(tag) {
    try {
      db.run('BEGIN IMMEDIATE TRANSACTION');
      log.push(tag + ':BEGIN');
      const existing = await queryOne("SELECT 1 AS x");   // await 同步值
      log.push(tag + ':after-await');
      db.run(`INSERT INTO habit_checkin VALUES ('${tag}','p1','2026-09-28')`);
      db.run('COMMIT');
      log.push(tag + ':COMMIT-OK');
      return 'ok';
    } catch (e) {
      log.push(tag + ':FAIL:' + e.message);
      try { db.run('ROLLBACK'); } catch {}
      return 'fail';
    }
  }

  // 模拟 Express：两个请求是两次独立的 I/O 事件（不同宏任务），触发顺序 A 先 B 后
  let aResult, bResult;
  await new Promise((resolve) => {
    setImmediate(() => { handleRequest('A').then(r => aResult = r); });
    setImmediate(() => { handleRequest('B').then(r => { bResult = r; resolve(); }); });
  });

  console.log('两个独立宏任务（模拟两次请求）→ 执行顺序:');
  console.log('  ' + log.join('\n  '));
  console.log('A 结果:', aResult, '| B 结果:', bResult);

  console.log('');
  console.log('=== 同样的两个请求，但 handler 里有「真实异步」(setTimeout/IO) ===');
  const db2 = new SQL.Database();
  db2.run('CREATE TABLE t (v TEXT)');
  function queryOne2() { return { x: 1 }; }
  const log2 = [];
  async function handle2(tag, realAsync) {
    try {
      db2.run('BEGIN IMMEDIATE TRANSACTION');
      log2.push(tag + ':BEGIN');
      if (realAsync) await new Promise(r => setTimeout(r, 5));
      else await queryOne2();
      log2.push(tag + ':after-await');
      db2.run(`INSERT INTO t VALUES ('${tag}')`);
      db2.run('COMMIT');
      log2.push(tag + ':COMMIT-OK');
    } catch (e) { log2.push(tag + ':FAIL:' + e.message); try { db2.run('ROLLBACK'); } catch {} }
  }
  await new Promise((resolve) => {
    setImmediate(() => { handle2('A', true); });
    setImmediate(() => { handle2('B', true).then(resolve); });
  });
  console.log('  ' + log2.join('\n  '));
})();
