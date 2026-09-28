// 选一个「能真正发现页损坏」的启动探活方式：比较 sqlite_master / quick_check / integrity_check / 实际读表
const path = require('path');
const fs = require('fs');
const SERVER_DIR = require('./_env').SERVER_DIR;

(async () => {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs();

  function makeCorrupt(kind) {
    const g = new SQL.Database();
    g.run('CREATE TABLE pregnancy (id TEXT PRIMARY KEY, due_date TEXT)');
    g.run('CREATE TABLE daily_record (id TEXT PRIMARY KEY, pregnancy_id TEXT, record_date TEXT, weight REAL)');
    const st = g.prepare('INSERT INTO pregnancy VALUES (?,?)');
    for (let i = 0; i < 400; i++) st.run(['p' + i, '2026-10-08']);
    st.free();
    const st2 = g.prepare('INSERT INTO daily_record VALUES (?,?,?,?)');
    for (let i = 0; i < 800; i++) st2.run(['d' + i, 'p0', '2026-0' + ((i % 9) + 1) + '-01', 60 + (i % 10)]);
    st2.free();
    const buf = Buffer.from(g.export());
    const ps = buf.readUInt16BE(16);
    if (kind === 'page2') { for (let i = 2 * ps; i < 3 * ps; i++) buf[i] = 0; }
    if (kind === 'lastpage') { const n = buf.length; for (let i = n - ps; i < n; i++) buf[i] = 0; }
    if (kind === 'garbage') return Buffer.from('SQLite format 3\0' + 'A'.repeat(300));
    return buf;
  }

  function probe(name, buf) {
    const t0 = Date.now();
    let out = { name, size: buf.length, master: '?', quick: '?', integ: '?', read: '?' };
    try {
      const d = new SQL.Database(buf);
      try { d.exec('SELECT count(*) FROM sqlite_master'); out.master = 'ok'; } catch (e) { out.master = 'THROW: ' + e.message; }
      try {
        const r = d.exec('PRAGMA quick_check');
        const vals = r && r[0] ? r[0].values.map(v => v[0]) : [];
        out.quick = (vals.length === 1 && vals[0] === 'ok') ? 'ok' : 'BAD: ' + JSON.stringify(vals.slice(0, 2));
      } catch (e) { out.quick = 'THROW: ' + e.message; }
      try {
        const r = d.exec('PRAGMA integrity_check');
        const vals = r && r[0] ? r[0].values.map(v => v[0]) : [];
        out.integ = (vals.length === 1 && vals[0] === 'ok') ? 'ok' : 'BAD: ' + JSON.stringify(vals.slice(0, 2));
      } catch (e) { out.integ = 'THROW: ' + e.message; }
      try { d.exec('SELECT count(*) FROM daily_record'); out.read = 'ok'; } catch (e) { out.read = 'THROW: ' + e.message; }
      try { d.close(); } catch (e) {}
    } catch (e) { out.master = 'CTOR THROW: ' + e.message; }
    out.ms = Date.now() - t0;
    return out;
  }

  for (const kind of ['healthy', 'page2', 'lastpage', 'garbage']) {
    const r = probe(kind, makeCorrupt(kind));
    console.log(`\n[${r.name}] ${r.size}B  用时 ${r.ms}ms`);
    console.log(`  sqlite_master  : ${r.master}`);
    console.log(`  quick_check    : ${r.quick}`);
    console.log(`  integrity_check: ${r.integ}`);
    console.log(`  读 daily_record: ${r.read}`);
  }
})();
