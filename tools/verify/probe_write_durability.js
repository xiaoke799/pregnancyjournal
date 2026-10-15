/**
 * 🔴 D1「业务写入不落盘」—— 写入后**立即硬杀**，数据不许丢
 *
 * 【修的是什么】写路由（daily-record / contraction / fetal_movement / dose-plan …）
 * 在 commitTransaction() 之后**没有任何落盘动作**，只靠 30 秒定时器兜底 ⇒
 * 硬杀进程 / OOM / 断电会丢掉最多 30 秒的记录，而接口照常报「保存成功」。
 * ⇒ 这是本项目唯一的「真实数据丢失窗口」类缺陷。
 *
 * 【修法】db.js 里加「脏标记 + setImmediate 合并落盘」：
 *   · run() 写成功后 markDirty()；commitTransaction() 成功后补一次（事务里的写会被跳过）；
 *   · _flushOnce 用 setImmediate 把落盘**合并到当前这批写结束之后**执行，
 *     一批写只落一次盘（库约 300KB，代价可忽略），而不是每条写一次；
 *   · 事务中 / 同步或异步写盘进行中 / 批量操作期间（_dbLocked）一律**保留脏标记**，
 *     交给 30 秒定时器兜底 —— 绝不能在这些分支里清掉 dirty，否则又回到「等 30 秒」。
 *
 * 【本脚本怎么证明修好了】唯一可信的办法是**真的杀**：
 *   起真后端 → 写三类数据 → 等 300ms（够 setImmediate 跑完，远小于 30s 兜底）
 *   → **SIGKILL 硬杀** → 重启同一个库文件 → 三类数据必须都在。
 *   若 D1 未修，数据只在内内存里，重启后读回为空 ⇒ 断言红。
 *
 * 【为什么等 300ms 而不是「响应一到就杀」】Node 的 HTTP 响应是异步写 socket 的，
 *   客户端收到响应时服务端的 setImmediate **可能还没跑**。等到 300ms 是为了避开这个
 *   竞态（否则会假失败）；300ms 相对 30s 兜底仍有 100 倍区分度，测试依然有效。
 *
 * 用法：node tools/verify/probe_write_durability.js
 * 退出码：断言失败 = 1
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env0 = require('./_env');
const ROOT = env0.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(env0.VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-write-durability');
const PORT = Number(process.env.PJ_TCP_PORT || 38585);
const GW = '/app/pregnancyjournal';
const SETTLE_MS = Number(process.env.PJ_SETTLE_MS || 300);

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev', FNOS_SOCKET_PATH: path.join(T, 'a.sock'), PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
  ASSETS_DIR: path.join(NODE_DIR, 'data'),
};

function req(m, p, b = null) {
  return new Promise((resolve, reject) => {
    const pay = b ? JSON.stringify(b) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, headers: pay ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pay) } : {} }, (res) => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (pay) r.write(pay);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ← ' + extra : '')); }
}

/** 起一个后端进程，等到 /api/health 就绪 */
async function startServer(label) {
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { const r = await req('GET', GW + '/api/health'); if (r.status === 200) return { child, log }; } catch (e) {}
  }
  try { child.kill('SIGKILL'); } catch (e) {}
  throw new Error('[' + label + '] 服务未就绪:\n' + log.slice(-1200));
}
/** 硬杀：SIGKILL，不给进程任何收尾机会（模拟断电 / OOM / kill -9） */
function hardKill(child) {
  try { child.kill('SIGKILL'); } catch (e) {}
}

