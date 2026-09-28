/**
 * 端到端验证：v0.0.27 → v0.0.29 升级后相册还能用
 *
 * 模拟**最坏情况**：`cmd/upgrade_init` 已经把照片从安装目录搬进持久目录，
 * 但数据库里的路径**仍然指向旧安装目录**（真实成因：迁移标记 `.storage_migrated_v1` 已存在
 * ⇒ `storage-migrate.js` 直接 return 不再重写路径；或用户换过存储卷导致前缀对不上）。
 * 此时表现为「相册有格子、点开全 404」。
 *
 * 期望：`services/media-backfill.js` 的**路径自愈**按文件名把它们找回来，并顺带完成
 * HEIC 转码与缩略图生成。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SAMPLE_HEIC = path.join(require('./_env').FIXTURES, 'heic-test/sample.heic');
const T = path.join(os.tmpdir(), 'pj-migrate-27-29');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}

fs.rmSync(T, { recursive: true, force: true });
const albumDir = path.join(T, 'photos', 'album', '2026', '09');
const reportsDir = path.join(T, 'photos', 'checkups', 'reports');
fs.mkdirSync(albumDir, { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

// 旧安装目录（模拟：文件已被搬走、这里已经空了）
const OLD_INSTALL = path.join(T, 'oldinstall', 'server', 'node', 'data');

Object.assign(process.env, {
  APP_MODE: 'dev',
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'),
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  LOG_LEVEL: 'WARN',
});

const db = require(path.join(NODE_DIR, 'db'));
const { runMediaBackfill } = require(path.join(NODE_DIR, 'services/media-backfill'));

(async () => {
  await db.initDb();

  // 真实文件放在持久目录（这就是 upgrade_init 抢救后的样子）
  const jpegLib = require(path.join(NODE_DIR, 'node_modules/jpeg-js'));
  const W = 1200, H = 900;
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 30; rgba[i + 1] = 150; rgba[i + 2] = 210; rgba[i + 3] = 255; }
  const jpegReal = path.join(albumDir, 'old-jpeg.jpg');
  fs.writeFileSync(jpegReal, jpegLib.encode({ data: rgba, width: W, height: H }, 85).data);
  const heicReal = path.join(albumDir, 'old-heic.heic');
  fs.copyFileSync(SAMPLE_HEIC, heicReal);
  const reportReal = path.join(reportsDir, 'old-report.heic');
  fs.copyFileSync(SAMPLE_HEIC, reportReal);

  // 数据库里存的却是**旧安装目录**的路径（文件已经不在了）
  const staleJpeg = path.join(OLD_INSTALL, 'photos', 'album', '2026', '09', 'old-jpeg.jpg');
  const staleHeic = path.join(OLD_INSTALL, 'photos', 'album', '2026', '09', 'old-heic.heic');
  const staleReport = path.join(OLD_INSTALL, 'photos', 'checkups', 'reports', 'old-report.heic');

  const pregId = db.generateId();
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date, is_active, created_at, updated_at) VALUES (?, '2026-03-15', '2026-12-20', 1, datetime('now'), datetime('now'))", [pregId]);

  const phJpeg = db.generateId();
  db.run("INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'photo', datetime('now'), datetime('now'))", [phJpeg, pregId, staleJpeg, staleJpeg]);
  const phHeic = db.generateId();
  db.run("INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'photo', datetime('now'), datetime('now'))", [phHeic, pregId, staleHeic, staleHeic]);

  const ckId = db.generateId();
  db.run("INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, checkup_type, created_at, updated_at) VALUES (?, ?, '2026-09-25', 28, 'standard', datetime('now'), datetime('now'))", [ckId, pregId]);
  const rpId = db.generateId();
  db.run("INSERT INTO checkup_report (id, checkup_id, file_path, filename, file_type, mime_type, file_size, created_at) VALUES (?, ?, ?, 'REPORT.HEIC', 'heic', 'image/heic', 1234, datetime('now'))", [rpId, ckId, staleReport]);
  db.saveDb();

  console.log('模拟状态：文件在持久目录、数据库指向旧安装目录（旧目录里是空的）');
  console.log('  旧路径样例:', staleHeic);
  check('迁移前：记录的路径确实不存在（复现 404 前提）', !fs.existsSync(staleHeic));

  console.log('\n[运行媒体补齐/路径自愈]');
  await runMediaBackfill(db);

  const a = db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [phJpeg]);
  const b = db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [phHeic]);
  const r = db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [rpId]);

  console.log('\n[断言]');
  check('JPEG 记录已指向真实文件', a.file_path === jpegReal && fs.existsSync(a.file_path), a.file_path);
  check('JPEG 补上了缩略图', /_thumb\.jpg$/i.test(a.thumbnail_path || '') && fs.existsSync(a.thumbnail_path), String(a.thumbnail_path));
  check('HEIC 记录已自愈到持久目录', fs.existsSync(b.file_path), b.file_path);
  check('HEIC 已转成 JPEG（file_path 以 .jpg 结尾）', /\.jpg$/i.test(b.file_path), b.file_path);
  check('HEIC 原图仍在磁盘上', fs.existsSync(heicReal));
  check('HEIC 也补了缩略图', /_thumb\.jpg$/i.test(b.thumbnail_path || '') && fs.existsSync(b.thumbnail_path), String(b.thumbnail_path));
  check('产检报告已自愈并转码', r.file_path === path.join(reportsDir, 'old-report.jpg') && fs.existsSync(r.file_path), r.file_path);
  check('报告的 mime/file_type 同步更新', r.file_type === 'jpg' && r.mime_type === 'image/jpeg', `${r.file_type}/${r.mime_type}`);
  check('旧安装目录仍为空（没有往那儿写东西）', !fs.existsSync(OLD_INSTALL));

  console.log('\n[幂等性：再跑一次]');
  const before = JSON.stringify([a, b, r]);
  await runMediaBackfill(db);
  const after = JSON.stringify([db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [phJpeg]), db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [phHeic]), db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [rpId])]);
  check('重复执行结果不变', before === after);

  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  console.log(`（临时数据: ${T}）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常:', e.message, e.stack); process.exit(1); });
