/**
 * 冷启动耗时探针：把 server.js start() 之前的关键步骤逐段计时。
 * 目的：定位「首次打开很慢 / 白屏、二次打开就快」到底卡在哪一段。
 *
 * 用法：cd app/server/node && node ../../../tools/verify/probe_coldstart.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE_DIR = path.resolve(__dirname, '../../app/server/node');
const t0 = Date.now();
const marks = [];
function mark(name, since) {
  const now = Date.now();
  marks.push({ name, ms: now - (since ?? t0), abs: now - t0 });
  return now;
}

function hr(label) {
  const used = process.memoryUsage();
  console.log(`    [内存] ${label}: rss=${(used.rss / 1048576).toFixed(0)}MB heap=${(used.heapUsed / 1048576).toFixed(0)}MB`);
}

console.log('===== 冷启动耗时探针 =====');
console.log('node:', process.version, '| cpu:', os.cpus()[0]?.model || '?', '| 核数:', os.cpus().length);

// 准备一个临时数据目录
const tmpData = path.join(os.tmpdir(), 'pj_coldstart_' + Date.now());
fs.mkdirSync(tmpData, { recursive: true });

// 用一个真实存在的库做样本；没有则新建
const sampleDb = path.resolve(__dirname, '../../data/pregnancy-journal.db');
const dbPath = path.join(tmpData, 'pregnancyjournal.db');
if (fs.existsSync(sampleDb)) {
  fs.copyFileSync(sampleDb, dbPath);
  console.log(`样本库: ${(fs.statSync(dbPath).size / 1024).toFixed(0)} KB`);
} else {
  console.log('样本库不存在，使用空库');
}

process.env.DATABASE_PATH = dbPath;
process.env.STATIC_DIR = path.resolve(__dirname, '../../app/ui');
process.chdir(NODE_DIR);

let t = mark('进程启动 + 探针自身准备完成');

// ---- 1. require 各模块（模拟 server.js 顶部） ----
require(path.join(NODE_DIR, 'config.js'));
t = mark('require config.js', t);
const initSqlJs = require(path.join(NODE_DIR, 'node_modules/sql.js'));
t = mark('require sql.js (加载 dist/sql-wasm.js 46KB 胶水代码)', t);
require(path.join(NODE_DIR, 'logger.js'));
const dbmod = require(path.join(NODE_DIR, 'db.js'));
t = mark('require logger/db (db.js 内定义 SCHEMA)', t);

// ---- 2. initSqlJs()：wasm 编译 ----
(async () => {
  const SQL = await initSqlJs();
  t = mark('initSqlJs() 完成（659KB wasm 读取+编译+实例化）', t);
  hr('wasm 就绪后');

  // ---- 3. 读库文件 ----
  const buf = fs.readFileSync(dbPath);
  t = mark(`readFileSync 库文件 (${(buf.length / 1024).toFixed(0)} KB)`, t);

  // ---- 4. new Database ----
  const db = new SQL.Database(buf);
  t = mark('new SQL.Database(buffer) —— 解析整库', t);

  // ---- 5. 执行 SCHEMA ----
  const SCHEMA = fs.readFileSync(path.join(NODE_DIR, 'db.js'), 'utf8');
  const m = SCHEMA.match(/const SCHEMA = `([\s\S]*?)`;/);
  const schema = m ? m[1] : '';
  const stmts = schema.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  let ok = 0;
  for (const s of stmts) {
    try { db.run(s); ok++; } catch (e) { /* 老库可能冲突 */ }
  }
  t = mark(`执行 SCHEMA (${stmts.length} 条语句, ${ok} 成功)`, t);

  // ---- 6. migrateDb：PRAGMA table_info ----
  const tables = ['prenatal_checkup', 'reminder', 'daily_record', 'push_log'];
  for (const tb of tables) {
    try { db.exec(`PRAGMA table_info(${tb})`); } catch (e) {}
  }
  t = mark(`migrateDb 的 ${tables.length} 次 PRAGMA table_info`, t);

  // ---- 7. saveDb：export + 写盘 ----
  const exp = db.export();
  t = mark(`db.export() 序列化 (${(exp.length / 1024).toFixed(0)} KB)`, t);
  fs.writeFileSync(dbPath + '.tmp', Buffer.from(exp));
  fs.renameSync(dbPath + '.tmp', dbPath);
  t = mark('writeFileSync + rename 落盘', t);

  // ---- 8. require 全部路由（server.js 的 22 个路由） ----
  const routes = [
    'pregnancy', 'checkup', 'lab_result', 'daily-record', 'contraction', 'photo', 'diary',
    'checklist', 'reminder', 'fetal_movement', 'reference', 'dashboard', 'export',
    'habit-checkin', 'supplement-checkin', 'app-config', 'diet', 'checkup-schedule',
    'wecom', 'feishu', 'push', 'logs',
  ];
  const routesDir = path.join(NODE_DIR, 'routes');
  let loaded = 0;
  for (const r of routes) {
    try { require(path.join(routesDir, r)); loaded++; } catch (e) { console.log('  路由加载失败', r, e.message); }
  }
  t = mark(`require ${routes.length} 个路由模块 (${loaded} 成功)`, t);
  hr('全部就绪后');

  // ---- 9. 静态资源：不压缩时主包有多大 ----
  const assetsDir = path.join(process.env.STATIC_DIR, 'assets');
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
    let total = 0;
    let main = 0;
    for (const f of files) {
      const sz = fs.statSync(path.join(assetsDir, f)).size;
      total += sz;
      if (f.startsWith('index-')) main = Math.max(main, sz);
    }
    console.log(`\n    [静态资源] assets 共 ${files.length} 个 JS/CSS，合计 ${(total / 1048576).toFixed(2)} MB`);
    console.log(`    [静态资源] 首屏主包 index-*.js = ${(main / 1048576).toFixed(2)} MB（未 gzip）`);
  }

  console.log('\n===== 分段耗时 =====');
  let prev = 0;
  for (const k of marks) {
    const delta = k.abs - prev;
    console.log(`  ${String(delta).padStart(6)} ms  累计 ${String(k.abs).padStart(6)} ms   ${k.name}`);
    prev = k.abs;
  }
  console.log(`\n  合计冷启动（到服务可接受请求前）：${marks[marks.length - 1].abs} ms`);

  // 清理
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})();
