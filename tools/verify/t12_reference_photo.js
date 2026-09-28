// 测试 #6（reference.js 目录/文件名/数据结构）+ #7（photo.js 目录前缀校验）端到端验证
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
const referenceRouter = require(path.join(SERVER_DIR, 'routes', 'reference.js'));
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

  // ================= #6 静态断言 =================
  console.log('=== L1：#6 reference.js 源码静态断言 ===');
  const refSrc = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'reference.js'), 'utf-8');
  const refClean = stripComments(refSrc);
  ok(/config\.ASSETS_DIR/.test(refClean), '_loadJson 使用 config.ASSETS_DIR');
  ok(!/config\.DATA_DIR/.test(refClean), '不再出现 config.DATA_DIR');
  ok(!/'food_safety\.json'/.test(refClean), '不再引用不存在的 food_safety.json');
  ok(/'food_safety_v3\.json'/.test(refClean), '改用真实文件名 food_safety_v3.json');

  // ================= #7 静态断言 =================
  console.log('=== L2：#7 photo.js 源码静态断言 ===');
  const photoSrc = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'photo.js'), 'utf-8');
  const photoClean = stripComments(photoSrc);
  const badPrefix = /resolvedPath\.toLowerCase\(\)\.startsWith\(dir\)/.test(photoClean);
  ok(!badPrefix, '不再存在裸 startsWith(dir)（不带 path.sep）的目录校验');

  // ================= 功能验证 =================
  const app = express();
  app.use(express.json());
  app.use('/api/v1', referenceRouter);
  app.use('/api/v1', photoRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  console.log('=== L3：#6 /reference/food-safety 真正能读到数据 ===');
  const all = await get(port, '/api/v1/reference/food-safety');
  ok(all.json && all.json.code === 0, '不再返回「食材安全数据不存在」', all.json && all.json.message);
  const cats = all.json && all.json.data && all.json.data.categories;
  ok(Array.isArray(cats) && cats.length === 13, '返回 13 个分类（真实文件内容）', Array.isArray(cats) ? cats.length : cats);
  ok(all.json && all.json.data && all.json.data.metadata && all.json.data.metadata.version === '3.3',
    'metadata.version = 3.3（真实文件）', all.json && all.json.data && all.json.data.metadata && all.json.data.metadata.version);

  console.log('=== L4：#6 关键词搜索命中 {categories[].items[]} ===');
  const hit = await get(port, '/api/v1/reference/food-safety?keyword=' + encodeURIComponent('菠菜'));
  ok(hit.json && hit.json.code === 0, '搜索接口 code=0', hit.json && hit.json.message);
  const hitData = hit.json && hit.json.data;
  ok(hitData && hitData.count > 0, '【关键】搜「菠菜」有结果（旧代码恒 0）', hitData && hitData.count);
  ok(hitData && hitData.results.some(r => r.name === '菠菜' && r.category === '蔬菜类'),
    '结果里含「菠菜」且带分类名', hitData && hitData.results && hitData.results.slice(0, 3).map(r => r.name + '/' + r.category));

  console.log('=== L5：#6 反例对照（搜索不是「全都返回」）===');
  const none = await get(port, '/api/v1/reference/food-safety?keyword=' + encodeURIComponent('绝对不存在的食材xyzabc'));
  ok(none.json && none.json.data && none.json.data.count === 0, '搜不存在的词 count=0（证明搜索真的在过滤）', none.json && none.json.data && none.json.data.count);
  const aliasHit = await get(port, '/api/v1/reference/food-safety?keyword=' + encodeURIComponent('西红柿'));
  ok(aliasHit.json && aliasHit.json.data && aliasHit.json.data.count > 0, '别名「西红柿」能搜到（aliases 分支生效）', aliasHit.json && aliasHit.json.data && aliasHit.json.data.count);

  console.log('=== L6：#6 其余 5 个 json 确实不存在 → 仍返回明确错误（不炸）===');
  const dev = await get(port, '/api/v1/reference/development/12');
  ok(dev.json && dev.json.code === 1001 && /不存在/.test(dev.json.message), '返回「发育数据文件不存在」（诚实失败，非 500）', dev.json && dev.json.message);
  const ci = await get(port, '/api/v1/reference/checkup-items/foo');
  ok(ci.json && ci.json.code === 1001 && /不存在/.test(ci.json.message), '产检知识库同样明确报不存在', ci.json && ci.json.message);
  const rg = await get(port, '/api/v1/reference/ranges/foo');
  ok(rg.json && rg.json.code === 1001 && /不存在/.test(rg.json.message), '参考范围同样明确报不存在', rg.json && rg.json.message);
  const cp = await get(port, '/api/v1/reference/checkup-plan');
  ok(cp.json && cp.json.code === 1001 && /不存在/.test(cp.json.message), '产检标准同样明确报不存在', cp.json && cp.json.message);
  const iom = await get(port, '/api/v1/reference/iom-weight');
  ok(iom.json && iom.json.code === 1001 && /不存在/.test(iom.json.message), 'IOM 体重标准同样明确报不存在', iom.json && iom.json.message);

  // ================= #7 功能验证 =================
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
