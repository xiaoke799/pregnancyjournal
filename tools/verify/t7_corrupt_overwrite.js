// 测试 I：#2 最关键的一点 —— initDb() 内部的 saveDb()（db.js:478）是否把损坏内容写回、覆盖原文件
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SERVER_DIR = require('./_env').SERVER_DIR;
const ROOT = path.join(require('./_env').TMP, 'tmp_i');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

(async () => {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs();
  const good = new SQL.Database();
  good.run('CREATE TABLE pregnancy (id TEXT PRIMARY KEY, due_date TEXT)');
  good.run("INSERT INTO pregnancy VALUES ('p1','2026-10-08')");
  const bytes = Buffer.from(good.export());
  const partial = bytes.subarray(0, Math.floor(bytes.length / 2));

  for (const [name, buf] of [['partial', partial], ['garbage', Buffer.from('not a database at all, padded........')]]) {
    const scen = path.join(ROOT, name);
    fs.mkdirSync(scen, { recursive: true });
    const dbPath = path.join(scen, 'pregnancyjournal.db');
    fs.writeFileSync(dbPath, buf);
    const before = fs.readFileSync(dbPath);

    process.env.DATABASE_PATH = dbPath;
    process.env.STORAGE_DIR = scen;
    process.env.DATA_DIR = scen;
    for (const k of Object.keys(require.cache)) {
      if (k.includes('pregnancy-journal') && /(db|config|logger|storage-migrate)\.js$/.test(k)) delete require.cache[k];
    }
    const db = require(path.join(SERVER_DIR, 'db.js'));
    try { await db.initDb(); } catch (e) { console.log(name, 'initDb 抛错:', e.message); }

    const after = fs.readFileSync(dbPath);
    console.log(`[${name}] 原文件 ${before.length}B sha=${sha(before)}  →  initDb 后 ${after.length}B sha=${sha(after)}  被改写=${sha(before) !== sha(after)}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
