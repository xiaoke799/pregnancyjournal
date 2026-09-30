/**
 * 记录页「胎动 / 宫缩」条目**点击去向**的核验（真后端 + 无头浏览器）
 *
 * 【为什么需要它】
 * 记录页点「胎动 / 宫缩」条目时，去向由**两个不同来源**决定，两者可以不一致：
 *   ① 条目「有没有数据」读 `daily_record` 的汇总列 —— 用户在记录页**手填**也会写这里；
 *   ② 点开后的「每次明细」读 `*_session` 表 —— 只有计数器 / 计时器才会写。
 * 于是「手填过、但一次会话都没有」的日子里，这一天有数据、却没有明细可看。
 * 若此时仍一律跳明细弹窗 ⇒ 用户看到的是**空明细框**，而且**再也点不开编辑表单**
 * （其它二十几个类型点条目都是「编辑」）—— 数据看得见、改不了。
 *
 * 三个场景（都用 `?date=` 进页面，共用一次浏览器）：
 *   A 只手填、零会话   → 点条目必须落到「编辑记录」（**不能**是空明细框）
 *   B 有会话（含汇总） → 点条目必须落到「宫缩 / 胎动明细」，且**行数 ≥ 1、不是空态**
 *   C 只有空会话       → 当天汇总无值 ⇒ 点条目落到「记录宫缩 / 记录胎动」小弹窗（新增路径）
 *
 * 顺带钉住条目右侧的提示符：有会话才显示「查看」，只有手填值时应与其它类型一致（编辑图标）。
 *
 * 用法：node tools/verify/probe_session_row_handfill.js
 * 产物：tools/verify/.tmp/sessionrow/<标签>.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env = require('./_env');
const LABEL = process.argv[2] || 'sessionrow';
const ROOT = env.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const OUT = path.join(env.TMP, LABEL);
const PORT = Number(process.env.PJ_TCP_PORT || 38571);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const WIN_W = 460;
const WIN_H = 1000;

/** 临时目录：删不掉就换一个（残留无头浏览器会占着它，实测能把整轮拖死） */
function prepareTmpDir() {
  const base = path.join(os.tmpdir(), 'pj-sessionrow');
  try { fs.rmSync(base, { recursive: true, force: true }); return base; }
  catch (e) { return `${base}-${process.pid}-${Date.now()}`; }
}
const T = prepareTmpDir();
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const serverEnv = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'),
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: UI_DIR,
};

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spawned = new Set();
function killTree(pid) {
  if (!pid) return;
  try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}
const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function findBrowser() {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}

