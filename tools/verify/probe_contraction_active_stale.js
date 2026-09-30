/**
 * 首页「宫缩计时器」卡的「计时中…」标志 —— 陈旧未结束会话会把它永久卡住
 *
 * 【症状】用户只要进过一次宫缩计时器页面（`onMounted` 立即 `POST /contractions/sessions`
 *   建会话），中途返回/杀掉应用而没点「结束计时」，这条会话的 `end_time` 就**永远是 NULL**。
 *   而首页 `contraction_active` 的判定是
 *     `SELECT id FROM contraction_session WHERE pregnancy_id = ? AND end_time IS NULL LIMIT 1`
 *   —— **没有 session_date 过滤**，于是：
 *     ① 一次中途退出 ⇒ 首页宫缩卡**从此永远**显示「计时中…（点右侧继续）」；
 *     ② `contractionStatText` 在该分支直接 `return`，把「今日 N 次 · 持续 X 秒」整个盖掉
 *        ⇒ 用户再也看不到当天真实的宫缩数据；
 *     ③ 点「点右侧继续」进计时器页面会**再建一条新会话**，旧的永远没人能结束 ⇒ 无法自愈。
 *
 * 【修法】`contraction_active` 只认**今天**未结束的会话（加 `AND session_date = ?`）。
 *   「计时中」本来就是当天的事：隔天的会话不可能还在计时，也没有任何界面能恢复它
 *   （本应用没有 /active 恢复接口，计时器页 onMounted 一律新建）。
 *
 * 用法：node probe_contraction_active_stale.js
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
const T = path.join(os.tmpdir(), 'pj-contraction-active');
const PORT = Number(process.env.PJ_TCP_PORT || 38577);
const GW = '/app/pregnancyjournal';

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

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ← ' + extra : '')); }
}

const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

(async () => {
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', GW + '/api/health'); if (r.status === 200) { ready = true; break; } } catch (e) {}
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

  const API = GW + '/api/v1';
  const today = dstr(0);
  const yesterday = dstr(-1);

  const newPreg = async () => {
    const r = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
    return r.json && r.json.data && r.json.data.id;
  };
  const dash = async (pid) => (await req('GET', `${API}/dashboard?pregnancy_id=${pid}`)).json.data;
  /** 造一条「已进入计时器页面但没点结束」的会话：只建、不 PUT */
  const openSession = async (pid, date, startTime) => {
    const r = await req('POST', `${API}/contractions/sessions`, { pregnancy_id: pid, session_date: date, start_time: startTime });
    return r.json && r.json.data && r.json.data.id;
  };
  /** 一条完整记完并结束的会话（2 条宫缩，各 50 秒） */
  const finishedSession = async (pid, date) => {
    const sid = await openSession(pid, date, '02:00:00');
    await req('POST', `${API}/contractions/sessions/${sid}/contractions`, { action: 'manual', start_time: '02:00:00', end_time: '02:00:50' });
    await req('POST', `${API}/contractions/sessions/${sid}/contractions`, { action: 'manual', start_time: '02:04:00', end_time: '02:04:50' });
    await req('PUT', `${API}/contractions/sessions/${sid}`);
    return sid;
  };

  console.log('===== 场景 A：昨天遗留一条未结束会话 + 今天正常记完 =====');
  {
    const pid = await newPreg();
    await openSession(pid, yesterday, '21:00:00');   // 昨天进了计时器就走了，没点结束
    await finishedSession(pid, today);               // 今天认真记完并结束
    const d = await dash(pid);
    console.log(`  contraction_active=${d.contraction_active} / 今日会话数=${d.contraction_sessions}`);
    check('A1 昨天的陈旧未结束会话不该让首页一直显示「计时中」', d.contraction_active === false, 'contraction_active=' + d.contraction_active);
    check('A2 今天记完的会话要能被卡片看到（今日 1 次会话）', Number(d.contraction_sessions) === 1, String(d.contraction_sessions));
    check('A3 今天记的 2 条宫缩已写回当日记录', Number((d.today_record || {}).contraction_count) === 2, String((d.today_record || {}).contraction_count));
  }

  console.log('\n===== 场景 B：今天确实正在计时（未结束） =====');
  {
    const pid = await newPreg();
    await openSession(pid, today, '09:00:00');
    const d = await dash(pid);
    check('B1 今天有未结束会话 ⇒ 应显示「计时中」', d.contraction_active === true, 'contraction_active=' + d.contraction_active);
    // 「空会话不代表这一天」口径：count=0 的空壳会话不计入首页「今日 N 次会话」，
    // 否则「点开计时器没记就退出」会凭空多出 1 次会话（与写回/统计/记录页判据三处打架）
    check('B2 空壳会话不计入「今日会话数」', Number(d.contraction_sessions) === 0, String(d.contraction_sessions));
  }

  console.log('\n===== 场景 C：结束今天的会话后，标志要回落 =====');
  {
    const pid = await newPreg();
    const sid = await openSession(pid, today, '09:00:00');
    const before = await dash(pid);
    await req('PUT', `${API}/contractions/sessions/${sid}`);
    const after = await dash(pid);
    check('C1 结束前 = 计时中', before.contraction_active === true, String(before.contraction_active));
    check('C2 结束后不再显示计时中', after.contraction_active === false, String(after.contraction_active));
  }

  console.log(`\n==================================================`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log(`==================================================`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