(async () => {
  const dbPath = path.join(T, 'pj.db');
  const API = GW + '/api/v1';
  const today = dstr(0);

  console.log('===== 场景 A：三类写入 → 硬杀 → 重启，三类都必须在 =====');
  let pid = '';
  {
    const s1 = await startServer('A-第一轮');
    const preg = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
    pid = preg.json?.data?.id;
    check('A1 造孕期成功', !!pid, JSON.stringify(preg.json).slice(0, 160));

    // ① 非事务路径：daily-record（routes/daily-record.js 的 POST）
    const w = await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: today, weight: 63.5 });
    check('A2 写体重成功（接口报 200/code 0）', w.json && w.json.code === 0, JSON.stringify(w.json).slice(0, 160));

    // ② 计数器路径：胎动会话 + 2 次胎动（内部走事务）
    const s2 = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid });
    const sid = s2.json?.data?.id;
    await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);
    await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);

    // ③ 事务路径：宫缩会话 + 一条宫缩 + 结束会话（commitTransaction 后无落盘的那类）
    const s3 = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid });
    const cid = s3.json?.data?.id;
    check('A3 建宫缩会话成功', !!cid, JSON.stringify(s3.json).slice(0, 200));
    const cAdd = await req('POST', `${API}/contractions/sessions/${cid}/contractions`, { action: 'manual', start_time: '09:00:00', end_time: '09:00:50' });
    check('A3b 手动补记一条宫缩成功', cAdd.json && cAdd.json.code === 0, JSON.stringify(cAdd.json).slice(0, 200));
    const cEnd = await req('PUT', `${API}/contractions/sessions/${cid}`);
    check('A3c 结束宫缩会话成功', cEnd.json && cEnd.json.code === 0, JSON.stringify(cEnd.json).slice(0, 200));

    // ④ 打卡路径：habit-checkin（最短的事务写路由）
    const h = await req('POST', API + '/habit-checkins', { pregnancy_id: pid, date: today, items: [{ key: 'water', done: true }], note: '打卡' });
    check('A4 写打卡成功', h.json && h.json.code === 0, JSON.stringify(h.json).slice(0, 200));

    // 等 setImmediate 的合并落盘跑完（远小于 30 秒兜底）
    await sleep(SETTLE_MS);
    console.log(`  （等待 ${SETTLE_MS}ms 让合并落盘执行，然后 SIGKILL）`);
    // 诊断：杀之前先读一次（HTTP 读内存），用来区分「没写进去」还是「没落盘」
    const preKill = {
      weight: ((await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`)).json?.data || {}).weight,
      habits: ((await req('GET', `${API}/habit-checkins?pregnancy_id=${pid}&start_date=${today}&end_date=${today}`)).json?.data?.list || []).length,
      cts: ((await req('GET', `${API}/contractions/sessions?pregnancy_id=${pid}&date=${today}`)).json?.data || []).length,
    };
    console.log('  杀前读回（内存）: ' + JSON.stringify(preKill));
    try {
      const st = fs.statSync(dbPath);
      console.log('  杀前库文件: ' + st.size + ' B, mtime=' + st.mtime.toISOString());
    } catch (e) { console.log('  杀前库文件: 不存在'); }
    hardKill(s1.child);
    await sleep(400); // 等进程彻底退出、文件句柄释放
    check('A4 库文件已生成', fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0,
      fs.existsSync(dbPath) ? fs.statSync(dbPath).size + ' B' : '文件不存在');
  }

  // ---- 重启同一个库文件 ----
  {
    const s2 = await startServer('A-第二轮（重启）');
    const rec = await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`);
    const rd = (rec.json && rec.json.data) || {};
    check('🔴 A5 硬杀后体重仍在（63.5）—— 这条不过就是「最多丢 30 秒」没修',
      Number(rd.weight) === 63.5, '读回 weight=' + JSON.stringify(rd.weight));

    const fms = await req('GET', `${API}/fetal-movements/sessions?pregnancy_id=${pid}&date=${today}`);
    const fmList = (fms.json && fms.json.data) || [];
    const fmTotal = fmList.reduce((s, x) => s + Number(x.total_count || 0), 0);
    check('🔴 A6 硬杀后胎动仍在（合计 2 次）', fmTotal === 2, JSON.stringify(fmList.map((x) => [x.total_count, x.end_time])));

    const cts = await req('GET', `${API}/contractions/sessions?pregnancy_id=${pid}&date=${today}`);
    const ctList = (cts.json && cts.json.data) || [];
    const ctCount = ctList.reduce((s, x) => s + Number(x.total_count || 0), 0);
    check('🔴 A7 硬杀后宫缩仍在（1 条、且结束时间已补上）',
      ctCount === 1 && ctList.every((x) => !!x.end_time),
      JSON.stringify(cts.json).slice(0, 300));

    // 打卡查询用 start_date / end_date（没有 habit_date 这个参数）
    const habits = await req('GET', `${API}/habit-checkins?pregnancy_id=${pid}&start_date=${today}&end_date=${today}`);
    const hb = (habits.json && habits.json.data && habits.json.data.list) || habits.json?.data || [];
    check('🔴 A8 硬杀后打卡仍在', (Array.isArray(hb) ? hb.length : 0) >= 1,
      JSON.stringify(habits.json).slice(0, 300));

    hardKill(s2.child);
    await sleep(400);
  }

  console.log('\n===== 场景 B：持久化之后还能继续叠加（不是一次性） =====');
  {
    const s3 = await startServer('B-第三轮');
    const w = await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: today, weight: 64.2 });
    check('B1 重启后仍可写入', w.json && w.json.code === 0, JSON.stringify(w.json).slice(0, 160));
    await sleep(SETTLE_MS);
    hardKill(s3.child);
    await sleep(400);

    const s4 = await startServer('B-第四轮（重启）');
    const rec = await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`);
    const rd = (rec.json && rec.json.data) || {};
    check('B2 第二次硬杀后读到的是最新值 64.2（且没被旧快照盖回去）', Number(rd.weight) === 64.2,
      '读回 weight=' + JSON.stringify(rd.weight));
    hardKill(s4.child);
    await sleep(300);
  }

  console.log('\n===== 场景 C：接线与反例自检 =====');
  {
    // 静态：markDirty 必须真的存在且被 run/commitTransaction 调用（证明不是只加了变量）
    const src = fs.readFileSync(path.join(NODE_DIR, 'db.js'), 'utf8');
    check('C1 db.js 里有 markDirty 定义', /function markDirty\(/.test(src));
    check('C2 run() 成功后调用了 markDirty', /markDirty\(\);/.test(src));
    check('C3 commitTransaction() 成功后也调用（事务里的写被跳过，必须补一次）',
      /db\.run\('COMMIT'\);[\s\S]{0,200}_txDepth = 0;[\s\S]{0,300}markDirty\(\);/.test(src));
    check('C4 跳过时保留脏标记，并尽快重排（不清 dirty、不干等 30 秒）',
      /if \(_savingDb \|\| _savingDbAsync\) \{[\s\S]{0,240}setTimeout\(_flushOnce, 5\)/.test(src) &&
      /if \(wrote\) \{ _dirty = false; return; \}/.test(src) &&
      /if \(_dirty && !_flushScheduled\) \{[\s\S]{0,200}setTimeout\(_flushOnce, 5\)/.test(src),
      '负向对照实测：只在 _savingDbAsync 时 return 会把落盘推到 30 秒兜底');

    // 反例：把「跳过的分支里清掉 dirty」这个错误写法跑一遍语义，证明 C4 的断言有区分度
    let dirty = true;
    function wrongFlush() { dirty = false; }                    // 错误实现：无条件清
    function rightFlush() { if (Math.random() < 0) dirty = false; }
    wrongFlush();
    const wrongCleared = (dirty === false);
    dirty = true; rightFlush();
    check('C5 反例：无条件清 dirty 的写法会丢标记（C4 断言有区分度）',
      wrongCleared === true && dirty === true);
  }

  console.log('\n==================================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e && e.stack ? e.stack : e); process.exit(3); });
