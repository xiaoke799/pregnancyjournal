/**
 * 计数器 / 计时器「中途退出后能接着用」—— 未结束会话不再越攒越多
 *
 * 【修的是什么】
 * 两个页面都是「进页面建会话、退出只做本地 reset、**不结束服务端会话**」：
 *   · 计时器 `ContractionTimerView.onMounted` 直接 `POST /contractions/sessions`；
 *   · 计数器 `FetalMovementCounterView` 由用户点「开始计数」时 `createSession`。
 * 而此前**进来一律新建、没有任何恢复入口** ⇒ 用户记到一半退出：
 *   ① 那条会话 `end_time` 永远是 NULL，首页卡片一直显示「计时中…」；
 *   ② 再进来又建一条 ⇒ 未结束的会话越积越多（首页「今日 N 次会话」口径仍干净，
 *      因为它按 `total_count > 0` 过滤，但会话本身会一直堆在库里）；
 *   ③ 原来记的那些明细在页面上再也接不上（只能去记录页的明细弹窗翻）。
 *
 * 【修法】进页面时先把**今天**那条未结束的会话接回来（`utils/session-resume.ts` 挑，
 *   两个 composable 的 `resumeSession()` 还原次数 / 明细 / 正在计时状态）；
 *   今天还挂着多条时留最晚的、更早的顺手收尾。
 *
 * 【本脚本覆盖】
 *   A. 纯函数 `pickResumableSession`（esbuild 转译后直接单测，秒级）
 *   B. 真后端契约：列表接口给不给得出「未结束 + 日期」这两个判断依据、结束能不能把 end_time 补上
 *   C. 静态断言：两个页面确实接上了（且计时器页**恢复必须在新建之前**）
 *   D. 反例自检：证明断言不是恒真
 *
 * 用法：node tools/verify/probe_session_resume.js
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
const T = path.join(os.tmpdir(), 'pj-session-resume');
const PORT = Number(process.env.PJ_TCP_PORT || 38581);
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

/** esbuild 转译零依赖 TS 纯函数后 require（同 probe_quicklog_semantics） */
async function loadModule(relPath) {
  let esbuild;
  try {
    esbuild = require(path.join(ROOT, 'frontend/node_modules/esbuild'));
  } catch (e) {
    throw new Error('找不到 esbuild（frontend/node_modules/esbuild）：' + e.message);
  }
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const out = await esbuild.transform(src, { loader: 'ts', format: 'cjs', target: 'node18' });
  const tmp = path.join(T, path.basename(relPath).replace(/\.ts$/, '.cjs'));
  fs.writeFileSync(tmp, out.code);
  return require(tmp);
}

const readIf = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');
/**
 * 扫顺序/关键字之前先剥注释。
 * ⚠️ 实测踩过：onMounted 那段的注释里写着「以前是 if (currentPregnancy) startSession(...)」，
 *    直接 indexOf 会把**注释里提到的旧写法**当成真的先新建 ⇒ 断言假红。
 */
const stripComments = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const readCode = (p) => stripComments(readIf(p));

