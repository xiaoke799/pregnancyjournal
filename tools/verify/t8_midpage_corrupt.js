// 测试 J：#2 的「saveDb() 把损坏内容写回、覆盖可恢复副本」——
// 用「文件头完好、只有中间某页损坏」的更温和场景再试一次（这种库能打开、能读部分数据）
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SERVER_DIR = require('./_env').SERVER_DIR;
const ROOT = path.join(require('./_env').TMP, 'tmp_j');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

(async () => {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs();
  const good = new SQL.Database();
  good.run('CREATE TABLE pregnancy (id TEXT PRIMARY KEY, due_date TEXT)');
  const st = good.prepare('INSERT INTO pregnancy VALUES (?,?)');
  for (let i = 0; i < 500; i++) { st.run(['p' + i, '2026-10-08']); }
  st.free();
  const bytes = Buffer.from(good.export());
  console.log('原始库大小:', bytes.length, 'B, page_size =', bytes.readUInt16BE(16));

  // 只破坏第 3 页（头 100 字节保持完好 —— 库能打开、能列出部分表）
  const ps = bytes.readUInt16BE(16);
  const bad = Buffer.from(bytes);
  for (let i = 2 * ps; i < 3 * ps; i++) bad[i] = 0x00;

  const scen = path.join(ROOT, 'midpage');
  fs.mkdirSync(scen, { recursive: true });
  const dbPath = path.join(scen, 'pregnancyjournal.db');
  fs.writeFileSync(dbPath, bad);
  const before = fs.readFileSync(dbPath);

  process.env.DATABASE_PATH = dbPath;
  process.env.STORAGE_DIR = scen;
  process.env.DATA_DIR = scen;
  const db = require(path.join(SERVER_DIR, 'db.js'));
  let initErr = null;
  try { await db.initDb(); } catch (e) { initErr = e.message; }

  const after = fs.readFileSync(dbPath);
  console.log('initDb 是否抛错:', initErr || '(未抛错 —— 应用正常启动)');
  console.log(`原文件 ${before.length}B sha=${sha(before)}`);
  console.log(`之后   ${after.length}B sha=${sha(after)}  → 被改写 = ${sha(before) !== sha(after)}`);
  try {
    const n = db.queryOne('SELECT COUNT(*) AS n FROM pregnancy');
    console.log('业务查询 COUNT(pregnancy) =', n && n.n);
  } catch (e) { console.log('业务查询失败:', e.message); }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
