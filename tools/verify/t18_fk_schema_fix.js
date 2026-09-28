// 测试 #3-followup：外键强制生效 + 移除 checkup_id 的错误外键（老库重建）
//
// 背景：#3 修复（让 PRAGMA foreign_keys 在 export() 之后仍然生效）会暴露一个 schema 错误：
//   checkup_photo / checkup_report / lab_result 的 checkup_id 存的是「排期条目 id（cs_001…）」
//   或 custom_checkup 的 UUID，**不是** prenatal_checkup.id。外键一开，产检报告上传直接失败。
//   本脚本验证：老库会被安全重建（数据零丢失、外键去掉），并且重建之后上传路径真的能用。
const path = require('path');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const BASE = require('./_env').TMP;

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const OLD_SCHEMA = `
CREATE TABLE pregnancy (
  id TEXT PRIMARY KEY, last_period_date TEXT NOT NULL, conception_date TEXT,
  due_date TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, baby_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE prenatal_checkup (
  id TEXT PRIMARY KEY, pregnancy_id TEXT NOT NULL, checkup_date TEXT NOT NULL,
  gestational_week INTEGER DEFAULT 0, gestational_day INTEGER DEFAULT 0,
  checkup_type TEXT DEFAULT '常规产检', weight REAL, blood_pressure TEXT,
  fetal_heart_rate INTEGER, fundal_height REAL, abdominal_circumference REAL,
  hospital TEXT, notes TEXT, is_completed INTEGER DEFAULT 0, is_recommended INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);
CREATE TABLE custom_checkup (
  id TEXT PRIMARY KEY, pregnancy_id TEXT NOT NULL, name TEXT, checkup_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);
CREATE TABLE checkup_photo (
  id TEXT PRIMARY KEY, checkup_id TEXT NOT NULL, file_path TEXT NOT NULL,
  thumbnail_path TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id) ON DELETE CASCADE
);
CREATE TABLE checkup_report (
  id TEXT PRIMARY KEY, checkup_id TEXT NOT NULL, checkup_type TEXT DEFAULT 'standard',
  filename TEXT NOT NULL, file_path TEXT NOT NULL, file_type TEXT NOT NULL, mime_type TEXT,
  file_size INTEGER DEFAULT 0, report_category TEXT DEFAULT '其他', sub_item TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id) ON DELETE CASCADE
);
CREATE TABLE lab_result (
  id TEXT PRIMARY KEY, checkup_id TEXT NOT NULL, category TEXT NOT NULL, item_name TEXT NOT NULL,
  value REAL NOT NULL, unit TEXT, reference_min REAL, reference_max REAL,
  status TEXT DEFAULT 'normal', updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id) ON DELETE CASCADE
);
INSERT INTO pregnancy (id,last_period_date,due_date) VALUES ('pg-old','2025-04-10','2026-01-15');
INSERT INTO prenatal_checkup (id,pregnancy_id,checkup_date) VALUES ('pc-1','pg-old','2026-01-01');
INSERT INTO checkup_photo (id,checkup_id,file_path,note) VALUES
  ('cp-1','cs_003','/photos/checkups/cs_003/a.jpg','排期条目id'),
  ('cp-2','pc-1','/photos/checkups/pc-1/b.jpg','真 prenatal_checkup id'),
  ('cp-3','11111111-2222-3333-4444-555555555555','/photos/checkups/custom/c.jpg','自定义产检UUID');
INSERT INTO checkup_report (id,checkup_id,checkup_type,filename,file_path,file_type,sub_item) VALUES
  ('cr-1','cs_003','standard','NT报告.pdf','/photos/checkups/cs_003/reports/NT报告.pdf','application/pdf','NT检查'),
  ('cr-2','22222222-3333-4444-5555-666666666666','custom','自选.pdf','/photos/checkups/custom/reports/x.pdf','application/pdf',NULL);
INSERT INTO lab_result (id,checkup_id,category,item_name,value,unit) VALUES
  ('lr-1','cs_003','血常规','血红蛋白',118,'g/L'),
  ('lr-2','pc-1','尿常规','尿蛋白',0,'g/L');
`;

/** 用旧 schema 造一个「老库」文件 */
async function makeOldDb(SQL, dbFile) {
  const d = new SQL.Database();
  d.exec(OLD_SCHEMA);
  fs.writeFileSync(dbFile, Buffer.from(d.export()));
  d.close();
}

function tableSql(db, t) {
  const r = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${t}'`);
  return (r && r[0] && r[0].values[0]) ? String(r[0].values[0][0]) : null;
}
function count(db, t) { const r = db.exec(`SELECT COUNT(*) FROM ${t}`); return Number(r[0].values[0][0]); }
function all(db, t, cols) { const r = db.exec(`SELECT ${cols} FROM ${t} ORDER BY id`); return r[0] ? r[0].values : []; }

