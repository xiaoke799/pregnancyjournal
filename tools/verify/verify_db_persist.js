/**
 * 数据库落盘语义核查（v0.0.31 修复项的回归护栏）
 *
 * 守三件事，都曾静默发生过、且接口照样报成功：
 *   A. 业务用的同步 saveDb() **不能**被异步定时落盘挡住
 *      （两者曾共用一个 _savingDb 标志：定时器在 await 写盘期间会让出事件循环，
 *        那段时间业务 saveDb() 直接 return —— 备份就会复制到最多 30 秒前的旧库）
 *   B. saveDb() 在批量操作锁定期间必须跳过（这是**正确**行为，防止回归成"照写不误"）
 *   C. export.js 恢复收尾必须先 unlockDb() 再 saveDb()，
 *      否则 saveDb() 被 _dbLocked 挡掉，恢复只落在内存里
 *
 * 用法：node tools/verify/verify_db_persist.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const NODE_DIR = path.resolve(__dirname, '../../app/server/node');
const DB_SRC = path.resolve(__dirname, '../../data/pregnancy-journal.db');

let pass = 0;
let fail = 0;
function ok(n, e) { pass++; console.log(`  ✅ ${n}${e ? '  ' + e : ''}`); }
function ng(n, e) { fail++; console.log(`  ❌ ${n}${e ? '  ' + e : ''}`); }
function assert(c, n, e) { c ? ok(n, e) : ng(n, e); }

(async () => {
  // ---------- A/B/C：静态断言（读源码，防止有人改回去） ----------
  console.log('A. 同步落盘不被异步落盘挡住');
  const dbSrc = fs.readFileSync(path.join(NODE_DIR, 'db.js'), 'utf8');

  // 取出 saveDb 函数体（到下一个顶层 function 为止）。
  // ⚠️ 必须先剥掉行注释再判断：注释里会讲解「为什么不能引用 _savingDbAsync」，
  //    带着注释匹配会命中注释里的字样，把正确的代码判成错误（假红）。
  const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '');
  const syncBody = stripComments((dbSrc.match(/function saveDb\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '');
  assert(syncBody.length > 0, '能解析出 saveDb 函数体');
  assert(!/_savingDbAsync/.test(syncBody), 'saveDb() 不检查 _savingDbAsync（否则会被定时落盘挡掉）');
  assert(/_savingDb\s*\|\|\s*_dbLocked/.test(syncBody), 'saveDb() 仍检查 _savingDb 与 _dbLocked');

  const asyncBody = stripComments((dbSrc.match(/async function saveDbAsync\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '');
  assert(asyncBody.length > 0, '能解析出 saveDbAsync 函数体');
  assert(/_savingDbAsync/.test(asyncBody), 'saveDbAsync() 使用自己的标志');
  assert(/\.tmp-async/.test(asyncBody), '异步落盘用独立的临时文件名（避免与同步路径互相踩）');

  console.log('\nB. 恢复收尾的解锁顺序');
  const exportSrc = fs.readFileSync(path.join(NODE_DIR, 'routes/export.js'), 'utf8');
  // 找出所有 unlockDb(); 紧跟着 saveDb(); 的组合（正确写法）
  const correct = (exportSrc.match(/db\.unlockDb\(\);\s*\n\s*db\.saveDb\(\);/g) || []).length;
  // 错误写法：saveDb 在 unlockDb 之前
  const wrong = (exportSrc.match(/db\.saveDb\(\);\s*\n\s*db\.unlockDb\(\);/g) || []).length;
  assert(wrong === 0, '不存在「先 saveDb 后 unlockDb」的写法（那样 saveDb 会被锁挡掉）', `(错误写法 ${wrong} 处)`);
  assert(correct >= 2, '两处恢复（全量恢复 / 一键恢复）都改成先解锁再落盘', `(正确写法 ${correct} 处)`);

  console.log('\nC. 备份复制的异常信息变量存在');
  // 曾经 copyToBackup 的 catch 里引用了不存在的 src / destDir，
  // 导致任何一次复制失败都会抛 ReferenceError 炸掉整次备份
  const copyBody = (exportSrc.match(/function copyToBackup\(([^)]*)\)\s*\{([\s\S]*?)\n {4}\}/) || [])[2] || '';
  assert(copyBody.length > 0, '能解析出 copyToBackup 函数体');
  const badRefs = copyBody.match(/\$\{(src|destDir)\}/g) || [];
  assert(badRefs.length === 0, 'copyToBackup 的日志里不引用不存在的 src/destDir', badRefs.length ? `(${badRefs})` : '');

  // ---------- D/E：运行时验证 ----------
  const tmp = path.join(os.tmpdir(), 'pj_persist_' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const dbPath = path.join(tmp, 'pj.db');
  if (fs.existsSync(DB_SRC)) fs.copyFileSync(DB_SRC, dbPath);

  process.env.DATABASE_PATH = dbPath;
  process.env.STORAGE_DIR = tmp;
  process.env.PJ_BACKFILL_DELAY_MS = '0';
  const db = require(path.join(NODE_DIR, 'db.js'));
  await db.initDb();

  console.log('\nD. 同步落盘真的落盘');
  const now = () => new Date().toISOString().replace('T',' ').substring(0,19);
  const mark1 = 'MARK_SYNC_' + Date.now();
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, baby_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ['p-' + mark1, '2026-01-01', '2026-10-08', mark1, now(), now()]);
  db.saveDb();
  await new Promise((r) => setTimeout(r, 200));
  const bytes1 = fs.readFileSync(dbPath);
  assert(bytes1.includes(Buffer.from(mark1)), 'saveDb() 后磁盘文件里能搜到标记', `(${mark1})`);

  console.log('\nE. 锁定期间不落盘（正确行为）');
  const mark2 = 'MARK_LOCKED_' + Date.now();
  db.lockDb();
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, baby_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ['p-' + mark2, '2026-01-01', '2026-10-08', mark2, now(), now()]);
  db.saveDb(); // 应被 _dbLocked 挡掉
  db.unlockDb();
  const bytes2 = fs.readFileSync(dbPath);
  assert(!bytes2.includes(Buffer.from(mark2)), 'lockDb() 期间 saveDb() 被跳过（防止写入半完成状态）');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(50));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
