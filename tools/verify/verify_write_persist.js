/**
 * D1「业务写入不落盘」修复的回归护栏（2026-10-15）
 *
 * 守的是什么：写路由 commitTransaction() 后没有任何落盘动作的老问题不许回来。
 * 修复本体在 db.js：run()/commitTransaction() 成功后 markDirty() ⇒ setImmediate
 * 合并落盘；30 秒定时器退居兜底。曾因这条缺陷，硬杀进程 / OOM / 断电会丢掉最多
 * 30 秒的记录，而接口照常报"保存成功"。
 *
 * 六层证据：
 *   A. 静态断言：run() / commitTransaction() 里 markDirty 调用在位；
 *      30 秒定时器兜底仍在；markDirty 已导出；_flushOnce 跳过分支**不清**脏标记。
 *   B. 运行时：run() 写一条，不显式 saveDb，稍等即落盘。
 *   C. 运行时：事务中间不落盘（export 会回滚未提交事务），commit 后才落。
 *   D. **真·硬杀**：子进程写入后不退出，父进程 SIGKILL —— 磁盘上必须有那条写入。
 *      （"进程自然退出前会跑 setImmediate" 骗不过这条：子进程被强制杀死，
 *        优雅退出钩子根本没机会执行。）
 *   E. 反例自检：把 db.js 的 markDirty 调用全部删掉（打桩），D 必须变红 ——
 *      证明这套测试真的能抓到"退回 30 秒窗口"。
 *   F. 静态断言：合并语义（_flushScheduled 去重）在位，批量写不会每一条写一次盘。
 *
 * 用法：node tools/verify/verify_write_persist.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const NODE_DIR = path.resolve(__dirname, '../../app/server/node');
const UP = path.resolve(__dirname, '..');
const DB_SRC = path.resolve(UP, '../../data/pregnancy-journal.db');
const STUB = path.join(NODE_DIR, 'db.__stub__.js'); // 反例打桩用，用完即删

let pass = 0;
let fail = 0;
function ok(n, e) { pass++; console.log(`  ✅ ${n}${e ? '  ' + e : ''}`); }
function ng(n, e) { fail++; console.log(`  ❌ ${n}${e ? '  ' + e : ''}`); }
function assert(c, n, e) { c ? ok(n, e) : ng(n, e); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshTmp(tag) {
  const tmp = path.join(os.tmpdir(), `pj_wp_${tag}_${Date.now()}_${process.pid}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

/** 子进程：initDb → INSERT 一条 → 保持存活等父进程杀 */
function childScript(dbFile, useStub) {
  return `
const path = require('path');
process.env.DATABASE_PATH = ${JSON.stringify(dbFile)};
process.env.STORAGE_DIR = ${JSON.stringify(path.dirname(dbFile))};
process.env.PJ_BACKFILL_DELAY_MS = '0';
const db = require(${JSON.stringify(path.join(NODE_DIR, useStub ? 'db.__stub__.js' : 'db.js'))});
(async () => {
  await db.initDb();
  const now = () => new Date().toISOString().replace('T',' ').substring(0,19);
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, baby_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ['p-__MARK__', '2026-01-01', '2026-10-08', '__MARK__', now(), now()]);
  console.log('INSERTED');
  // 不退出：让父进程有机会在我们"还活着"的时候强杀。
  // setImmediate 的合并落盘在此之前必然已执行（事件循环空转，check 阶段立即跑）。
  setInterval(() => {}, 1000);
})().catch((e) => { console.error('CHILD_ERR', e.message); process.exit(1); });
`;
}

/** 子进程：事务中间不落盘、commit 后落盘（全程自己读盘判断，父进程只收结论） */
function txChildScript(mark) {
  return `
const fs = require('fs');
const path = require('path');
process.env.PJ_BACKFILL_DELAY_MS = '0';
const db = require(${JSON.stringify(path.join(NODE_DIR, 'db.js'))});
const dbFile = process.env.DATABASE_PATH;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await db.initDb();
  const now = () => new Date().toISOString().replace('T',' ').substring(0,19);
  db.beginTransaction();
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, baby_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ['p-${mark}', '2026-01-01', '2026-10-08', '${mark}', now(), now()]);
  await sleep(300);
  const before = fs.readFileSync(dbFile);
  console.log('BEFORE_COMMIT:' + before.includes(Buffer.from('${mark}')));
  db.commitTransaction();
  await sleep(400);
  const after = fs.readFileSync(dbFile);
  console.log('AFTER_COMMIT:' + after.includes(Buffer.from('${mark}')));
  process.exit(0);
})().catch((e) => { console.error('CHILD_ERR', e.message); process.exit(1); });
`;
}

