/**
 * 首页「胎动 / 宫缩」卡片 与 记录页「今天每次的记录」 的真实渲染核验（无头浏览器）
 *
 * 【为什么需要它】用户反馈：「你的胎动、宫缩和记录页功能没联动起来啊，
 * 首页相关功能是展示和快捷记录啊」。后端写回口径由 `e2e_session_rollup.js` 覆盖，
 * 本脚本负责**前端那一半**——静态检查看不出「卡片上到底有没有数字」「点记一笔弹的是不是那个弹窗」：
 *   ① 首页两张卡：标题、「今日 X 次」数字、进全屏页的链接、有没有「记一笔」按钮
 *   ② 点「记一笔」⇒ 弹出的必须是**胎动/宫缩小弹窗**（不是 26 类型通用大弹窗），字段对得上
 *   ③ 在小弹窗里填数字 → 保存 ⇒ 卡片上的数字**当场跟着变**（展示 ↔ 快捷记录闭环）
 *   ④ 记录页出现「今天每次的记录」，同一天多次会话**一条一行**都列出来
 *   ⑤ 无横向溢出（卡片从「纯跳转」改成带按钮的竖版，最容易撑破窄屏）
 *
 * ⚠️ 踩过的坑（沿用 shot_record_quickmodals 的教训）：
 *   · 弹窗必须**按标题**定位，不能按 DOM 顺序取 —— 上一个弹窗还在关闭动画里时会排在前面；
 *   · 判断弹窗是否渲染出来用 `offsetWidth`，不要用 getBoundingClientRect（入场缩放会取到中间态）；
 *   · naive-ui 的受控输入必须用**原生 setter + input 事件**写入，直接赋 .value 不会触发 v-model。
 *
 * 用法：node shot_dashboard_session_link.js [标签]
 * 产物：tools/verify/.tmp/dashlink/<标签>.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env = require('./_env');
const LABEL = process.argv[2] || 'dashlink';
const ROOT = env.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const OUT = path.join(env.TMP, 'dashlink');
const PORT = Number(process.env.PJ_TCP_PORT || 38561);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const WIN_W = 520;
const WIN_H = 1100;

/** 临时目录：删不掉就换一个（残留无头浏览器会占着它，实测能把整轮拖死） */
function prepareTmpDir() {
  const base = path.join(os.tmpdir(), 'pj-dashlink');
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
  var out = { cards: null, dialog: null, afterSave: null, record: null, overflow: null, errors: [] };
  var TARGET_TODAY = '__TODAY__';
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
  function modalByTitle(sub) {
    var ms = visibleModals();
    for (var k = ms.length - 1; k >= 0; k--) if (modalTitle(ms[k]).indexOf(sub) >= 0) return ms[k];
    return null;
  }
  /** 受控输入：必须用原生 setter + input 事件，直接赋 .value 不会触发 v-model */
  function setInput(el, val) {
    var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function clickByText(root, text) {
    var bs = root.querySelectorAll('button');
    for (var k = 0; k < bs.length; k++) if (clean(bs[k].textContent) === text) { bs[k].click(); return true; }
    return false;
  }
  function readCards() {
    return Array.prototype.map.call(document.querySelectorAll('.tool-card'), function (c) {
      var more = c.querySelector('.tool-card-more');
      return {
        title: clean((c.querySelector('.tool-card-title') || {}).textContent),
        stat: clean((c.querySelector('.tool-card-stat') || {}).textContent),
        statLive: !!(c.querySelector('.tool-card-stat') || {}).classList && c.querySelector('.tool-card-stat').classList.contains('is-live'),
        more: more ? more.getAttribute('href') : null,
        buttons: Array.prototype.map.call(c.querySelectorAll('button'), function (b) { return clean(b.textContent); }),
        rectW: c.offsetWidth
      };
    });
  }

  async function dashboard() {
    for (var i = 0; i < 60 && document.querySelectorAll('.tool-card').length < 2; i++) await sleep(200);
    out.cards = readCards();

    // 点「胎动计数器」那张卡上的「记一笔」
    var fmCard = null;
    var cs = document.querySelectorAll('.tool-card');
    for (var k = 0; k < cs.length; k++) {
      if (clean((cs[k].querySelector('.tool-card-title') || {}).textContent).indexOf('胎动') >= 0) { fmCard = cs[k]; break; }
    }
    if (!fmCard) { out.dialog = { found: false, why: '找不到胎动卡片' }; return; }
    var btn = null;
    var bs = fmCard.querySelectorAll('button');
    for (var j = 0; j < bs.length; j++) if (clean(bs[j].textContent) === '记一笔') { btn = bs[j]; break; }
    if (!btn) { out.dialog = { found: false, why: '胎动卡片上没有「记一笔」按钮' }; return; }
    btn.click();

    for (var t = 0; t < 40 && !modalByTitle('胎动'); t++) await sleep(150);
    var m = modalByTitle('胎动');
    if (!m) {
      var any = visibleModals();
      out.dialog = { found: false, why: '没弹出胎动弹窗', visible: any.map(modalTitle) };
      return;
    }
    var groups = m.querySelectorAll('.qf-group');
    var labels = [];
    for (var g = 0; g < groups.length; g++) {
      var l = groups[g].querySelector('label');
      labels.push(l ? clean(l.textContent) : '(无label)');
    }
    out.dialog = {
      found: true,
      title: modalTitle(m),
      labels: labels.join(' / '),
      isQuick: !m.querySelector('.type-selector'),   // 通用大弹窗会带 26 类型的 .type-selector
      hasHint: !!m.querySelector('.form-hint-text'),
      maxWidth: parseInt(getComputedStyle(m).maxWidth, 10)
    };
    // 卡片里显示「今日 4 次」⇒ 在弹窗里改成 6 并保存，卡片应当场变成「今日 6 次」
    var nums = m.querySelectorAll('.qf-group input');
    if (nums.length >= 2) { setInput(nums[1], 6); }   // [0]=日期, [1]=胎动次数
    await sleep(200);
    clickByText(m, '保存');
    for (var w = 0; w < 60; w++) { await sleep(200); if (!modalByTitle('胎动')) break; }
    await sleep(600);
    out.afterSave = { cards: readCards() };
  }

  async function recordPage() {
    location.hash = '#/record';
    for (var i = 0; i < 60 && !document.querySelector('.session-detail'); i++) await sleep(250);
    var sd = document.querySelector('.session-detail');
    if (!sd) { out.record = { found: false, why: '记录页没有「今天每次的记录」区块' }; return; }
    var heads = Array.prototype.map.call(sd.querySelectorAll('.sd-group-head'), function (h) { return clean(h.textContent); });
    var rows = Array.prototype.map.call(sd.querySelectorAll('.sd-row'), function (r) {
      return {
        time: clean((r.querySelector('.sd-time') || {}).textContent),
        main: clean((r.querySelector('.sd-main') || {}).textContent),
        sub: clean((r.querySelector('.sd-sub') || {}).textContent)
      };
    });
    out.record = { found: true, title: clean((sd.querySelector('.sd-title') || {}).textContent), heads: heads, rows: rows };
  }

  async function outOfRange() {
    // 场景：当天汇总值**超过表单上限**（次数 240 > 200、用时 300 > 180 分钟）——
    // 计数器一天多次会话相加很容易超出手填表单的 sanity 上限。
    // 要钉两件事，都不是靠猜：
    //   ① 首页卡片只是**展示**，不能被表单上限截断（必须原样显示 240 / 300）；
    //   ② 弹窗打开时次数框是**空的**（与其它 24 个小弹窗一致，不预填已有值）⇒
    //      用户误点「保存」时会被「请输入胎动次数」拦下，**不会把当天的值清零**。
    //      （这条曾经是我担心的静默丢数据路径，实测证明不存在，写在这里防回归。）
    var payload = { pregnancy_id: '__PID__', record_date: TARGET_TODAY, fetal_movement_count: 240, fetal_movement_duration: 300 };
    await fetch('${GW}/api/v1/daily-records', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    location.hash = '#/';
    await sleep(1500);
    for (var i = 0; i < 60 && document.querySelectorAll('.tool-card').length < 2; i++) await sleep(200);

    var fmCard = null;
    var cs = document.querySelectorAll('.tool-card');
    for (var k = 0; k < cs.length; k++) {
      if (clean((cs[k].querySelector('.tool-card-title') || {}).textContent).indexOf('胎动') >= 0) { fmCard = cs[k]; break; }
    }
    if (!fmCard) { out.outOfRange = { found: false, why: '找不到胎动卡片' }; return; }
    var cardStat = clean((fmCard.querySelector('.tool-card-stat') || {}).textContent);

    var btn = null, bs = fmCard.querySelectorAll('button');
    for (var j = 0; j < bs.length; j++) if (clean(bs[j].textContent) === '记一笔') { btn = bs[j]; break; }
    btn.click();
    for (var t = 0; t < 40 && !modalByTitle('胎动'); t++) await sleep(150);
    var m = modalByTitle('胎动');
    if (!m) { out.outOfRange = { found: false, why: '弹窗没打开' }; return; }
    var nums = m.querySelectorAll('.qf-group input');
    var shownCount = nums.length >= 2 ? nums[1].value : null;
    clickByText(m, '保存');   // 什么都不填直接保存 —— 应被拦下，而不是把 240 写成空
    for (var w = 0; w < 30; w++) { await sleep(200); if (!modalByTitle('胎动')) break; }
    await sleep(600);
    var res = null;
    try { res = await fetch('${GW}/api/v1/daily-records/by-date/' + TARGET_TODAY + '?pregnancy_id=__PID__').then(function (r) { return r.json(); }); } catch (e) { /* ignore */ }
    var d = (res && res.data) || {};
    out.outOfRange = {
      found: true,
      cardStat: cardStat,
      shownCount: shownCount,
      savedCount: d.fetal_movement_count,
      savedDuration: d.fetal_movement_duration
    };
  }

  function readCard(titleSub) {
    var cards = document.querySelectorAll('.metric-card');
    for (var i = 0; i < cards.length; i++) {
      var t = clean((cards[i].querySelector('.card-title') || {}).textContent);
      if (t.indexOf(titleSub) >= 0) return cards[i];
    }
    return null;
  }
  function cardTableRows(card) {
    var rows = card.querySelectorAll('.table-body tbody tr');
    return Array.prototype.map.call(rows, function (r) {
      var tds = r.querySelectorAll('td');
      return Array.prototype.map.call(tds, function (td) { return clean(td.textContent); }).join('|');
    });
  }

  async function statsPage() {
    location.hash = '#/stats';
    for (var i = 0; i < 80 && document.querySelectorAll('.metric-card').length === 0; i++) await sleep(250);
    var fmCard = readCard('胎动');
    var ctCard = readCard('宫缩');
    if (!fmCard || !ctCard) { out.stats = { found: false, titles: Array.prototype.map.call(document.querySelectorAll('.card-title'), function (t) { return clean(t.textContent); }) }; return; }
    var fmHint = clean((fmCard.querySelector('.card-hint') || {}).textContent);
    var ctHint = clean((ctCard.querySelector('.card-hint') || {}).textContent);
    // 展开「数据列表」——曲线本身在 canvas 里读不出来，表格是同一份数据的文本出口
    fmCard.querySelector('.table-toggle').click();
    ctCard.querySelector('.table-toggle').click();
    await sleep(400);
    var fmRows = cardTableRows(fmCard);
    var ctRows = cardTableRows(ctCard);
    out.stats = {
      found: true,
      fmHint: fmHint,
      ctHint: ctHint,
      fmRows: fmRows,
      ctRows: ctRows
    };
  }

  async function run() {
    window.addEventListener('error', function (e) { out.errors.push(String(e.message).slice(0, 120)); });
    try {
      await dashboard();
      await recordPage();
      await statsPage();
      await outOfRange();
      var d = document.scrollingElement || document.documentElement;
      out.overflow = { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
    } catch (e) {
      out.errors.push('probe: ' + (e && e.message ? e.message : String(e)));
    }
    var host = document.getElementById('DIAG') || document.createElement('div');
    host.id = 'DIAG';
    host.textContent = JSON.stringify(out);
    host.style.display = 'none';
    document.body.appendChild(host);
  }
  setTimeout(run, 2200);
})();
</script>
`;

function judge(r) {
  const bad = [];
  const cards = r.cards || [];
  if (cards.length !== 2) bad.push('首页工具卡不是 2 张（实际 ' + cards.length + '）');
  const byTitle = {};
  cards.forEach((c) => { byTitle[/胎动/.test(c.title) ? 'fm' : /宫缩/.test(c.title) ? 'ct' : 'x'] = c; });

  const fm = byTitle.fm, ct = byTitle.ct;
  if (!fm) bad.push('找不到「胎动计数器」卡');
  if (!ct) bad.push('找不到「宫缩计时器」卡');
  if (fm) {
    // 今天有 2 次会话、共 4 次 ⇒ 卡片必须把两者都写出来（否则用户会拿它去跟统计曲线比）
    if (!/今日\s*2\s*次会话\s*·\s*共\s*4\s*次/.test(fm.stat)) bad.push('胎动卡没写清「几次会话 · 共几次」（实际「' + fm.stat + '」）');
    if (fm.buttons.indexOf('记一笔') < 0) bad.push('胎动卡缺「记一笔」按钮');
    if (!fm.more || fm.more.indexOf('fetal-movement-counter') < 0) bad.push('胎动卡缺进全屏计数器页的链接（实际 ' + fm.more + '）');
  }
  if (ct) {
    if (!/今日\s*2\s*次/.test(ct.stat)) bad.push('宫缩卡没显示今日次数（实际「' + ct.stat + '」）');
    if (ct.buttons.indexOf('记一笔') < 0) bad.push('宫缩卡缺「记一笔」按钮');
    if (!ct.more || ct.more.indexOf('contraction-timer') < 0) bad.push('宫缩卡缺进全屏计时器页的链接（实际 ' + ct.more + '）');
  }

  const d = r.dialog || {};
  if (!d.found) bad.push('点「记一笔」没弹出胎动小弹窗（' + (d.why || '') + '）');
  else {
    if (!/胎动/.test(d.title)) bad.push('弹出的不是胎动弹窗（标题「' + d.title + '」）');
    if (!d.isQuick) bad.push('打开的是通用大弹窗，不是专属小弹窗');
    if (d.labels !== '日期 / 胎动次数 / 用时(分钟) / 当天备注（可选）') bad.push('弹窗字段不对（' + d.labels + '）');
    if (!d.hasHint) bad.push('弹窗缺就医提示文案');
    if (!(d.maxWidth >= 400 && d.maxWidth <= 440)) bad.push('弹窗 max-width ' + d.maxWidth + ' 不在小弹窗档位 400~440');
  }

  const after = (r.afterSave && r.afterSave.cards) || [];
  const afm = after.filter((c) => /胎动/.test(c.title))[0];
  if (!d.found) bad.push('（跳过）保存后数字未核对');
  else if (!afm) bad.push('保存后找不到胎动卡');
  else if (!/共\s*6\s*次/.test(afm.stat)) bad.push('保存后卡片数字没跟着变（实际「' + afm.stat + '」，期望含「共 6 次」）');

  const rec = r.record || {};
  if (!rec.found) bad.push('记录页看不到「今天每次的记录」（' + (rec.why || '') + '）');
  else {
    if (rec.title.indexOf('今天每次的记录') < 0) bad.push('明细区标题不对（' + rec.title + '）');
    const heads = rec.heads.join(' | ');
    if (!/胎动\s*·\s*2\s*次会话/.test(heads)) bad.push('胎动会话数不对（' + heads + '）');
    if (!/宫缩\s*·\s*1\s*次会话/.test(heads)) bad.push('宫缩会话数不对（' + heads + '）');
    if (rec.rows.length !== 3) bad.push('明细行数应为 3（2 胎动 + 1 宫缩），实际 ' + rec.rows.length);
    const mains = rec.rows.map((x) => x.main).join(' | ');
    if (!/2 次/.test(mains) || !/2 条/.test(mains)) bad.push('明细内容不对（' + mains + '）');
  }

  const ov = r.overflow || {};
  if (ov.scrollWidth && ov.clientWidth && ov.scrollWidth > ov.clientWidth + 1) {
    bad.push('出现横向溢出（scrollWidth ' + ov.scrollWidth + ' > clientWidth ' + ov.clientWidth + '）');
  }

  // 统计页：每天一个点 = 当天次数最高的那一次会话（不是合计）
  const st = r.stats || {};
  if (!st.found) bad.push('统计页没找到胎动/宫缩卡片（' + JSON.stringify(st.titles || []) + '）');
  else {
    if (!/次数最高/.test(st.fmHint || '')) bad.push('胎动卡没写口径说明（实际「' + st.fmHint + '」）');
    if (!/条数最多/.test(st.ctHint || '')) bad.push('宫缩卡没写口径说明（实际「' + st.ctHint + '」）');
    const fmLast = (st.fmRows || []).length ? st.fmRows[st.fmRows.length - 1] : '';
    const fmVal = String(fmLast).split('|')[1];
    // 今天两次会话各 2 次、合计 4 ⇒ 统计必须显示 2（取最高的那一次），不是 4（合计）
    if (fmVal !== '2') bad.push('统计页胎动没取「次数最高的那一次」（表格今日值应为 2，实际 ' + fmVal + '；行=' + fmLast + '）');
    const ctLast = (st.ctRows || []).length ? st.ctRows[st.ctRows.length - 1] : '';
    const ctVal = String(ctLast).split('|')[1];
    if (ctVal !== '50') bad.push('统计页宫缩持续没取代表会话的值（表格今日值应为 50 秒，实际 ' + ctVal + '；行=' + ctLast + '）');
    if (String(ctLast).indexOf('3.2') < 0) bad.push('统计页宫缩间隔没取代表会话的值（行=' + ctLast + '，应含 3.2）');
  }

  // 汇总值超出表单上限（240 次 / 300 分钟 vs max 200 / 180）时的两条口径，
  // 实测过、不是推断：卡片照原样展示，弹窗空着点保存不会清零。
  const or = r.outOfRange || {};
  if (!or.found) bad.push('越界值实测没跑起来（' + (or.why || '') + '）');
  else {
    if (!/共\s*240\s*次/.test(or.cardStat || '')) bad.push('卡片没原样展示超上限的汇总值（实际「' + or.cardStat + '」）');
    if (!/用时\s*300\s*分钟/.test(or.cardStat || '')) bad.push('卡片没原样展示超上限的用时（实际「' + or.cardStat + '」）');
    if (String(or.shownCount || '') !== '') bad.push('弹窗次数框应当为空（不预填已有值），实际「' + or.shownCount + '」');
    if (Number(or.savedCount) !== 240) bad.push('空表单点保存把当天次数清成了 ' + or.savedCount + '（应被拦下、保持 240）');
    if (Number(or.savedDuration) !== 300) bad.push('空表单点保存把当天用时清成了 ' + or.savedDuration + '（应保持 300）');
  }

  if (r.errors && r.errors.length) bad.push('页面有 JS 错误：' + r.errors.join(' / '));

  return bad;
}

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
  const today = dstr(0);
  const p = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
  let pid = p.json && p.json.data && p.json.data.id;
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p.json)); cleanup(); process.exit(2); }

  // 造出「今天记过」的现场：两次胎动会话（各 2 次）+ 一次宫缩会话（2 条）
  // ⚠️ 胎动会话用 00:00:00 起，避免结束时间（服务端取当前墙钟）早于开始时间而被判非法
  for (const st of ['00:00:00', '01:00:00']) {
    const s = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: today, start_time: st });
    const sid = s.json && s.json.data && s.json.data.id;
    await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);
    await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);
    await req('PUT', `${API}/fetal-movements/sessions/${sid}`);
  }
  const csS = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: today, start_time: '02:00:00' });
  const cid = csS.json && csS.json.data && csS.json.data.id;
  await req('POST', `${API}/contractions/sessions/${cid}/contractions`, { action: 'manual', start_time: '02:00:00', end_time: '02:00:50' });
  await req('POST', `${API}/contractions/sessions/${cid}/contractions`, { action: 'manual', start_time: '02:04:00', end_time: '02:04:50' });
  await req('PUT', `${API}/contractions/sessions/${cid}`);

  const rec = await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`);
  const rd = (rec.json && rec.json.data) || {};
  console.log(`【前置现场】胎动 ${rd.fetal_movement_count} 次 · 宫缩 ${rd.contraction_count} 条 / 持续 ${rd.contraction_duration}s / 间隔 ${rd.contraction_interval}min`);
  if (Number(rd.fetal_movement_count) !== 4 || Number(rd.contraction_count) !== 2) {
    console.log('❌ 前置数据不对，探针结论无意义'); cleanup(); process.exit(2);
  }

  const variant = path.join(UI_DIR, '_tmp_dashlink.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const probeJs = PROBE.replace('__TODAY__', today).replace(/__PID__/g, pid);
  fs.writeFileSync(variant, html.replace('</body>', probeJs + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); try { fs.unlinkSync(variant); } catch (e) {} cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_dashlink.html#/`;
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, `--window-size=${WIN_W},${WIN_H}`,
    '--virtual-time-budget=90000', '--dump-dom', url,
  ];
  const WATCH_MS = Number(process.env.PJ_SHOT_WATCH_MS || 180000);
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

  console.log('\n【首页卡片】');
  (r.cards || []).forEach((c) => console.log(`  ${c.title}｜${c.stat}｜按钮[${(c.buttons || []).join(',')}]｜→ ${c.more}`));
  console.log('\n【点「记一笔」弹出的弹窗】');
  console.log('  ' + JSON.stringify(r.dialog));
  console.log('\n【保存后卡片（期望「今日 6 次」）】');
  (r.afterSave && r.afterSave.cards || []).forEach((c) => console.log(`  ${c.title}｜${c.stat}`));
  console.log('\n【记录页「今天每次的记录」】');
  if (r.record && r.record.found) {
    console.log('  标题：' + r.record.title);
    (r.record.heads || []).forEach((h) => console.log('  分组：' + h));
    (r.record.rows || []).forEach((x) => console.log(`    ${x.time}｜${x.main}｜${x.sub}`));
  } else console.log('  ' + JSON.stringify(r.record));

  console.log('\n【统计页：口径说明 + 数据列表今日行】');
  if (r.stats && r.stats.found) {
    console.log('  胎动 口径：' + r.stats.fmHint);
    console.log('  宫缩 口径：' + r.stats.ctHint);
    (r.stats.fmRows || []).forEach((x) => console.log('  胎动表行：' + x));
    (r.stats.ctRows || []).forEach((x) => console.log('  宫缩表行：' + x));
  } else console.log('  ' + JSON.stringify(r.stats));

  console.log('\n【越界汇总值（240 次 / 300 分钟，表单上限 200 / 180）】');
  console.log('  ' + JSON.stringify(r.outOfRange));

  const bad = judge(r);
  console.log('\n【判定】');
  if (!bad.length) console.log('  ✔ 全部通过');
  else bad.forEach((b) => console.log('  ✘ ' + b));
  console.log(`\n合计: ${bad.length ? 0 : 1} 通过 / ${bad.length ? 1 : 0} 失败（明细 ${bad.length} 条）`);

  cleanup();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
