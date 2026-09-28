// 测试 #5：崩溃前补落盘（uncaughtException / unhandledRejection）
// 思路（含反例对照）：
//   1) 起真实 server.js（tcp_shim 转发到 TCP）
//   2) 直接往内存库写一条带唯一标记的记录
//   3) 【关键对照】此时读磁盘上的 .db 字节，**不应**含该标记 —— 证明数据确实还在内存里
//   4) 触发 uncaughtException
//   5) 处理器里的 saveDb() 是同步的 ⇒ 立即再读磁盘字节，应当**已含**该标记
//   若第 3 步就已经含标记，说明标记本来就是落盘的，第 5 步证明不了任何事（假绿）。
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SERVER_DIR = require('./_env').SERVER_DIR;
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const TMP = path.join(require('./_env').TMP, 'tmp_o');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

process.env.STORAGE_DIR = TMP;
process.env.DATA_DIR = TMP;
process.env.PHOTOS_DIR = path.join(TMP, 'photos');
process.env.MEDIA_DIR = path.join(TMP, 'media');
process.env.DATABASE_PATH = path.join(TMP, 'pj.db');
process.env.APP_MODE = 'fnos';
process.env.PJ_TCP_PORT = String(process.env.PJ_CRASH_PORT || 38477);

require(SHIM);
require(path.join(SERVER_DIR, 'server.js'));

const db = require(path.join(SERVER_DIR, 'db.js'));
const config = require(path.join(SERVER_DIR, 'config.js'));
const DB_FILE = config.DATABASE_PATH;

const MARKER = 'CRASHFLUSH-' + crypto.randomBytes(6).toString('hex');
let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function fileHasMarker() {
  try { return fs.readFileSync(DB_FILE).includes(Buffer.from(MARKER)); }
  catch (e) { return false; }
}
function fileSize() { try { return fs.statSync(DB_FILE).size; } catch (e) { return -1; } }

(async () => {
  // 等 initDb 完成
  for (let i = 0; i < 200; i++) {
    try { if (db.getDb()) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  ok(!!db.getDb(), '数据库已初始化');

  console.log('=== P1：写入标记后，磁盘上还不该有它（证明它只在内存）===');
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date, baby_name) VALUES (?,?,?,?)",
    ['pg_crash', '2026-01-01', '2026-10-08', MARKER]);
  // 确认内存里能查到
  const inMem = db.queryOne('SELECT baby_name AS note FROM pregnancy WHERE id = ?', ['pg_crash']);
  ok(inMem && inMem.note === MARKER, '内存库中能读到标记', inMem && inMem.note);

  const before = fileHasMarker();
  const sizeBefore = fileSize();
  const mtimeBefore = fs.statSync(DB_FILE).mtimeMs;
  ok(before === false, '【关键对照】落盘前磁盘字节里没有标记（数据确实还在内存）', 'fileSize=' + sizeBefore);

  console.log('=== P2：触发 uncaughtException，处理器应同步补一次落盘 ===');
  const err = new Error('模拟未捕获异常 ' + MARKER);
  // 捕获住 handler 里的 setTimeout(exit)，避免进程在我们断言前退出
  const realExit = process.exit.bind(process);
  let exitCode = null;
  process.exit = (code) => { exitCode = code; /* 不真的退出 */ };

  process.emit('uncaughtException', err);

  const after = fileHasMarker();
  const sizeAfter = fileSize();
  const mtimeAfter = fs.statSync(DB_FILE).mtimeMs;
  ok(after === true, '【关键】处理后磁盘字节里出现了标记（崩溃前落盘生效）', { sizeBefore, sizeAfter });
  // 注意：sql.js 整库重写时页数可能不变 ⇒ 文件长度不一定增长，用 mtime 判断「确实又写了一次」
  ok(mtimeAfter >= mtimeBefore, '数据库文件确实被重新写入（mtime 前进）', { mtimeBefore, mtimeAfter });

  console.log('=== P3：unhandledRejection 同样应补落盘（换第二个标记）===');
  process.exit = realExit;
  const MARKER2 = 'REJECTFLUSH-' + crypto.randomBytes(6).toString('hex');
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date, baby_name) VALUES (?,?,?,?)",
    ['pg_crash2', '2026-01-01', '2026-10-08', MARKER2]);
  const has2Before = fs.readFileSync(DB_FILE).includes(Buffer.from(MARKER2));
  ok(has2Before === false, '【关键对照】第二个标记落盘前不在磁盘上');
  let exitCode2 = null;
  process.exit = (code) => { exitCode2 = code; };
  process.emit('unhandledRejection', new Error('模拟未处理拒绝 ' + MARKER2), Promise.resolve());
  const has2After = fs.readFileSync(DB_FILE).includes(Buffer.from(MARKER2));
  ok(has2After === true, '【关键】未处理拒绝后磁盘字节里出现了第二个标记');

  process.exit = realExit;
  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
