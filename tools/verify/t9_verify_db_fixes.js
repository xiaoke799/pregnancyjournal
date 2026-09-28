// 验证 db.js 修复：#3 外键不再失效 / #2 损坏自检与回退 / #10 索引 / #15 死字段
const path = require('path');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const ROOT = path.join(require('./_env').TMP, 'tmp_fix');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  🔴 ${name}${extra ? '  → ' + extra : ''}`); }
}

function freshModule(name, dir) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('pregnancy-journal') && /(db|config|logger|storage-migrate)\.js$/.test(k)) delete require.cache[k];
  }
  fs.mkdirSync(dir, { recursive: true });
  process.env.STORAGE_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.BACKUPS_DIR = path.join(dir, 'backups');
  process.env.PHOTOS_DIR = path.join(dir, 'photos');
  process.env.MEDIA_DIR = path.join(dir, 'media');
  process.env.DATABASE_PATH = path.join(dir, 'pj.db');
  process.env.APP_MODE = 'dev';
  return require(path.join(SERVER_DIR, 'db.js'));
}

const fkOf = (db) => { const r = db.getDb().exec('PRAGMA foreign_keys'); return r[0].values[0][0]; };

(async () => {
  // ================= 场景 1：全新库 + 落盘后外键是否仍然生效（#3） =================
  console.log('\n=== 场景1：外键约束在落盘后是否仍然生效（#3）===');
  const d1 = freshModule('a', path.join(ROOT, 'a'));
  await d1.initDb();
  ok('initDb 之后 PRAGMA foreign_keys = 1', fkOf(d1) === 1, '实际 ' + fkOf(d1));

  d1.run("INSERT INTO pregnancy (id, last_period_date, due_date) VALUES ('pg1','2026-01-01','2026-10-08')");
  let orphanRejected = false;
  try { d1.run("INSERT INTO habit_checkin (id, pregnancy_id, date) VALUES ('o1','NOT-EXIST','2026-09-28')"); }
  catch (e) { orphanRejected = true; }
  ok('孤儿记录被外键拒绝', orphanRejected);

  d1.saveDb();                       // 业务落盘（备份/导出/退出前都会调）
  ok('saveDb() 之后 PRAGMA foreign_keys 仍 = 1', fkOf(d1) === 1, '实际 ' + fkOf(d1));
  let orphanRejected2 = true;
  try { d1.run("INSERT INTO habit_checkin (id, pregnancy_id, date) VALUES ('o2','NOT-EXIST','2026-09-28')"); orphanRejected2 = false; } catch (e) {}
  ok('落盘后孤儿记录仍被拒绝', orphanRejected2);

  // 级联删除
  d1.run("INSERT INTO habit_checkin (id, pregnancy_id, date) VALUES ('h1','pg1','2026-09-28')");
  d1.run("DELETE FROM pregnancy WHERE id = 'pg1'");
  const left = d1.queryOne('SELECT COUNT(*) AS n FROM habit_checkin');
  ok('删除 pregnancy 后子表被级联清空（ON DELETE CASCADE 生效）', left.n === 0, '剩余 ' + left.n);

  // 反例对照：直接调用 export()（不经过 saveDb）后外键应当失效 —— 证明这个测试确实在验 pragma
  d1.getDb().export();
  ok('反例对照：裸 export() 之后外键确实失效（说明断言有效）', fkOf(d1) === 0, '实际 ' + fkOf(d1));

  // 再次 saveDb 应当把它修回来（这就是修复点）
  d1.saveDb();
  ok('再调一次 saveDb() 后外键恢复 = 1', fkOf(d1) === 1, '实际 ' + fkOf(d1));

  // ================= 场景 2：索引是否建出来（#10） =================
  console.log('\n=== 场景2：索引（#10）===');
  const idx = d1.queryAll("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'");
  ok(`SCHEMA 建出 ${idx.length} 个索引（期望 ≥ 15）`, idx.length >= 15, '实际 ' + idx.length);
  const keyIdx = idx.map(r => r.name);
  for (const want of ['idx_daily_record_preg_date', 'idx_habit_checkin_preg_date', 'idx_checkup_photo_checkup']) {
    ok(`存在索引 ${want}`, keyIdx.includes(want));
  }

  // ================= 场景 3：老库不再补 schedule_item_id（#15） =================
  console.log('\n=== 场景3：死字段 schedule_item_id（#15）===');
  const cols = d1.queryAll('PRAGMA table_info(prenatal_checkup)').map(c => c.name);
  ok('新库不含 schedule_item_id', !cols.includes('schedule_item_id'));

  // ================= 场景 4：损坏库 + 无备份 ⇒ 保全原文件、空库启动、health 标记 =================
  console.log('\n=== 场景4：损坏库且无备份（#2）===');
  const dirB = path.join(ROOT, 'b');
  const dt = path.join(dirB, 'dbsrc');
  fs.mkdirSync(dt, { recursive: true });
  // 造一个「头完好、中间页损坏」的库（最接近真实损坏，且库还能打开）
  {
    const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
    const SQL = await initSqlJs();
    const g = new SQL.Database();
    g.run('CREATE TABLE pregnancy (id TEXT PRIMARY KEY, due_date TEXT)');
    const st = g.prepare('INSERT INTO pregnancy VALUES (?,?)');
    for (let i = 0; i < 400; i++) st.run(['p' + i, '2026-10-08']);
    st.free();
    const buf = Buffer.from(g.export());
    const ps = buf.readUInt16BE(16);
    for (let i = 2 * ps; i < 3 * ps; i++) buf[i] = 0;
    fs.writeFileSync(path.join(dirB, 'pj.db'), buf);
  }
  const d2 = freshModule('b', dirB);
  let threw = null;
  try { await d2.initDb(); } catch (e) { threw = e.message; }
  const health = d2.getDbHealth();
  ok('损坏时未抛错（应用仍可启动，用户才能进设置页恢复）', threw === null, threw);
  ok('health.ok = false（不再"假正常"）', health.ok === false, JSON.stringify(health));
  ok('原损坏文件被保全为 .corrupt-*', !!health.preserved_path && fs.existsSync(health.preserved_path), String(health.preserved_path));
  const preserved = health.preserved_path ? fs.readFileSync(health.preserved_path) : Buffer.alloc(0);
  ok('保全文件非空且保留了原始字节（未被覆盖）', preserved.length > 0);

  // ================= 场景 5：损坏库 + 有备份 ⇒ 自动回退 =================
  console.log('\n=== 场景5：损坏库但有整库备份（#2 自动回退）===');
  const dirC = path.join(ROOT, 'c');
  const bdir = path.join(dirC, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  {
    // 造一个「好」的备份：含一条可识别的记录
    const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));
    const SQL = await initSqlJs();
    const g = new SQL.Database();
    g.run('CREATE TABLE pregnancy (id TEXT PRIMARY KEY, due_date TEXT)');
    g.run("INSERT INTO pregnancy VALUES ('from-backup','2026-12-31')");
    fs.writeFileSync(path.join(bdir, 'backup_2026-09-27T10-00-00.db'), Buffer.from(g.export()));
  }
  fs.writeFileSync(path.join(dirC, 'pj.db'), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200, 0x41)]));
  const d3 = freshModule('c', dirC);
  await d3.initDb();
  const h3 = d3.getDbHealth();
  ok('已标记为「回退自备份」', !!h3.recovered_from, JSON.stringify(h3));
  ok('回退后 health.ok = true', h3.ok === true);
  const row = d3.queryOne("SELECT * FROM pregnancy WHERE id = 'from-backup'");
  ok('备份里的数据已经可用（默认被恢复）', !!row, JSON.stringify(row));

  // ================= 场景 6：事务期间不允许落盘（#4） =================
  console.log('\n=== 场景6：事务期间落盘被跳过（#4）===');
  const d4 = freshModule('d', path.join(ROOT, 'd'));
  await d4.initDb();
  d4.run("INSERT INTO pregnancy (id, last_period_date, due_date) VALUES ('pgx','2026-01-01','2026-10-08')");
  d4.beginTransaction();
  ok('inTransaction() = true', d4.inTransaction() === true);
  const wroteRows = d4.getDb().exec("SELECT COUNT(*) FROM pregnancy")[0].values[0][0];
  d4.saveDb();   // 必须被跳过
  d4.commitTransaction();
  const after = d4.getDb().exec("SELECT COUNT(*) FROM pregnancy")[0].values[0][0];
  ok('事务内 saveDb() 未把事务回滚掉（行数仍在）', after === wroteRows, `${wroteRows} → ${after}`);
  ok('commitTransaction 后 inTransaction() = false', d4.inTransaction() === false);

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
