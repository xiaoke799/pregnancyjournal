// 测试 H：真实复现报告 #2「DB 损坏 → 应用照常启动、日志报就绪、但每个请求都失败，且 saveDb() 把坏内容写回」
const path = require('path');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const ROOT = path.join(require('./_env').TMP, 'tmp_h');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));

async function makeScenarios() {
  const SQL = await initSqlJs();
  const good = new SQL.Database();
  good.run('CREATE TABLE t (id TEXT, v TEXT)');
  good.run("INSERT INTO t VALUES ('a','hello')");
  const bytes = Buffer.from(good.export());
  const out = {};
  out.garbage = Buffer.from('this is definitely not a sqlite database file, just text padded to be long enough..........');
  out.zero = Buffer.alloc(0);
  out.partial = bytes.subarray(0, Math.floor(bytes.length / 2));   // 截断一半
  return out;
}

async function tryInit(buf, name) {
  const dbPath = path.join(ROOT, name + '.db');
  fs.writeFileSync(dbPath, buf);
  // 每个场景用独立进程环境：清掉 require 缓存
  for (const k of Object.keys(require.cache)) {
    if (k.includes('pregnancy-journal') && (k.endsWith('db.js') || k.endsWith('config.js') || k.endsWith('logger.js') || k.endsWith('storage-migrate.js'))) delete require.cache[k];
  }
  process.env.DATABASE_PATH = dbPath;
  process.env.STORAGE_DIR = path.join(ROOT, name + '_storage');
  process.env.DATA_DIR = process.env.STORAGE_DIR;
  fs.mkdirSync(process.env.STORAGE_DIR, { recursive: true });

  const db = require(path.join(SERVER_DIR, 'db.js'));
  let initErr = null;
  try { await db.initDb(); } catch (e) { initErr = e.message; }

  const res = { name, initThrew: initErr };
  if (!initErr) {
    try {
      const r = db.queryOne("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'");
      res.tableCount = r ? r.n : '(null)';
    } catch (e) { res.queryErr = e.message; }
    try {
      db.queryOne('SELECT COUNT(*) AS n FROM daily_record');
      res.bizQuery = 'OK';
    } catch (e) { res.bizQuery = 'FAIL: ' + e.message; }
    res.saveDbCalled = 'initDb 内部已调用 saveDb()（见 db.js:478）';
  }
  return res;
}

(async () => {
  const sc = await makeScenarios();
  for (const name of ['garbage', 'zero', 'partial']) {
    const r = await tryInit(sc[name], name);
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
