// 实测：checkup_report.checkup_id 存非 UUID 的排期 id（cs_003）会不会被外键拦住
const path = require('path');
const fs = require('fs');

const T = path.join(__dirname, 'fkprobe');
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const NODE_DIR = require('./_env').SERVER_DIR;
process.chdir(NODE_DIR);
process.env.STORAGE_DIR = T;
process.env.DATABASE_PATH = path.join(T, 't.db');
process.env.PHOTOS_DIR = path.join(T, 'photos');
process.env.MEDIA_DIR = path.join(T, 'media');
process.env.BACKUPS_DIR = path.join(T, 'backups');
process.env.DATA_DIR = T;
process.env.LOG_DIR = path.join(T, 'logs');

const db = require(path.join(NODE_DIR, 'db.js'));

(async () => {
  await db.initDb();

  const fk = await db.queryAll('PRAGMA foreign_keys');
  console.log('>>> PRAGMA foreign_keys =', JSON.stringify(fk));

  // 造一个孕期档案
  const pid = '11111111-1111-1111-1111-111111111111';
  await db.run(
    "INSERT INTO pregnancy (id, last_period_date, due_date, is_active) VALUES (?, '2026-01-01', '2026-10-08', 1)",
    [pid]
  );

  // 场景 1：checkup_id 用排期条目 id（cs_003）—— 前端现在的行为
  try {
    await db.run(
      `INSERT INTO checkup_report (id, checkup_id, checkup_type, filename, file_path, file_type, mime_type, file_size, report_category, created_at)
       VALUES (?, ?, 'standard', 'a.jpg', '/tmp/a.jpg', 'jpg', 'image/jpeg', 1, '其他', datetime('now'))`,
      ['r-1', 'cs_003']
    );
    console.log('>>> 场景1 [cs_003] 插入：成功（外键未拦截）');
    const got = await db.queryAll("SELECT id, checkup_id FROM checkup_report WHERE checkup_id = 'cs_003'");
    console.log('    读回:', JSON.stringify(got));
  } catch (e) {
    console.log('>>> 场景1 [cs_003] 插入：失败 ->', e.message);
  }

  // 场景 2：完全不存在的 id，确认外键是否真在起作用
  try {
    await db.run(
      `INSERT INTO checkup_report (id, checkup_id, checkup_type, filename, file_path, file_type, mime_type, file_size, report_category, created_at)
       VALUES (?, ?, 'standard', 'b.jpg', '/tmp/b.jpg', 'jpg', 'image/jpeg', 1, '其他', datetime('now'))`,
      ['r-2', 'zzz_bogus_id_999']
    );
    console.log('>>> 场景2 [zzz_bogus_id_999] 插入：成功（外键确实未生效）');
  } catch (e) {
    console.log('>>> 场景2 [zzz_bogus_id_999] 插入：失败 ->', e.message);
  }

  // 场景 3：合法的 UUID（模拟自定义产检/已标记完成的标准条目）
  try {
    await db.run(
      `INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, checkup_type, notes, is_completed, created_at, updated_at)
       VALUES (?, ?, '2026-05-01', 20, 'NT检查', '从产检时间表标记完成: NT [cs_003]', 1, datetime('now'), datetime('now'))`,
      ['22222222-2222-2222-2222-222222222222', pid]
    );
    await db.run(
      `INSERT INTO checkup_report (id, checkup_id, checkup_type, filename, file_path, file_type, mime_type, file_size, report_category, created_at)
       VALUES (?, ?, 'standard', 'c.jpg', '/tmp/c.jpg', 'jpg', 'image/jpeg', 1, '其他', datetime('now'))`,
      ['r-3', '22222222-2222-2222-2222-222222222222']
    );
    console.log('>>> 场景3 [真 UUID] 插入：成功');
  } catch (e) {
    console.log('>>> 场景3 [真 UUID] 插入：失败 ->', e.message);
  }

  // 场景 4：按 notes 标记能否反查到关联的 checkup
  try {
    const found = await db.queryOne(
      "SELECT id FROM prenatal_checkup WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1",
      ['%从产检时间表标记完成%cs_003%']
    );
    console.log('>>> 场景4 按 notes 反查 cs_003 关联记录:', found ? found.id : '(未找到)');
  } catch (e) {
    console.log('>>> 场景4 反查失败 ->', e.message);
  }

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
