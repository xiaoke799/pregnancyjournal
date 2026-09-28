// 测试 #16（迁移排除清单与 cmd/upgrade_init 漂移）+ #17（改写失败仍落标记）
const path = require('path');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const BASE = require('./_env').TMP;
const TMP = path.join(BASE, 'tmp_q');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const TARGET = path.join(TMP, 'var');
process.env.STORAGE_DIR = TARGET;
process.env.DATA_DIR = TARGET;
process.env.PHOTOS_DIR = path.join(TARGET, 'photos');
process.env.MEDIA_DIR = path.join(TARGET, 'media');
process.env.DATABASE_PATH = path.join(TARGET, 'pj.db');
process.env.APP_MODE = 'dev';
process.chdir(TMP); // migrateStorage 用 process.cwd()/data 作为旧目录

const { migrateStorage } = require(path.join(SERVER_DIR, 'storage-migrate.js'));

const LEGACY = path.join(TMP, 'data');
const MARKER = path.join(TARGET, '.storage_migrated_v1');

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function seedLegacy() {
  fs.rmSync(TARGET, { recursive: true, force: true });
  fs.rmSync(LEGACY, { recursive: true, force: true });
  fs.mkdirSync(path.join(LEGACY, 'uploads'), { recursive: true });
  // 随包发布的只读知识库（都不应被搬走）
  for (const f of ['recipes.json', 'food_safety_v3.json', 'checkup_schedule.json',
    'checkup_subitem_aliases.json', 'default_checklist_hospital.json', 'build-food-safety.js']) {
    fs.writeFileSync(path.join(LEGACY, f), '{}');
  }
  // 真实用户数据（必须被搬走）
  fs.writeFileSync(path.join(LEGACY, 'myphoto.jpg'), 'JPEG');
  fs.writeFileSync(path.join(LEGACY, 'uploads', 'photo1.jpg'), 'JPEG2');
  fs.mkdirSync(TARGET, { recursive: true });
}
const exists = (p) => fs.existsSync(path.join(TARGET, p));

console.log('=== Q1：#16 迁移排除清单必须与 cmd/upgrade_init 一致 ===');
seedLegacy();
{
  // 先静态核对：upgrade_init 的排除清单里有的，storage-migrate 的 _skip 也得有
  const src = fs.readFileSync(path.join(SERVER_DIR, 'storage-migrate.js'), 'utf-8');
  const skipBlock = src.slice(src.indexOf('function _skip'), src.indexOf('function _copyDir'));
  for (const name of ['recipes.json', 'food_safety_v3.json', 'checkup_schedule.json', 'checkup_subitem_aliases.json']) {
    const stem = name.replace(/\.json$/, '');
    ok(skipBlock.includes(stem), `_skip 覆盖 ${name}`);
  }
}
migrateStorage({ queryAll: () => [], run: () => {} });
ok(exists('myphoto.jpg'), '用户照片被复制到持久目录');
ok(exists(path.join('uploads', 'photo1.jpg')), '用户上传目录被复制');
ok(!exists('checkup_subitem_aliases.json'), '【关键】checkup_subitem_aliases.json 未被搬运（此前会搬）');
ok(!exists('recipes.json') && !exists('food_safety_v3.json') && !exists('checkup_schedule.json'),
  '其余只读知识库同样未被搬运');
ok(!exists('default_checklist_hospital.json'), '默认清单未被搬运');
ok(!exists('build-food-safety.js'), '开发脚本未被搬运');

console.log('=== Q2：#17 正常路径仍应落标记（防止改成一律不落）===');
ok(fs.existsSync(MARKER), '改写成功时写入了迁移标记');

console.log('=== Q3：#17 反例——数据库改写失败时必须不落标记（下次启动重试）===');
seedLegacy();
{
  const boomDb = {
    queryAll(sql) {
      if (/sqlite_master/i.test(sql)) throw new Error('模拟 sqlite_master 查询失败');
      return [];
    },
    run() { },
  };
  migrateStorage(boomDb);
  ok(!fs.existsSync(MARKER), '【关键】改写失败 → 不写标记（原实现无论成败都写）');
  ok(exists('myphoto.jpg'), '文件复制照常完成（失败只影响标记）');
}

console.log('=== Q4：#17 第二次调用仍未落标记（证明「下次会重试」而非只跳过这一次）===');
{
  const boomDb = { queryAll: (s) => { if (/sqlite_master/i.test(s)) throw new Error('boom'); return []; }, run() { } };
  migrateStorage(boomDb);
  ok(!fs.existsSync(MARKER), '第二次调用依然尝试（未落标记 ⇒ 没有被 early-return 跳过）');
}

console.log('=== Q5：改写成功后第二次调用应直接跳过（幂等）===');
seedLegacy();
{
  migrateStorage({ queryAll: () => [], run: () => {} });
  ok(fs.existsSync(MARKER), '第一次落标记');
  const t0 = fs.statSync(path.join(TARGET, 'myphoto.jpg')).mtimeMs;
  fs.unlinkSync(path.join(TARGET, 'myphoto.jpg'));  // 手工删掉，验证第二次不会再复制
  migrateStorage({ queryAll: () => [], run: () => {} });
  ok(!fs.existsSync(path.join(TARGET, 'myphoto.jpg')), '已迁移过 → 直接跳过，不再复制');
}

console.log('');
console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
process.exit(FAIL === 0 ? 0 : 1);
