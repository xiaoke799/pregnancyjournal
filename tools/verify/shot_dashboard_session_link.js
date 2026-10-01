/**
 * 首页「胎动 / 宫缩」卡片 与 记录页「点条目弹明细」 的真实渲染核验（无头浏览器）
 *
 * 【为什么需要它】用户反馈：「你的胎动、宫缩和记录页功能没联动起来啊，
 * 首页相关功能是展示和快捷记录啊」。后端写回口径由 `e2e_session_rollup.js` 覆盖，
 * 本脚本负责**前端那一半**——静态检查看不出「卡片上到底有没有数字」「点记一笔弹的是不是那个弹窗」：
 *   ① 首页两张卡：标题、「今日 X 次」数字、**整卡可点**（标题链接铺满整卡·无「›」符号）、有没有「记一笔」按钮
 *   ② 点「记一笔」⇒ 弹出的必须是**胎动/宫缩小弹窗**（不是 26 类型通用大弹窗），字段对得上
 *   ③ 在小弹窗里填数字 → 保存 ⇒ 卡片上的数字**当场跟着变**（展示 ↔ 快捷记录闭环）
 *   ④ 记录页**不再**内联铺开明细；点「胎动」「宫缩」条目弹出明细框，同一天多次会话**一条一行**
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
  /**
   * 点单选按钮（追加 / 改为本次值）。
   * ⚠️ 不能用 clickByText：Naive 的 n-radio-button 渲染成 label/div，**不是 button**，
   *    按 button 找会一个都找不到，于是「模式没切」被误当成「覆盖功能坏了」。
   */
  function clickRadio(root, text) {
    var nodes = root.querySelectorAll('label, [class*="radio-button"]');
    for (var k = 0; k < nodes.length; k++) {
      if (clean(nodes[k].textContent) !== text) continue;
      var inp = nodes[k].querySelector('input');
      // ⚠️ 只 click() 不够稳：Naive 的 radio-button 是受控组件，input 常被样式藏起来，
      //    单靠 click 有时不触发 change ⇒ 表现为「点到了但模式没切」，随机复现（flaky）。
      //    这里 click + 显式置 checked + 派发 change 三件套都上。
      if (inp) {
        try { inp.checked = true; } catch (e) {}
        inp.click();
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      nodes[k].click();
      return true;
    }
    return false;
  }
  /** 当前选中项的文字（用于确认「真的切过去了」，而不是点完就假设成功） */
  function checkedRadioText(root) {
    var ns = root.querySelectorAll('[class*="radio-button"]');
    for (var k = 0; k < ns.length; k++) {
      var cn = ns[k].className;
      if (cn && String(cn).indexOf('checked') >= 0) return clean(ns[k].textContent);
    }
    return '';
  }
  /**
   * 按 **label 文字**找输入框（.qf-group 里的 label + 同组内的 input）。
   * 位置索引定位在这个弹窗里已经翻过车（见 dashboard() 里的说明），一律改用这个。
   */
  function inputByLabel(root, labelText) {
    var gs = root.querySelectorAll('.qf-group');
    for (var i = 0; i < gs.length; i++) {
      var l = gs[i].querySelector('label');
      if (!l) continue;
      if (clean(l.textContent).indexOf(labelText) < 0) continue;
      var el = gs[i].querySelector('input');
      if (el) return el;
    }
    return null;
  }
  /**
   * 读首页两张工具卡。整卡可点＝「标题链接铺满整卡」的拉伸链接（用户要求：去掉「›」进入符号、
   * 点卡片任意位置都能进全屏页）—— 不看 DOM 结构，用 elementFromPoint 做**真实命中测试**：
   *   · 卡片中部 / 原来挂「›」的右上角 → 命中元素必须落在标题链接上（= 整卡可点）；
   *   · 「记一笔」按钮处 → 必须命中按钮本身（按钮被 z-index 抬在覆盖层之上，点它不会误跳转）。
   */
  async function readCards() {
    var cards = document.querySelectorAll('.tool-card');
    var res = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      c.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(120);
      var link = c.querySelector('.tool-card-title');
      var statEl = c.querySelector('.tool-card-stat');
      var btn = null;
      var bs = c.querySelectorAll('button');
      for (var b = 0; b < bs.length; b++) if (clean(bs[b].textContent) === '记一笔') btn = bs[b];
      var inLink = function (el) { return !!(el && link && (el === link || link.contains(el))); };
      var r = c.getBoundingClientRect();
      var hitMid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      var hitCorner = document.elementFromPoint(Math.max(1, r.right - 8), r.top + 12);
      var hitBtn = null;
      if (btn) { var br = btn.getBoundingClientRect(); hitBtn = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2); }
      res.push({
        title: clean(link ? link.textContent : ''),
        stat: clean(statEl ? statEl.textContent : ''),
        statLive: !!(statEl && statEl.classList && statEl.classList.contains('is-live')),
        enterHref: link ? link.getAttribute('href') : null,
        cardClickable: inLink(hitMid) && inLink(hitCorner),
        btnOnTop: !!(btn && hitBtn && (hitBtn === btn || btn.contains(hitBtn))),
        hasMore: !!c.querySelector('.tool-card-more'),
        buttons: Array.prototype.map.call(c.querySelectorAll('button'), function (b) { return clean(b.textContent); }),
        rectW: c.offsetWidth
      });
    }
    return res;
  }

  async function dashboard() {
    for (var i = 0; i < 60 && document.querySelectorAll('.tool-card').length < 2; i++) await sleep(200);
    out.cards = await readCards();

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
    // 「这一天已记 …」那一行 —— 不先说清已经记了什么，用户填「6」时不知道在盖掉什么
    var exEl = m.querySelector('.qf-existing');
    out.dialog = {
      found: true,
      title: modalTitle(m),
      labels: labels.join(' / '),
      existingText: exEl ? clean(exEl.textContent) : '',
      isQuick: !m.querySelector('.type-selector'),   // 通用大弹窗会带 26 类型的 .type-selector
      hasHint: !!m.querySelector('.form-hint-text'),
      maxWidth: parseInt(getComputedStyle(m).maxWidth, 10)
    };
    // ⚠️ 绝不能再按 ".qf-group input" 的**位置索引**定位输入框：
    //    弹窗结构一变（首页锁日期后日期 input 消失、新增「本次怎么记」的 radio input）
    //    索引就整体错位 —— 实测把「6」填进了「用时」框，次数纹丝不动，探针却报
    //    「保存后数字没跟着变」，看着像产品 bug，其实是探针自己填错了框。
    //    现在一律按 **label 文字**找框。
    var before = (fmCard && fmCard.querySelector('.tool-card-stat')) ? clean(fmCard.querySelector('.tool-card-stat').textContent) : '';
    var countInput = inputByLabel(m, '本次胎动次数');
    var dupInput = inputByLabel(m, '本次用时(分钟)');
    out.dialog.foundCountInput = !!countInput;
    out.dialog.foundDurationInput = !!dupInput;
    if (countInput) setInput(countInput, 6);
    await sleep(200);
    clickByText(m, '保存');
    for (var w = 0; w < 60; w++) { await sleep(200); if (!modalByTitle('胎动')) break; }
    await sleep(600);
    out.beforeSave = { stat: before };
    out.afterSave = { cards: await readCards() };

    // ===== 第二段：再开一次弹窗，切「改为本次值」填 3 ⇒ 卡片应当场变成 3。
    //      默认追加（上一段）与显式覆盖（本段）是两条不同的路径，都得验证：
    //      只测追加 ⇒ 覆盖分支写坏了没人知道；只测覆盖 ⇒ 又回到「第二次记一笔抹掉第一次」的老 bug。
    var btn2 = null;
    var cards2 = document.querySelectorAll('.tool-card');
    for (var c2 = 0; c2 < cards2.length && !btn2; c2++) {
      if (!/胎动/.test(clean(cards2[c2].textContent))) continue;
      var b2s = cards2[c2].querySelectorAll('button');
      for (var b2 = 0; b2 < b2s.length; b2++) if (clean(b2s[b2].textContent) === '记一笔') { btn2 = b2s[b2]; break; }
    }
    if (btn2) {
      btn2.click();
      for (var t2 = 0; t2 < 40 && !modalByTitle('胎动'); t2++) await sleep(150);
      var m2 = modalByTitle('胎动');
      if (m2) {
        out.replaceTried = true;
        // 点到为止不算数 —— 必须**读到选中态真的变了**才继续，否则就是拿时序碰运气
        for (var g = 0; g < 12; g++) {
          clickRadio(m2, '改为本次值');
          await sleep(150);
          if (checkedRadioText(m2) === '改为本次值') break;
        }
        out.modeSwitched = checkedRadioText(m2) === '改为本次值';
        out.modeChecked = checkedRadioText(m2);
        await sleep(300);
        var ci2 = inputByLabel(m2, '本次胎动次数');
        if (ci2) setInput(ci2, 3);
        await sleep(200);
        clickByText(m2, '保存');
        for (var w2 = 0; w2 < 60; w2++) { await sleep(200); if (!modalByTitle('胎动')) break; }
        await sleep(600);
        out.afterReplace = { cards: await readCards() };
      }
    }
  }

  /**
   * 记录页：明细**不再铺在页面上**（用户要求：上面只留主要数据）——
   * 现在点「胎动」「宫缩」条目弹出对应明细框。本段验证：
   *   ① 页面内联的 .session-detail 块已消失；
   *   ② 点条目 → 弹出「胎动明细 / 宫缩明细」，行数与内容对得上（同一天多次会话一条一行）。
   */
  async function recordPage() {
    location.hash = '#/record';
    for (var i = 0; i < 60 && !document.querySelector('.record-list .category-list'); i++) await sleep(250);
    await sleep(800);
    var listReady = !!document.querySelector('.record-list .category-list');
    out.record = {
      found: listReady,
      why: listReady ? '' : '记录页分类列表没渲染出来',
      inlineBlockStillThere: !!document.querySelector('.session-detail'),
      fm: null,
      ct: null
    };
    if (!listReady) return;
    out.record.fm = await openDetailAndRead('胎动');
    out.record.ct = await openDetailAndRead('宫缩');
  }

  /** 找类别行 → 点击 → 等「XX明细」弹窗 → 读行数据（弹窗按标题定位，可叠着多个） */
  async function openDetailAndRead(label) {
    var row = null;
    var items = document.querySelectorAll('.record-list .category-item');
    for (var i = 0; i < items.length; i++) {
      if (clean((items[i].querySelector('.row-label') || {}).textContent) === label) { row = items[i]; break; }
    }
    if (!row) return { open: false, why: '找不到「' + label + '」类别行' };
    (row.querySelector('.category-row') || row).click();
    var want = label + '明细';
    var dlg = null;
    for (var t = 0; t < 40 && !dlg; t++) {
      await sleep(150);
      var ms = visibleModals();
      for (var k = ms.length - 1; k >= 0; k--) {
        if (modalTitle(ms[k]).indexOf(want) >= 0) { dlg = ms[k]; break; }
      }
    }
    if (!dlg) return { open: false, why: '点「' + label + '」条目没弹出明细弹窗' };
    // 标题出来 ≠ 数据回来：等行（或空态）渲染
    for (var w = 0; w < 40; w++) {
      if (dlg.querySelectorAll('.sdd-row').length > 0 || dlg.querySelector('.sdd-empty')) break;
      await sleep(150);
    }
    var rows = Array.prototype.map.call(dlg.querySelectorAll('.sdd-row'), function (r) { return clean(r.textContent); });
    var res = {
      open: true,
      title: modalTitle(dlg),
      summary: clean((dlg.querySelector('.sdd-summary') || {}).textContent),
      rowCount: dlg.querySelectorAll('.sdd-row').length,
      rows: rows
    };
    // 关闭：不断言关得掉（naive-ui 关闭有过渡动画，虚拟时钟下节点晚一步移除）
    var closeBtn = dlg.querySelector('.n-base-close');
    if (closeBtn) closeBtn.click();
    await sleep(300);
    return res;
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

/** 从卡片文案里解析「共 N 次」；只有一次会话时卡片写「今日 N 次」 */
function parseCount(stat) {
  if (!stat) return null;
  let m = /共\s*(\d+)\s*次/.exec(stat);
  if (m) return Number(m[1]);
  m = /今日\s*(\d+)\s*次(?!\s*会话)/.exec(stat);
  return m ? Number(m[1]) : null;
}

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
    if (!fm.enterHref || fm.enterHref.indexOf('fetal-movement-counter') < 0) bad.push('胎动卡进全屏页的链接不对（实际 ' + fm.enterHref + '）');
    if (!fm.cardClickable) bad.push('胎动卡不是整卡可点（卡片中部/右上角命中的不是进入链接）');
    if (fm.hasMore) bad.push('胎动卡还挂着「›」进入符号（用户要求移除，改为整卡可点）');
    if (!fm.btnOnTop) bad.push('胎动卡「记一笔」被整卡链接盖住（点它会误跳全屏页）');
  }
  if (ct) {
    if (!/今日\s*2\s*次/.test(ct.stat)) bad.push('宫缩卡没显示今日次数（实际「' + ct.stat + '」）');
    if (ct.buttons.indexOf('记一笔') < 0) bad.push('宫缩卡缺「记一笔」按钮');
    if (!ct.enterHref || ct.enterHref.indexOf('contraction-timer') < 0) bad.push('宫缩卡进全屏页的链接不对（实际 ' + ct.enterHref + '）');
    if (!ct.cardClickable) bad.push('宫缩卡不是整卡可点（卡片中部/右上角命中的不是进入链接）');
    if (ct.hasMore) bad.push('宫缩卡还挂着「›」进入符号（用户要求移除，改为整卡可点）');
    if (!ct.btnOnTop) bad.push('宫缩卡「记一笔」被整卡链接盖住（点它会误跳全屏页）');
  }

  const d = r.dialog || {};
  if (!d.found) bad.push('点「记一笔」没弹出胎动小弹窗（' + (d.why || '') + '）');
  else {
    if (!/胎动/.test(d.title)) bad.push('弹出的不是胎动弹窗（标题「' + d.title + '」）');
    if (!d.isQuick) bad.push('打开的是通用大弹窗，不是专属小弹窗');
    // ⚠️ 断言**关键字段在不在**，不要逐字比对整串 label：
    //    首页锁日期（日期行换成静态文字）、且新增「本次怎么记」单选后，
    //    整串比对会随任何一次文案微调而假红。
    ['本次胎动次数', '本次用时', '本次怎么记', '当天备注'].forEach(function (need) {
      if (d.labels.indexOf(need) < 0) bad.push('弹窗缺字段「' + need + '」（实际 ' + d.labels + '）');
    });
    if (d.labels.indexOf('日期') >= 0) bad.push('首页「记一笔」不该再露出日期选择器（首页只显示今天，改日期看不到反馈）：' + d.labels);
    if (!d.foundCountInput) bad.push('按 label 找不到「本次胎动次数」输入框（定位方式又双叒失效了）');
    if (!d.foundDurationInput) bad.push('按 label 找不到「本次用时(分钟)」输入框');
    if (d.existingText.indexOf('共') >= 0 && d.existingText.indexOf('次') < 0) bad.push('「这一天已记」那行文案不对（' + d.existingText + '）');
    if (!d.hasHint) bad.push('弹窗缺就医提示文案');
    if (!(d.maxWidth >= 400 && d.maxWidth <= 440)) bad.push('弹窗 max-width ' + d.maxWidth + ' 不在小弹窗档位 400~440');
  }

  // ===== 保存后卡片数字要当场跟着变 —— 两种模式分别验证 =====
  // 语义（2026-10-01 定稿）：默认**追加**（一天分几次数，第二次不该抹掉第一次），
  // 另有「改为本次值」用于修正。两种都得有渲染级证据，只测一种等于没测。
  const after = (r.afterSave && r.afterSave.cards) || [];
  const afm = after.filter((c) => /胎动/.test(c.title))[0];
  const beforeCount = parseCount((r.beforeSave || {}).stat);
  const afterCount = afm ? parseCount(afm.stat) : null;
  if (!d.found) bad.push('（跳过）保存后数字未核对');
  else if (!afm) bad.push('保存后找不到胎动卡');
  else if (beforeCount == null || afterCount == null) {
    bad.push('解析不出保存前后的次数（前「' + (r.beforeSave || {}).stat + '」后「' + afm.stat + '」）');
  } else if (afterCount !== beforeCount + 6) {
    bad.push('默认「追加」没生效：' + beforeCount + ' + 6 应得 ' + (beforeCount + 6) + '，卡片实际「' + afm.stat + '」');
  }

  const after2 = (r.afterReplace && r.afterReplace.cards) || [];
  const afm2 = after2.filter((c) => /胎动/.test(c.title))[0];
  if (!r.replaceTried) bad.push('（跳过）「改为本次值」未核对');
  else if (!r.modeSwitched) bad.push('「改为本次值」点完选中态仍是「' + (r.modeChecked || '(空)') + '」（n-radio-button 不是 button，别用 clickByText）');
  else if (!afm2) bad.push('第二次保存后找不到胎动卡');
  else if (parseCount(afm2.stat) !== 3) {
    bad.push('切「改为本次值」后没用本次值覆盖：填 3 应得 3，卡片实际「' + afm2.stat + '」');
  }

  const rec = r.record || {};
  if (!rec.found) bad.push('记录页没打开（' + (rec.why || '') + '）');
  else {
    if (rec.inlineBlockStillThere) bad.push('记录页顶部还留着内联的「今天每次的记录」块（用户要求改为点条目弹窗看明细）');
    const fmD = rec.fm || {};
    if (!fmD.open) bad.push('点「胎动」条目没弹出明细弹窗（' + (fmD.why || '') + '）');
    else {
      if (fmD.rowCount !== 2) bad.push('胎动明细行数应为 2，实际 ' + fmD.rowCount);
      const fmTxt = (fmD.rows || []).join(' | ');
      if (!/2 次/.test(fmTxt)) bad.push('胎动明细缺「2 次」（' + fmTxt + '）');
      if (!/共\s*2\s*次会话/.test(fmD.summary || '')) bad.push('胎动明细缺会话数摘要（' + fmD.summary + '）');
    }
    const ctD = rec.ct || {};
    if (!ctD.open) bad.push('点「宫缩」条目没弹出明细弹窗（' + (ctD.why || '') + '）');
    else {
      if (ctD.rowCount !== 1) bad.push('宫缩明细行数应为 1，实际 ' + ctD.rowCount);
      const ctTxt = (ctD.rows || []).join(' | ');
      if (!/2 条/.test(ctTxt)) bad.push('宫缩明细缺「2 条」（' + ctTxt + '）');
      if (!/50 秒/.test(ctTxt)) bad.push('宫缩明细缺「50 秒/次」（' + ctTxt + '）');
      if (!/3\.2/.test(ctTxt)) bad.push('宫缩明细缺间隔 3.2 分钟（' + ctTxt + '）');
      if (!/共\s*1\s*次会话/.test(ctD.summary || '')) bad.push('宫缩明细缺会话数摘要（' + ctD.summary + '）');
    }
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
  (r.cards || []).forEach((c) => console.log(`  ${c.title}｜${c.stat}｜按钮[${(c.buttons || []).join(',')}]｜整卡可点=${c.cardClickable}｜按钮可点=${c.btnOnTop}｜进入链接=${c.enterHref}`));
  console.log('\n【点「记一笔」弹出的弹窗】');
  console.log('  ' + JSON.stringify(r.dialog));
  console.log('\n【保存后卡片（期望「今日 6 次」）】');
  (r.afterSave && r.afterSave.cards || []).forEach((c) => console.log(`  ${c.title}｜${c.stat}`));
  console.log('\n【记录页：内联明细块已移除 / 点条目弹明细】');
  if (r.record && r.record.found) {
    console.log('  顶部内联「今天每次的记录」还在？' + (r.record.inlineBlockStillThere ? '是（应为否）' : '否'));
    [['胎动', r.record.fm], ['宫缩', r.record.ct]].forEach(([label, d]) => {
      d = d || {};
      console.log(`  ${label}：${d.open ? '弹窗已开｜' + d.title + '｜' + d.summary : '未打开（' + (d.why || '') + '）'}`);
      (d.rows || []).forEach((x) => console.log('    ' + x));
    });
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