/** 子进程：initDb → INSERT 一条 → 稍等 → 自己读盘汇报，然后自然退出 */
function autoChildScript(mark) {
  return `
const fs = require('fs');
const path = require('path');
process.env.PJ_BACKFILL_DELAY_MS = '0';
const db = require(${JSON.stringify(path.join(NODE_DIR, 'db.js'))});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // 库路径由父进程通过 DATABASE_PATH 注入（见 runScript 的 env 拼接约定）
  const dbFile = process.env.DATABASE_PATH;
  await db.initDb();
  const now = () => new Date().toISOString().replace('T',' ').substring(0,19);
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, baby_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ['p-${mark}', '2026-01-01', '2026-10-08', '${mark}', now(), now()]);
  await sleep(500);
  const hit = fs.readFileSync(dbFile).includes(Buffer.from('${mark}'));
  console.log('RESULT:' + hit);
  process.exit(0);
})().catch((e) => { console.error('CHILD_ERR', e.message); process.exit(1); });
`;
}

/** 通用子进程跑法：把 content 写盘执行，等 stdout 匹配 expectRe 或退出 */
async function runScript(tag, content, expectRe, timeoutMs = 20000) {
  const tmp = freshTmp(tag);
  const dbFile = path.join(tmp, 'pj.db');
  if (fs.existsSync(DB_SRC)) fs.copyFileSync(DB_SRC, dbFile);
  const scriptPath = path.join(tmp, 'child.js');
  fs.writeFileSync(scriptPath, content);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, DATABASE_PATH: dbFile, STORAGE_DIR: tmp, PJ_BACKFILL_DELAY_MS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('子进程 20s 超时' + (err ? ' / ' + err : ''))); }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`子进程退出码 ${code}: ${err}`));
      if (!expectRe.test(out)) return reject(new Error(`子进程输出缺少 ${expectRe}：${out}`));
      resolve({ out, tmp, dbFile });
    });
  });
}

/** 跑一个"写入后存活等杀"的子进程，返回它用的库文件路径 */
async function runChildUntilKilled(tag, mark, useStub) {
  const tmp = freshTmp(tag);
  const dbFile = path.join(tmp, 'pj.db');
  if (fs.existsSync(DB_SRC)) fs.copyFileSync(DB_SRC, dbFile);
  const scriptPath = path.join(tmp, 'child.js');
  fs.writeFileSync(scriptPath, childScript(dbFile, useStub).replace(/__MARK__/g, mark));
  const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const inserted = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('子进程 15s 未报 INSERTED' + (stderr ? ' / ' + stderr : ''))), 15000);
    child.stdout.on('data', (d) => { if (d.toString().includes('INSERTED')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`子进程提前退出 code=${code} ${stderr}`)); });
  });
  await inserted;
  // 子进程已 INSERTED 且存活 ⇒ 再给合并落盘一点时间，然后**强杀**
  await sleep(400);
  child.kill('SIGKILL');
  await new Promise((resolve) => { child.on('exit', () => resolve()); setTimeout(resolve, 3000); });
  return { dbFile, tmp };
}