(async () => {
  const initSqlJs = require(path.join(SERVER_DIR, 'node_modules', 'sql.js'));

  // ============ 第一部分：迁移逻辑本身 ============
  console.log('=== 阶段 1：老库迁移（重建三张表，去掉错误外键，数据零丢失）===');
  const T1 = path.join(BASE, 'tmp_s1');
  fs.rmSync(T1, { recursive: true, force: true });
  fs.mkdirSync(T1, { recursive: true });
  const DB1 = path.join(T1, 'pj.db');
  const SQL1 = await initSqlJs();
  await makeOldDb(SQL1, DB1);

  // 迁移前基线
  const pre = new SQL1.Database(fs.readFileSync(DB1));
  const preCounts = {
    checkup_photo: count(pre, 'checkup_photo'),
    checkup_report: count(pre, 'checkup_report'),
    lab_result: count(pre, 'lab_result'),
  };
  const preSql = tableSql(pre, 'checkup_report');
  pre.close();
  ok(/REFERENCES prenatal_checkup/i.test(preSql), '迁移前：checkup_report 声明了错误外键（基线）', preSql.match(/FOREIGN KEY[^,)]*/)?.[0]);
  ok(preCounts.checkup_report === 2 && preCounts.checkup_photo === 3 && preCounts.lab_result === 2,
    '迁移前：三张表各有数据', preCounts);

  // 用真实 db.js 跑迁移
  process.env.STORAGE_DIR = T1; process.env.DATA_DIR = T1;
  process.env.PHOTOS_DIR = path.join(T1, 'photos'); process.env.MEDIA_DIR = path.join(T1, 'media');
  process.env.DATABASE_PATH = DB1; process.env.APP_MODE = 'dev';
  const db = require(path.join(SERVER_DIR, 'db.js'));
  const log = require(path.join(SERVER_DIR, 'logger'));
  await db.initDb();
  await new Promise(r => setTimeout(r, 300));

  const fkOn = db.getDb().exec('PRAGMA foreign_keys')[0].values[0][0];
  ok(fkOn === 1, '【关键】迁移后外键强制处于开启状态', fkOn);

  const postSql = tableSql(db.getDb(), 'checkup_report');
  ok(!/REFERENCES prenatal_checkup/i.test(postSql), '【关键】checkup_report 的错误外键已被移除', postSql.match(/FOREIGN KEY[^,)]*/)?.[0]);
  for (const t of ['checkup_photo', 'lab_result']) {
    ok(!/REFERENCES prenatal_checkup/i.test(tableSql(db.getDb(), t)), `${t} 的错误外键已被移除`);
  }

  const postCounts = {
    checkup_photo: count(db.getDb(), 'checkup_photo'),
    checkup_report: count(db.getDb(), 'checkup_report'),
    lab_result: count(db.getDb(), 'lab_result'),
  };
  ok(JSON.stringify(postCounts) === JSON.stringify(preCounts), '【关键】行数完全一致（零丢失）', { pre: preCounts, post: postCounts });

  const ids = all(db.getDb(), 'checkup_report', 'id, checkup_id, filename, file_path, sub_item');
  const expectedIds = [
    ['cr-1', 'cs_003', 'NT报告.pdf', '/photos/checkups/cs_003/reports/NT报告.pdf', 'NT检查'],
    ['cr-2', '22222222-3333-4444-5555-666666666666', '自选.pdf', '/photos/checkups/custom/reports/x.pdf', null],
  ];
  ok(JSON.stringify(ids) === JSON.stringify(expectedIds), '【关键】每行的每个字段都逐字保留（含中文文件名与排期 id）', ids);

  const photoIds = all(db.getDb(), 'checkup_photo', 'id, checkup_id, note');
  ok(photoIds.length === 3 && photoIds[0][1] === 'cs_003', 'checkup_photo 的三种 checkup_id 形态都在', photoIds);

  console.log('=== 阶段 2：外键强制对「错误引用」确实生效了（对照）===');
  const fkTest = (t, cols, vals) => {
    try { db.run(`INSERT INTO ${t} (${cols}) VALUES (${vals})`); return 'ACCEPTED'; }
    catch (e) { return 'REJECTED: ' + e.message; }
  };
  ok(/REJECTED/.test(fkTest('habit_checkin', 'id,pregnancy_id,date', "'hx','NO-SUCH-PG','2026-01-01'")),
    '【关键】孤儿 pregnancy_id 被拒绝（外键真的在管事）');
  ok(/ACCEPTED/.test(fkTest('habit_checkin', 'id,pregnancy_id,date', "'hx2','pg-old','2026-01-01'")),
    '合法 pregnancy_id 正常写入');
  ok(/ACCEPTED/.test(fkTest('checkup_report', 'id,checkup_id,filename,file_path,file_type', "'cr-new','cs_009','新报告.pdf','/x/y.pdf','application/pdf'")),
    '【关键】往「排期条目 id」上传报告不再被外键挡住（产检上传恢复可用）');
  ok(/ACCEPTED/.test(fkTest('checkup_report', 'id,checkup_id,filename,file_path,file_type', "'cr-new2','33333333-4444-5555-6666-777777777777','自选.pdf','/x/z.pdf','application/pdf'")),
    '往「自定义产检 UUID」上传报告同样可用');

  console.log('=== 阶段 3：级联删除仍然生效（这是修好外键的真正收益）===');
  const before = count(db.getDb(), 'prenatal_checkup');
  const recBefore = count(db.getDb(), 'daily_record');
  db.run("INSERT INTO daily_record (id,pregnancy_id,record_date,note) VALUES ('dr-1','pg-old','2026-01-02','x')");
  db.run("INSERT INTO diary_entry (id,pregnancy_id,entry_date,content) VALUES ('de-1','pg-old','2026-01-02','y')");
  db.run("DELETE FROM pregnancy WHERE id = 'pg-old'");
  ok(count(db.getDb(), 'prenatal_checkup') === 0, '删 pregnancy → prenatal_checkup 被级联清掉',
    { before, after: count(db.getDb(), 'prenatal_checkup') });
  ok(count(db.getDb(), 'custom_checkup') === 0, '删 pregnancy → custom_checkup 被级联清掉');
  ok(count(db.getDb(), 'daily_record') === 0 && count(db.getDb(), 'diary_entry') === 0,
    '删 pregnancy → daily_record / diary_entry 被级联清掉');

  console.log('=== 阶段 4：幂等——再跑一次 initDb 不应重复重建 ===');
  const beforeSql = tableSql(db.getDb(), 'checkup_report');
  await db.reloadFromFile();
  ok(tableSql(db.getDb(), 'checkup_report') === beforeSql, '二次载入后表定义不变（幂等）');
  ok(count(db.getDb(), 'checkup_report') === 2, '二次载入后数据仍是 2 行');

  console.log('=== 阶段 5：全新库直接建成干净 schema（不走重建路径）===');
  const T2 = path.join(BASE, 'tmp_s2');
  fs.rmSync(T2, { recursive: true, force: true });
  fs.mkdirSync(T2, { recursive: true });
  const child = require('child_process');
  // 用子进程加载全新库（避免与上面的模块实例串味）
  const script = `
    process.env.STORAGE_DIR=${JSON.stringify(T2)};process.env.DATA_DIR=${JSON.stringify(T2)};
    process.env.PHOTOS_DIR=${JSON.stringify(path.join(T2, 'photos'))};
    process.env.MEDIA_DIR=${JSON.stringify(path.join(T2, 'media'))};
    process.env.DATABASE_PATH=${JSON.stringify(path.join(T2, 'pj.db'))};
    process.env.APP_MODE='dev';
    const db=require(${JSON.stringify(path.join(SERVER_DIR, 'db.js'))});
    const log=require(${JSON.stringify(path.join(SERVER_DIR, 'logger'))});
    (async()=>{
      await db.initDb();
      const t=(n)=>{const r=db.getDb().exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='"+n+"'");return r[0]?String(r[0].values[0][0]):null};
      const fk=db.getDb().exec('PRAGMA foreign_keys')[0].values[0][0];
      console.log(JSON.stringify({
        fk,
        bad: /REFERENCES prenatal_checkup/i.test(t('checkup_report')||'') || /REFERENCES prenatal_checkup/i.test(t('checkup_photo')||'') || /REFERENCES prenatal_checkup/i.test(t('lab_result')||''),
        health: db.getDbHealth(),
      }));
      process.exit(0);
    })();
  `;
  const r2 = await new Promise((resolve) => {
    const c = child.spawn(process.execPath, ['-e', script], { cwd: SERVER_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; c.stdout.on('data', d => o += d); c.stderr.on('data', d => o += d);
    c.on('close', () => resolve(o));
  });
  const line = r2.split('\n').find(l => l.startsWith('{'));
  let parsed = null; try { parsed = JSON.parse(line); } catch (e) { }
  ok(!!parsed, '全新库启动输出可解析', r2.slice(-300));
  if (parsed) {
    ok(parsed.fk === 1, '全新库外键强制开启', parsed.fk);
    ok(parsed.bad === false, '【关键】全新库的三张表本来就没有错误外键', parsed.bad);
    ok(parsed.health && parsed.health.ok === true && parsed.health.foreign_keys === 1, 'health 反映外键已开启', parsed.health);
  }

  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