(async () => {
  const sr = await loadModule('frontend/src/utils/session-resume.ts');
  const today = dstr(0);
  const yesterday = dstr(-1);

  console.log('===== 场景 A：pickResumableSession（纯函数）=====');
  {
    const openToday = { id: 'a', session_date: today, start_time: '09:00:00', end_time: null };
    const a = sr.pickResumableSession([openToday], today);
    check('A1 今天还没结束的会话 ⇒ 该接回来', a.keep && a.keep.id === 'a' && a.stale.length === 0, JSON.stringify(a));

    const b = sr.pickResumableSession([{ id: 'b', session_date: yesterday, start_time: '21:00:00', end_time: null }], today);
    check('A2 昨天遗留的未结束会话 ⇒ **不**接（跨天继续写会把昨天的数据算到今天）', b.keep === null, JSON.stringify(b));

    const c = sr.pickResumableSession([{ id: 'c', session_date: today, start_time: '09:00:00', end_time: '09:20:00' }], today);
    check('A3 今天已结束的会话 ⇒ 不接', c.keep === null, JSON.stringify(c));

    const d = sr.pickResumableSession([
      { id: 'd1', session_date: today, start_time: '09:00:00', end_time: null },
      { id: 'd2', session_date: today, start_time: '14:30:00', end_time: null },
      { id: 'd3', session_date: today, start_time: '11:00:00', end_time: null },
    ], today);
    check('A4 今天挂多条 ⇒ 接最晚那条，更早的进 stale 待收尾',
      d.keep && d.keep.id === 'd2' && d.stale.map((s) => s.id).join(',') === 'd1,d3',
      JSON.stringify({ keep: d.keep && d.keep.id, stale: d.stale.map((s) => s.id) }));

    check('A5 空列表 / 非数组 ⇒ 不接', sr.pickResumableSession(null, today).keep === null && sr.pickResumableSession([], today).keep === null);
    check('A6 拿不到今天 ⇒ 一律不接（宁可不恢复也不跨天）',
      sr.pickResumableSession([openToday], '').keep === null && sr.pickResumableSession([openToday], null).keep === null);
    check('A7 缺 id 的脏行跳过',
      sr.pickResumableSession([{ session_date: today, start_time: '09:00:00', end_time: null }], today).keep === null);
    // 排序靠 'HH:MM:SS' 定长字符串比较：字典序 === 时间序（不依赖 Date 解析）
    const e = sr.pickResumableSession([
      { id: 'e1', session_date: today, start_time: '08:00:00', end_time: null },
      { id: 'e2', session_date: today, start_time: '10:00:00', end_time: null },
    ], today);
    check('A8 按开始时间取最晚（08:00 < 10:00，字典序即时间序）', e.keep && e.keep.id === 'e2', JSON.stringify(e.keep));
  }

  console.log('\n===== 场景 D：反例自检（证明上面的断言有区分度）=====');
  {
    // 错误实现：漏掉 session_date 判断 —— 昨天那条会被接回来
    const wrong = (sessions, t) => Array.isArray(sessions) ? sessions.filter((s) => s && s.id && !s.end_time) : [];
    const y = [{ id: 'b', session_date: yesterday, start_time: '21:00:00', end_time: null }];
    check('D1 漏掉日期判断的写法会把昨天的会话接回来 ⇒ A2 有区分度',
      wrong(y, today).length === 1 && sr.pickResumableSession(y, today).keep === null);

    // 错误实现：取最早而不是最晚
    const rows = [
      { id: 'd1', session_date: today, start_time: '09:00:00', end_time: null },
      { id: 'd2', session_date: today, start_time: '14:30:00', end_time: null },
    ];
    const asc = rows.slice().sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))[0];
    check('D2 取最早一条的实现会选错 ⇒ A4 有区分度', asc.id === 'd1' && sr.pickResumableSession(rows, today).keep.id === 'd2');
  }

  console.log('\n===== 场景 C：静态断言（页面确实接上了）=====');
  {
    const ct = readCode('frontend/src/views/ContractionTimerView.vue');
    const fm = readCode('frontend/src/views/FetalMovementCounterView.vue');
    const ctc = readCode('frontend/src/composables/useContractionTimer.ts');
    const fmc = readCode('frontend/src/composables/useFetalMovementCounter.ts');

    check('C1 计时器页用共享挑选函数（不自己写一份）', ct.indexOf('pickResumableSession') >= 0);
    check('C2 计数器页同上', fm.indexOf('pickResumableSession') >= 0);
    check('C3 两个 composable 都暴露 resumeSession', /resumeSession/.test(ctc) && /resumeSession/.test(fmc));
    check('C4 恢复时会还原「正在计时」状态（末条宫缩没 end_time ⇒ 接着走字）',
      /isRunning\.value = true/.test(ctc) && /currentStartTime\.value = t/.test(ctc));
    check('C5 计数器页 onMounted 会尝试接回上次计数', /onMounted\(async[\s\S]{0,200}resumeTodayIfAny/.test(fm));

    // 🔴 顺序断言：计时器页 onMounted 里「先恢复、没有再新建」——
    //    写成先 startSession 就等于没修（每次进来还是先建一条新会话）。
    const block = ct.slice(ct.indexOf('onMounted(async () => {'));
    const iResume = block.indexOf('resumeTodayIfAny');
    const iStart = block.indexOf('startSession(');
    check('C6 计时器页 onMounted 里「恢复」必须排在「新建」之前',
      iResume >= 0 && iStart >= 0 && iResume < iStart,
      `resume@${iResume} start@${iStart}`);
  }

  console.log('\n===== 场景 B：真后端契约（列表接口给不给得出判断依据）=====');
  {
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
    const preg = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
    const pid = preg.json && preg.json.data && preg.json.data.id;

    // 造：昨天一条未结束 + 今天一条未结束
    await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: yesterday, start_time: '21:00:00' });
    const openRes = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: today, start_time: '09:00:00' });
    const openId = openRes.json && openRes.json.data && openRes.json.data.id;

    check('B1 新建会话返回 end_time 为空 / session_date / start_time（前端靠这三个字段判断）',
      !!openId && openRes.json.data.end_time === null && openRes.json.data.session_date === today && !!openRes.json.data.start_time,
      JSON.stringify(openRes.json && openRes.json.data));

    const byDate = await req('GET', `${API}/contractions/sessions?pregnancy_id=${pid}&date=${today}`);
    const listToday = (byDate.json && byDate.json.data) || [];
    check('B2 带 date 只返回今天的会话（昨天的陈旧会话不会被误接）',
      listToday.length === 1 && listToday[0].id === openId, JSON.stringify(listToday.map((s) => s.id)));

    const all = await req('GET', `${API}/contractions/sessions?pregnancy_id=${pid}`);
    check('B3 不带 date 才返回全部（说明 date 过滤真的生效，不是恒等于全量）',
      ((all.json && all.json.data) || []).length === 2, String(((all.json && all.json.data) || []).length));

    await req('PUT', `${API}/contractions/sessions/${openId}`);
    const after = await req('GET', `${API}/contractions/sessions/${openId}`);
    check('B4 结束会话会把 end_time 补上（收尾 stale 会话靠它）',
      !!(after.json && after.json.data && after.json.data.end_time), JSON.stringify(after.json && after.json.data && after.json.data.end_time));

    // 胎动侧同样的契约
    const fmOpen = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid });
    const fmId = fmOpen.json && fmOpen.json.data && fmOpen.json.data.id;
    await req('POST', `${API}/fetal-movements/sessions/${fmId}/kicks`);
    const fmList = await req('GET', `${API}/fetal-movements/sessions?pregnancy_id=${pid}&date=${today}`);
    const fmRow = ((fmList.json && fmList.json.data) || []).filter((s) => s.id === fmId)[0];
    check('B5 胎动侧：未结束会话 + total_count 都拿得到（恢复时要还原次数）',
      !!fmRow && fmRow.end_time === null && Number(fmRow.total_count) === 1,
      JSON.stringify(fmRow));

    const kicked = await req('GET', `${API}/fetal-movements/sessions/${fmId}/kicks`);
    check('B6 胎动侧：逐次明细可读回（恢复时要还原「已数几次」）',
      Array.isArray(kicked.json && kicked.json.data) && kicked.json.data.length === 1,
      JSON.stringify(kicked.json && kicked.json.data && kicked.json.data.length));

    cleanup();
  }

  console.log('\n==================================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e && e.stack ? e.stack : e); process.exit(3); });
