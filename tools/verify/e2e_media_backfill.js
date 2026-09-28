/**
 * 端到端验证：历史 HEIC 记录回填
 *
 * 跑法：node e2e_heic_backfill.js
 * 模拟用户库里已经存在「file_path 指向 .heic」的老记录（应用早期版本上传的），
 * 调用启动时的回填逻辑，验证：
 *   - 记录被改写成 .jpg，且 .jpg 真实落盘
 *   - HEIC 原图不被删除
 *   - 产检报告的 file_type / mime_type / file_size 同步更新
 *   - 幂等：再跑一次不会重复处理，也不会报错
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SAMPLE_HEIC = path.join(require('./_env').FIXTURES, 'heic-test/sample.heic');
const T = path.join(os.tmpdir(), 'pj-heic-backfill');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(path.join(T, 'photos', 'album', '2026', '09'), { recursive: true });
fs.mkdirSync(path.join(T, 'checkup_reports'), { recursive: true });

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

  const albumDir = path.join(T, 'photos', 'album', '2026', '09');
  const reportDir = path.join(T, 'checkup_reports');
  const photoHeic = path.join(albumDir, 'old-photo.heic');
  const videoThumb = path.join(albumDir, 'thumb_old-video.jpg');
  const reportHeic = path.join(reportDir, 'old-report.heic');
  fs.copyFileSync(SAMPLE_HEIC, photoHeic);
  fs.copyFileSync(SAMPLE_HEIC, reportHeic);
  fs.writeFileSync(videoThumb, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  // 一张真正的 JPEG（无缩略图的老照片）：用来验证"补缩略图"
  const jpegLib = require(path.join(NODE_DIR, 'node_modules/jpeg-js'));
  const plainJpeg = path.join(albumDir, 'old-plain.jpg');
  const w = 900;
  const h = 600;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 40; rgba[i + 1] = 120; rgba[i + 2] = 200; rgba[i + 3] = 255; }
  fs.writeFileSync(plainJpeg, jpegLib.encode({ data: rgba, width: w, height: h }, 85).data);

  const pregId = db.generateId();
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date, is_active, created_at, updated_at) VALUES (?, '2026-03-15', '2026-12-20', 1, datetime('now'), datetime('now'))", [pregId]);

  const photoId = db.generateId();
  db.run(
    "INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'photo', datetime('now'), datetime('now'))",
    [photoId, pregId, photoHeic, photoHeic]
  );
  // 老照片：有文件、没缩略图（thumbnail_path 还等于 file_path）
  const plainId = db.generateId();
  db.run(
    "INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'photo', datetime('now'), datetime('now'))",
    [plainId, pregId, plainJpeg, plainJpeg]
  );
  // 视频缩略图是 .jpg，不该被回填逻辑误伤
  const videoId = db.generateId();
  db.run(
    "INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'video', datetime('now'), datetime('now'))",
    [videoId, pregId, videoThumb, videoThumb]
  );

  const checkupId = db.generateId();
  db.run(
    "INSERT INTO prenatal_checkup (id, pregnancy_id, checkup_date, gestational_week, checkup_type, created_at, updated_at) VALUES (?, ?, '2026-09-25', 28, 'standard', datetime('now'), datetime('now'))",
    [checkupId, pregId]
  );
  const reportId = db.generateId();
  db.run(
    "INSERT INTO checkup_report (id, checkup_id, file_path, filename, file_type, mime_type, file_size, created_at) VALUES (?, ?, ?, 'REPORT.HEIC', 'heic', 'image/heic', 9999, datetime('now'))",
    [reportId, checkupId, reportHeic]
  );
  db.saveDb();

  console.log('已构造历史数据：相册 HEIC×1、无缩略图 JPEG×1、视频缩略图 JPG×1、产检报告 HEIC×1\n');
  console.log('[回填执行]');
  await runMediaBackfill(db);

  const photo = db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [photoId]);
  const plain = db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [plainId]);
  const video = db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [videoId]);
  const report = db.queryOne('SELECT * FROM checkup_report WHERE id = ?', [reportId]);

  check('相册记录已改写成 .jpg', /\.jpg$/i.test(photo.file_path), photo.file_path);
  check('thumbnail_path 一并改写', /\.jpg$/i.test(photo.thumbnail_path), photo.thumbnail_path);
  check('.jpg 真实落盘', fs.existsSync(photo.file_path));
  check('HEIC 原图保留', fs.existsSync(photoHeic));
  check('视频缩略图未被误伤', video.file_path === videoThumb && video.thumbnail_path === videoThumb, video.file_path);
  check('报告记录改写成 .jpg', /\.jpg$/i.test(report.file_path), report.file_path);
  check('报告 file_type 更新为 jpg', report.file_type === 'jpg', report.file_type);
  check('报告 mime_type 更新为 image/jpeg', report.mime_type === 'image/jpeg', report.mime_type);
  check('报告 file_size 更新为实际大小', report.file_size > 0 && report.file_size !== 9999, String(report.file_size));
  check('报告 HEIC 原图保留', fs.existsSync(reportHeic));

  console.log('\n[补缩略图]');
  check('老照片生成了缩略图并写库', /_thumb\.jpg$/i.test(plain.thumbnail_path || ''), String(plain.thumbnail_path));
  check('缩略图文件真实存在', !!plain.thumbnail_path && fs.existsSync(plain.thumbnail_path));
  check('原图没被动过', fs.existsSync(plainJpeg) && plain.file_path === plainJpeg);
  const thumbSize = plain.thumbnail_path && fs.existsSync(plain.thumbnail_path) ? fs.statSync(plain.thumbnail_path).size : 0;
  check('缩略图比原图小很多', thumbSize > 0 && thumbSize < fs.statSync(plainJpeg).size, `${thumbSize} vs ${fs.statSync(plainJpeg).size}`);

  console.log('\n[幂等性：再跑一次]');
  const before = JSON.stringify(db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [photoId]));
  const beforePlain = JSON.stringify(db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [plainId]));
  await runMediaBackfill(db);
  const after = JSON.stringify(db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [photoId]));
  const afterPlain = JSON.stringify(db.queryOne('SELECT * FROM pregnancy_photo WHERE id = ?', [plainId]));
  check('重复执行结果不变（HEIC）', before === after);
  check('重复执行结果不变（缩略图）', beforePlain === afterPlain);

  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  console.log(`（临时数据: ${T}）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常:', e.message, e.stack); process.exit(1); });
