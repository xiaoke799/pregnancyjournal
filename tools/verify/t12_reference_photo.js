// 测试 #7（photo.js 目录前缀校验）端到端验证
// 【2026-09-29 变更】原「#6 reference.js」部分随 /reference/* 接口整体下线而移除：
// 7 个端点全部无活消费方（前端 api/reference.ts 只被死组件引用），故前端 api、
// 后端路由一并删除；food-safety 数据本身仍由 routes/diet.js、routes/export.js 提供。
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_l');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.join(TMP, 'photos'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'media'), { recursive: true });
// 与 photos 同级的「兄弟目录」——旧代码 prefixes 命中它
fs.mkdirSync(path.join(TMP, 'photos_backup'), { recursive: true });

process.env.STORAGE_DIR = TMP;
process.env.DATA_DIR = TMP;
process.env.PHOTOS_DIR = path.join(TMP, 'photos');
process.env.MEDIA_DIR = path.join(TMP, 'media');
process.env.DATABASE_PATH = path.join(TMP, 'pj.db');
process.env.APP_MODE = 'dev';

const express = require('express');
const db = require(path.join(SERVER_DIR, 'db.js'));
const photoRouter = require(path.join(SERVER_DIR, 'routes', 'photo.js'));

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
// 铁律 #33：解析源码做断言前必须先剥注释
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function get(port, p) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, raw: d, json: j }); });
    });
    req.on('error', e => resolve({ status: 0, raw: 'ERR ' + e.message, json: null }));
    req.end();
  });
}

(async () => {
  await db.initDb();

  // ================= #7 静态断言 =================
  console.log('=== L2：#7 photo.js 源码静态断言 ===');
  const photoSrc = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'photo.js'), 'utf-8');
  const photoClean = stripComments(photoSrc);
  const badPrefix = /resolvedPath\.toLowerCase\(\)\.startsWith\(dir\)/.test(photoClean);
  ok(!badPrefix, '不再存在裸 startsWith(dir)（不带 path.sep）的目录校验');

  // ================= #7 功能验证 =================
  const app = express();
  app.use(express.json());
  app.use('/api/v1', photoRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  console.log('=== L7：#7 照片文件接口目录校验 ===');
  const photosDir = path.join(TMP, 'photos');
  const siblingDir = path.join(TMP, 'photos_backup');
  const okFile = path.join(photosDir, 'ok.jpg');
  const evilFile = path.join(siblingDir, 'evil.jpg');
  fs.writeFileSync(okFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
  fs.writeFileSync(evilFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));

  db.run("INSERT INTO pregnancy (id, last_period_date, due_date) VALUES ('pg1','2026-01-01','2026-10-08')");
  db.run("INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, created_at) VALUES ('pOK','pg1','bump',?,NULL,datetime('now'))", [okFile]);
  db.run("INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, created_at) VALUES ('pEVIL','pg1','bump',?,NULL,datetime('now'))", [evilFile]);

  const rOk = await get(port, '/api/v1/photos/pOK/file');
  ok(rOk.status === 200, '【正例】PHOTOS_DIR 内的照片 → 200', rOk.status);
  const rEvil = await get(port, '/api/v1/photos/pEVIL/file');
  ok(rEvil.status === 403, '【关键】兄弟目录 photos_backup 内的文件 → 403（旧代码会放行）', rEvil.status);

  // 目录本身（不加分隔符的边界）：resolvedPath === dir 也算命中，但要确认 .jpg 不会误命中
  const sibling2 = await get(port, '/api/v1/photos/pEVIL/file');
  ok(JSON.stringify(sibling2.json) === JSON.stringify(rEvil.json), '重复请求结论稳定（非随机/非缓存假象）');

  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  server.close();
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