const PROBE = `
<script>
(function () {
  var out = { a: null, b: null, c: null, errors: [] };
  var D = { a: '__DA__', b: '__DB__', c: '__DC__' };
  function clean(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visibleModals() {
    var ms = document.querySelectorAll('.n-modal'), r = [];
    for (var k = 0; k < ms.length; k++) if (ms[k].offsetWidth > 4 && ms[k].offsetHeight > 4) r.push(ms[k]);
    return r;
  }
  function modalTitle(m) {
    return clean((m.querySelector('.n-card-header__main') || m.querySelector('.n-card-header') || {}).textContent);
  }
  /** 找某一类的类别行（左边 label 完全相同） */
  function rowOf(label) {
    var items = document.querySelectorAll('.record-list .category-item');
    for (var i = 0; i < items.length; i++) {
      if (clean((items[i].querySelector('.row-label') || {}).textContent) === label) return items[i];
    }
    return null;
  }
  async function gotoRecord(date) {
    location.hash = '#/record?date=' + date;
    for (var i = 0; i < 80; i++) {
      await sleep(150);
      if (rowOf('宫缩') && rowOf('胎动')) break;
    }
    // 列表渲染出来 ≠ 当天数据回来：等两类的右侧提示符定下来
    await sleep(1200);
  }
  /** 点某一类条目 → 看落到哪个弹窗（**按标题判断**，不依赖 DOM 顺序） */
  async function clickRow(label) {
    var item = rowOf(label);
    if (!item) return { found: false, why: '找不到「' + label + '」类别行' };
    var hintEl = item.querySelector('.row-view-hint');
    var viewHint = clean(hintEl ? hintEl.textContent : '');
    var hasEditIcon = !!item.querySelector('.row-edit-icon');
    var hasAddCircle = !!item.querySelector('.add-circle');
    var preview = clean((item.querySelector('.row-preview') || {}).textContent);
    (item.querySelector('.category-row') || item).click();

    var dlg = null, title = '';
    for (var t = 0; t < 40 && !dlg; t++) {
      await sleep(150);
      var ms = visibleModals();
      for (var k = ms.length - 1; k >= 0; k--) {
        var tt = modalTitle(ms[k]);
        if (tt && tt !== '') { dlg = ms[k]; title = tt; break; }
      }
    }
    var res = {
      found: true, label: label, viewHint: viewHint, hasEditIcon: hasEditIcon,
      hasAddCircle: hasAddCircle, preview: preview,
      dialogOpen: !!dlg, title: title,
      isEmptyDetail: dlg ? !!dlg.querySelector('.sdd-empty') : false,
      rowCount: dlg ? dlg.querySelectorAll('.sdd-row').length : 0,
      summary: dlg ? clean((dlg.querySelector('.sdd-summary') || {}).textContent) : ''
    };
    if (dlg) {
      var cb = dlg.querySelector('.n-base-close');
      if (cb) cb.click();
      // 关干净再进下一个场景，避免叠着多个弹窗把标题读串
      for (var w = 0; w < 30; w++) { await sleep(150); if (visibleModals().length === 0) break; }
      if (visibleModals().length) {
        var mask = document.querySelector('.n-modal-mask');
        if (mask) mask.click();
        await sleep(400);
      }
    }
    return res;
  }
  async function scene(key, date) {
    var r = { date: date };
    await gotoRecord(date);
    r.contraction = await clickRow('宫缩');
    r.fetal = await clickRow('胎动');
    out[key] = r;
  }
  window.addEventListener('error', function (e) {
    out.errors.push(String((e && e.message) || 'unknown'));
  });
  setTimeout(async function () {
    try {
      await scene('a', D.a);   // 只手填、零会话
      await scene('b', D.b);   // 有会话
      await scene('c', D.c);   // 只有空会话
    } catch (e) {
      out.errors.push('探针异常: ' + (e && e.message));
    }
    var old = document.getElementById('DIAG'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'DIAG';
    d.textContent = JSON.stringify(out); document.body.appendChild(d);
  }, 2500);
  setTimeout(function () {
    if (!document.getElementById('DIAG')) {
      var d = document.createElement('div'); d.id = 'DIAG';
      d.textContent = JSON.stringify(out); document.body.appendChild(d);
    }
  }, 60000);
})();
</script>
`;