(async () => {
  // ---------- A. 静态断言 ----------
  console.log('A. 静态断言：修复本体在位');
  const dbSrc = fs.readFileSync(path.join(NODE_DIR, 'db.js'), 'utf8');
  const body = (name) => {
    const m = dbSrc.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
    return (m && m[1]) || '';
  };
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const runBody = strip(body('run'));
  assert(runBody.length > 0, '能解析出 run() 函数体');
  assert(/markDirty\(\)/.test(runBody), 'run() 成功后调用 markDirty()');
  assert(/_writeCount\s*\+= 1/.test(runBody), 'run() 同时递增 _writeCount（防旧快照盖回新写）');

  const commitBody = strip(body('commitTransaction'));
  assert(/markDirty\(\)/.test(commitBody), 'commitTransaction() 后补触发 markDirty()（事务里的写被跳过，只补一半会漏）');

  assert(/setInterval\([\s\S]*?saveDbAsync[\s\S]*?,\s*30000\)/.test(strip(dbSrc)), '30 秒定时器兜底仍在（合并落盘被跳过时靠它重试）');
  assert(/module\.exports[\s\S]*markDirty/.test(dbSrc), 'markDirty 已从 module.exports 导出');
  assert(/_writeCount\s*!==\s*writeAtSnapshot/.test(strip(dbSrc)), 'saveDbAsync 的过期判据包含 _writeCount（只比 _writeSeq 会漏"写盘期间又有人写"）');

  const flushBody = strip(body('_flushOnce'));
  // 跳过分支（事务中/写盘中/锁定）必须**保留** _dirty：清了就退回 30 秒窗口
  assert(flushBody.length > 0, '能解析出 _flushOnce 函数体');
  assert(!/_txDepth > 0[\s\S]{0,200}?_dirty = false/.test(flushBody), '_flushOnce 的跳过分支不清脏标记（否则回到最多等 30 秒）');
  assert(/setTimeout\(_flushOnce/.test(flushBody), '被跳过/没写成时会尽快重排（不死等 30 秒）');

  const mdBody = strip(body('markDirty'));
  assert(/if \(_flushScheduled\) return/.test(mdBody), 'markDirty 合并语义：已排过就不重复排（批量写只落一次盘）');

  // ---------- B. 即时落盘 ----------
  // 子进程化：主进程里反复 require db.js 会撞上 config.js 的 require 缓存
  // （env 改了、config 还是第一次的值），每段用例都跑独立子进程最干净。
  console.log('\nB. run() 写入后不显式 saveDb 也会落盘');
  {
    const mark = 'MARK_AUTO_' + Date.now();
    const { out, tmp } = await runScript('b', autoChildScript(mark), /RESULT:(true|false)/);
    const hit = /RESULT:(true|false)/.exec(out)[1] === 'true';
    assert(hit, '未显式 saveDb，磁盘文件里已能搜到写入标记', `(${mark})`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---------- C. 事务中间不落盘 ----------
  console.log('\nC. 事务中间不落盘，commit 后落');
  {
    const mark = 'MARK_TX_' + Date.now();
    const { out, tmp } = await runScript('c', txChildScript(mark), /AFTER_COMMIT:(true|false)/);
    const before = /BEFORE_COMMIT:(true|false)/.exec(out);
    const after = /AFTER_COMMIT:(true|false)/.exec(out);
    assert(before && before[1] === 'false', '事务提交前磁盘上没有这条（export 会回滚未提交事务）', `(${mark})`);
    assert(after && after[1] === 'true', 'commitTransaction() 之后落盘（补触发生效）', `(${mark})`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---------- D. 真·硬杀 ----------
  console.log('\nD. 硬杀（SIGKILL）不丢写入');
  {
    const mark = 'MARK_KILL_' + Date.now();
    const { dbFile, tmp } = await runChildUntilKilled('d', mark, false);
    const bytes = fs.readFileSync(dbFile);
    assert(bytes.includes(Buffer.from(mark)), '子进程被 SIGKILL 前，写入已在磁盘上', `(${mark})`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---------- E. 反例自检 ----------
  console.log('\nE. 反例：删掉 markDirty 调用后 D 必须变红');
  {
    // 打桩：把 db.js 复制到同目录（保相对 require），删掉两处 markDirty() 调用
    let stub = dbSrc;
    const before = stub;
    stub = stub.replace(/(\n\s*)_writeCount \+= 1;\n\s*markDirty\(\);/, '$1_writeCount += 1;');
    stub = stub.replace(/(function commitTransaction\(\)\s*\{[\s\S]*?)\n\s*markDirty\(\);/, '$1');
    // ⚠️ 只能数「行首的 markDirty(); 调用」：`function markDirty() {` 定义行也含
    //    `markDirty()` 字样，用宽泛正则会把定义误判成调用（曾因此假红）。
    const callRe = /^\s*markDirty\(\);/gm;
    const leftCalls = (stub.match(callRe) || []).length;
    assert(stub !== before, '打桩成功删除了 markDirty 调用', `(剩余调用 ${leftCalls} 处)`);
    assert(leftCalls === 0, '桩源码里已无 run/commit 路径的 markDirty 调用');
    fs.writeFileSync(STUB, stub);
    try {
      const mark = 'MARK_STUB_' + Date.now();
      const { dbFile, tmp } = await runChildUntilKilled('e', mark, true);
      const bytes = fs.readFileSync(dbFile);
      assert(!bytes.includes(Buffer.from(mark)), '反例成立：无 markDirty 时硬杀后磁盘上没有写入（证明 D 不是恒绿）', `(${mark})`);
      fs.rmSync(tmp, { recursive: true, force: true });
    } finally {
      try { fs.rmSync(STUB, { force: true }); } catch (e) { /* 清不掉也要让结论可见 */ }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(50));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
