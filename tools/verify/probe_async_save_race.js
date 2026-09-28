/**
 * 验证：30 秒定时异步落盘，会不会把「旧快照」盖回到盘上？
 *
 * 场景（真实会发生，只是窗口很小）：
 *   1. 定时器启动 saveDbAsync()，它 export 了一份快照（此时数据是 A），写到 .tmp-async；
 *   2. 写盘是异步的，这期间事件循环是空的，业务照常跑 —— 备份/导出把数据改成 B 并调 saveDb()，
 *      同步写 .tmp 再 rename ⇒ 盘上现在是 B；
 *   3. 异步那轮慢悠悠地 rename .tmp-async ⇒ 盘上**变回 A**（旧快照），刚才那次同步落盘白写。
 *
 * 为了让这个窗口稳定复现，脚本把「写入 .tmp-async 之后」人为拖慢 400ms（模拟慢盘/大库）。
 * 判定：第 3 步结束后，盘上如果又是 A ⇒ 问题属实；是 B ⇒ 没问题。
 *
 * 用法：node probe_async_save_race.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-save-race');
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

process.env.APP_MODE = 'dev';
process.env.STORAGE_DIR = T;
process.env.DATA_DIR = T;
process.env.DATABASE_PATH = path.join(T, 'pj.db');
process.env.PHOTOS_DIR = path.join(T, 'photos');
process.env.MEDIA_DIR = path.join(T, 'media');
process.env.BACKUPS_DIR = path.join(T, 'backups');
process.env.LOG_DIR = path.join(T, 'logs');
process.env.PJ_BACKFILL_DELAY_MS = '999999'; // 别让后台补齐任务插一脚

const config = require(path.join(NODE_DIR, 'config.js'));
const db = require(path.join(NODE_DIR, 'db.js'));

// —— 慢盘模拟：写完 .tmp-async 之后拖 400ms 再走（放大 rename 之前的那个窗口）
const origWrite = fs.promises.writeFile;
let slowAsyncWrite = false;
fs.promises.writeFile = async function (p, ...rest) {
  const r = await origWrite.call(fs.promises, p, ...rest);
  if (slowAsyncWrite && String(p).endsWith('.tmp-async')) {
    await new Promise((res) => setTimeout(res, 400));
  }
  return r;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SQL = null;

/** 直接读盘上的数据库文件，看里面存的到底是什么 */
async function diskMark() {
  if (!SQL) {
    const initSqlJs = require(path.join(NODE_DIR, 'node_modules', 'sql.js'));
    SQL = await initSqlJs();
  }
  const d = new SQL.Database(fs.readFileSync(config.DATABASE_PATH));
  let out = '(无表)';
  try {
    const res = d.exec('SELECT v FROM mark');
    if (res.length && res[0].values.length) out = String(res[0].values[0][0]);
    else out = '(空表)';
  } catch (e) {
    out = '(查询失败: ' + e.message + ')';
  }
  d.close();
  return out;
}

(async () => {
  await db.initDb();
  db.run('CREATE TABLE IF NOT EXISTS mark (v TEXT)');
  db.run("INSERT INTO mark VALUES ('A')");
  db.saveDb();
  const s1 = await diskMark();

  slowAsyncWrite = true;
  const asyncTask = db.saveDbAsync();       // 快照 = A
  await sleep(200);                          // 此刻：tmp-async 已写完，卡在慢盘延迟里
  db.run('DELETE FROM mark');
  db.run("INSERT INTO mark VALUES ('B')");
  db.saveDb();                               // 业务同步落盘：盘上应为 B
  const s2 = await diskMark();
  await asyncTask;                           // 等异步那轮走完（它会 rename 旧快照）
  const s3 = await diskMark();

  // 反例验证：修完之后，正常路径的异步落盘必须**仍然有效**。
  // 只测「没被盖回去」是不够的 —— 把异步改成永远放弃也能拿到同样的绿。
  slowAsyncWrite = false;
  db.run('DELETE FROM mark');
  db.run("INSERT INTO mark VALUES ('C')");
  await db.saveDbAsync();
  const s4 = await diskMark();

  console.log('步骤1 初始同步落盘后，盘上 = ' + s1);
  console.log('步骤2 业务同步落盘后（应为 B），盘上 = ' + s2);
  console.log('步骤3 异步那轮结束后（关键，应为 B），盘上 = ' + s3);
  console.log('步骤4 单独一轮异步落盘后（应为 C），盘上 = ' + s4);
  console.log('');

  let bad = 0;
  if (s3 === 'A') {
    console.log('❌ 异步落盘把旧快照(A)盖了回去，步骤2 那次同步落盘被撤销');
    bad += 1;
  } else if (s3 !== 'B') {
    console.log('⚠️ 步骤3 结果异常（盘上=' + s3 + '），无法判定');
    bad += 1;
  } else {
    console.log('✅ 步骤3 通过：异步落盘没有盖回旧快照，盘上仍是最新数据(B)');
  }
  if (s4 !== 'C') {
    console.log('❌ 异步落盘被误伤：正常路径也不落盘了（盘上=' + s4 + '）');
    bad += 1;
  } else {
    console.log('✅ 步骤4 通过：正常路径的异步落盘照常生效');
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