(async () => {
  const SHIM = path.join(env.VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { for (const bp of spawned) killTree(bp.pid); spawned.clear(); killTree(child.pid); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', GW + '/api/health'); if (r.json && r.json.status === 'ok') { ready = true; break; } } catch (e) { /* 等 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

  const API = GW + '/api/v1';
  const DA = dstr(0), DB = dstr(-1), DC = dstr(-2);
  const p = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
  let pid = p.json && p.json.data && p.json.data.id;
  if (!pid) {
    const pa = await req('GET', API + '/pregnancies/active');
    pid = pa.json && pa.json.data && pa.json.data.id;
  }
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p.json)); cleanup(); process.exit(2); }

  // ── 场景 A：只手填（记录页小弹窗的写法），一条会话都没有 ──────────────
  await req('POST', API + '/daily-records', {
    pregnancy_id: pid, record_date: DA,
    contraction_count: 2, contraction_duration: 45, contraction_interval: 8,
    fetal_movement_count: 12, fetal_movement_duration: 20,
  });

  // ── 场景 B：真会话（计数器 / 计时器），汇总由 rollup 写回 ───────────────
  // ⚠️ 胎动会话的「结束」由服务端取当前墙钟（不接受 end_time），所以开始时间必须贴着当前时刻取，
  //    否则 00:00:00 起、上午结束 ⇒ 算出来十几小时的"时长"，探针输出会看着像应用坏了。
  const nowD = new Date();
  const startD = new Date(nowD.getTime() - 15 * 60000);
  const p2 = (n) => String(n).padStart(2, '0');
  const fmStart = `${p2(startD.getHours())}:${p2(startD.getMinutes())}:${p2(startD.getSeconds())}`;
  const fs1 = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: DB, start_time: fmStart });
  const fsid = fs1.json && fs1.json.data && fs1.json.data.id;
  await req('POST', `${API}/fetal-movements/sessions/${fsid}/kicks`);
  await req('POST', `${API}/fetal-movements/sessions/${fsid}/kicks`);
  await req('PUT', `${API}/fetal-movements/sessions/${fsid}`);
  const cs1 = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: DB, start_time: '02:00:00' });
  const csid = cs1.json && cs1.json.data && cs1.json.data.id;
  await req('POST', `${API}/contractions/sessions/${csid}/contractions`, { action: 'manual', start_time: '02:00:00', end_time: '02:00:50' });
  await req('POST', `${API}/contractions/sessions/${csid}/contractions`, { action: 'manual', start_time: '02:04:00', end_time: '02:04:50' });
  await req('PUT', `${API}/contractions/sessions/${csid}`);

  // ── 场景 C：只有一条空会话（点开计时器、一条没记就结束）─────────────────
  await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: DC, start_time: '05:00:00' });

  // 前置现场自检：三个日期的「汇总值」必须分别是 有值 / 有值 / 无值
  const rdA = (await req('GET', `${API}/daily-records/by-date/${DA}?pregnancy_id=${pid}`)).json;
  const rdB = (await req('GET', `${API}/daily-records/by-date/${DB}?pregnancy_id=${pid}`)).json;
  const rdC = (await req('GET', `${API}/daily-records/by-date/${DC}?pregnancy_id=${pid}`)).json;
  const g = (r, k) => (r && r.data ? r.data[k] : null);
  console.log(`【前置现场】A(${DA}) 手填 宫缩${g(rdA, 'contraction_duration')}s 胎动${g(rdA, 'fetal_movement_count')}次`);
  console.log(`          B(${DB}) 会话 宫缩${g(rdB, 'contraction_duration')}s 胎动${g(rdB, 'fetal_movement_count')}次`);
  console.log(`          C(${DC}) 空会话 宫缩${g(rdC, 'contraction_duration')}s 胎动${g(rdC, 'fetal_movement_count')}次`);
  if (!g(rdA, 'contraction_duration') || !g(rdA, 'fetal_movement_count')) {
    console.log('❌ 场景 A 手填值没写进去，探针结论无意义'); cleanup(); process.exit(2);
  }
  if (!g(rdB, 'contraction_duration') || !g(rdB, 'fetal_movement_count')) {
    console.log('❌ 场景 B 汇总没写回，探针结论无意义'); cleanup(); process.exit(2);
  }
  if (g(rdC, 'contraction_duration') || g(rdC, 'fetal_movement_count')) {
    console.log('❌ 场景 C 空会话竟然写了汇总值（rollup 的「空会话不代表这一天」被破了），探针结论无意义'); cleanup(); process.exit(2);
  }

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); cleanup(); process.exit(2); }

  const variant = path.join(UI_DIR, '_tmp_sessionrow.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const probeJs = PROBE.replace('__DA__', DA).replace('__DB__', DB).replace('__DC__', DC);
  fs.writeFileSync(variant, html.replace('</body>', probeJs + '</body>'), 'utf-8');

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_sessionrow.html#/record?date=${DA}`;
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, `--window-size=${WIN_W},${WIN_H}`,
    '--virtual-time-budget=120000', '--dump-dom', url,
  ];
  const WATCH_MS = Number(process.env.PJ_SHOT_WATCH_MS || 200000);
  const dom = await new Promise((resolve) => {
    const bp = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    spawned.add(bp);
    let o = '', done = false;
    const finish = (timedOut) => {
      if (done) return; done = true; clearTimeout(wd); spawned.delete(bp);
      if (timedOut) o += '\n[看门狗] 浏览器超时被杀，DOM 可能不完整';
      resolve(o);
    };
    const wd = setTimeout(() => { killTree(bp.pid); finish(true); }, WATCH_MS);
    bp.stdout.on('data', (d) => (o += d));
    bp.stderr.on('data', (d) => (o += d));
    bp.on('close', () => finish(false));
    bp.on('error', () => finish(true));
  });
  try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }

  const mm = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
  let r = {};
  if (mm) { try { r = JSON.parse(mm[1].replace(/&quot;/g, '"')); } catch (e) { /* ignore */ } }
  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(r, null, 2), 'utf-8');

  const SCENES = [
    ['a', 'A 只手填、零会话（期望：点条目 → 编辑记录）'],
    ['b', 'B 有会话（期望：点条目 → 明细弹窗，行数≥1）'],
    ['c', 'C 只有空会话（期望：点条目 → 记录小弹窗）'],
  ];
  console.log('');
  for (const [k, title] of SCENES) {
    console.log(`【${title}】`);
    const s = r[k];
    if (!s) { console.log('  ⚠️ 没取到该场景结果'); continue; }
    for (const [label, d] of [['宫缩', s.contraction], ['胎动', s.fetal]]) {
      if (!d || !d.found) { console.log(`  ${label}：✘ ${(d && d.why) || '无结果'}`); continue; }
      console.log(`  ${label}：右侧提示[${d.viewHint || (d.hasAddCircle ? '+' : d.hasEditIcon ? '编辑图标' : '无')}] 预览「${d.preview}」 → 弹窗「${d.title}」明细行 ${d.rowCount} 空态=${d.isEmptyDetail}`);
    }
  }

  const bad = [];
  const A = r.a || {}, B = r.b || {}, C = r.c || {};
  // A：有手填值、零会话 ⇒ 必须能编辑（不能是空明细框）
  for (const [label, d] of [['宫缩', A.contraction], ['胎动', A.fetal]]) {
    if (!d || !d.found) { bad.push(`A：找不到「${label}」条目`); continue; }
    if (d.viewHint === '查看') bad.push(`A：只手填的「${label}」条目还挂着「查看」提示（没有会话可查，会点进空框）`);
    if (!d.dialogOpen) { bad.push(`A：点「${label}」条目没有任何弹窗`); continue; }
    if (d.title !== '编辑记录') bad.push(`A：点「${label}」条目落到「${d.title}」，应为「编辑记录」${d.isEmptyDetail ? '（这是空明细框：看得见、改不了）' : ''}`);
  }
  // B：有会话 ⇒ 必须看明细，且不是空态
  for (const [label, d] of [['宫缩', B.contraction], ['胎动', B.fetal]]) {
    if (!d || !d.found) { bad.push(`B：找不到「${label}」条目`); continue; }
    if (d.viewHint !== '查看') bad.push(`B：有会话的「${label}」条目没显示「查看」提示（实际「${d.viewHint}」）`);
    if (!d.dialogOpen) { bad.push(`B：点「${label}」条目没弹出明细`); continue; }
    if (d.title !== label + '明细') bad.push(`B：点「${label}」条目落到「${d.title}」，应为「${label}明细」`);
    if (d.isEmptyDetail) bad.push(`B：「${label}明细」是空态（有会话却看不到行）`);
    if (d.rowCount < 1) bad.push(`B：「${label}明细」行数为 ${d.rowCount}`);
  }
  // C：只有空会话 ⇒ 当天无汇总值 ⇒ 走「记录」小弹窗（不是明细、也不是编辑）
  for (const [label, d] of [['宫缩', C.contraction], ['胎动', C.fetal]]) {
    if (!d || !d.found) { bad.push(`C：找不到「${label}」条目`); continue; }
    if (d.viewHint === '查看') bad.push(`C：只有空会话的「${label}」条目挂着「查看」提示`);
    if (!d.dialogOpen) { bad.push(`C：点「${label}」条目没有任何弹窗`); continue; }
    if (d.title !== '记录' + label) bad.push(`C：点「${label}」条目落到「${d.title}」，应为「记录${label}」小弹窗`);
  }
  if (r.errors && r.errors.length) bad.push('页面有 JS 错误：' + r.errors.join(' / '));

  console.log('\n明细: ' + path.join(OUT, LABEL + '.json'));
  if (bad.length) {
    console.log('\n❌ 失败 ' + bad.length + ' 项：');
    bad.forEach((b) => console.log('   · ' + b));
    cleanup();
    process.exit(1);
  }
  console.log('\n✅ 3 场景 6 个条目 全部符合预期（1 通过 / 0 失败）');
  cleanup();
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
