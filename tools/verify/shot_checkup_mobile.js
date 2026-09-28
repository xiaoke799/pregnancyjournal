/**
 * 截「产检页」手机形态的真实渲染 + 用探针量真实尺寸。
 *
 * 为什么这样做：
 *   - Edge/Chrome 无头窗口宽度有下限（约 504px），传 390 会被渲染成 504 再裁掉右边 →
 *     会误判成"横向溢出"。所以按 504 截，另外用 CSS 把【卡片本身】限宽到 360px，
 *     这样就复现了手机窄屏卡片内部的真实布局。
 *   - 不肉眼看缩略图估尺寸：探针读 getBoundingClientRect / scrollWidth 出数值。
 *
 * 用法：node shot_checkup_mobile.js <标签>     e.g. before / after
 * 产物：tools/verify/.tmp/checkup-shot/<标签>.png 与 <标签>.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LABEL = process.argv[2] || 'shot';
/** 第二个参数传 desktop 则按桌面宽度截图（用于确认改动没影响桌面布局） */
const DESKTOP = process.argv[3] === 'desktop' || process.env.PJ_SHOT_DESKTOP === '1';
const WIN_W = DESKTOP ? 1200 : 504;
const WIN_H = Number(process.env.PJ_SHOT_H || 1800);
const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-shot');
const OUT = path.join(require('./_env').TMP, 'checkup-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38484);
const GW = '/app/pregnancyjournal';
/** 前端产物目录：默认 app/ui。设 PJ_UI_DIR 可指向验证用的临时构建产物，
 *  避免为了截图而覆盖共享的 app/ui（多会话并行时尤其重要）。 */
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const env = {
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

function req(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dstr = (offsetDays) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
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
<style id="__probe_style">
/* Edge 无头窗口宽度有下限(504)，这里把卡片本身限宽到「390px 手机」的真实内容宽，
   用来截图肉眼复核。不加 !important，好让下面的探针用内联样式临时改宽测量。 */
@media (max-width: 768px) { .checkup-card { max-width: 326px; } }
</style>
<script>
(function () {
  // 手机形态：按常见屏宽逐个模拟卡片宽度；桌面形态：WIDTHS 为空，只量一次当前布局
  var WIDTHS = __WIDTHS__;
  var FIXED_VP = __FIXED_VP__;
  var KEEP_REVERT = __KEEP_REVERT__;   // true = 截图时保持"旧写法"，用来出修复前的对照图
  var EXPAND = __EXPAND__;             // true = 截图前把所有卡片的「检查内容」展开（看分类标签）

  function measureAt(card, vp) {
    var inp = card.querySelector('.date-input-small');
    var row = card.querySelector('.card-right');
    var o = {};
    o.vp = vp;
    o.cardW = Math.round(card.getBoundingClientRect().width);
    o.rowWrap = getComputedStyle(row).flexWrap;
    o.rowOverflow = row.scrollWidth - row.clientWidth;
    if (!inp) { o.inpW = 'none'; return o; }
    var r = inp.getBoundingClientRect();
    o.inpW = Math.round(r.width);
    o.inpFontSize = getComputedStyle(inp).fontSize;
    // 用 field-sizing:content 量出「原生日期控件放下 yyyy/mm/dd + 日历图标」真正需要的宽度。
    // 一律用 !important 覆盖，否则会继承页面上的 width/min-width 约束，量出来是"当前宽度"而不是"需要宽度"。
    var ref = inp.cloneNode(true);
    ref.style.setProperty('position', 'absolute', 'important');
    ref.style.setProperty('visibility', 'hidden', 'important');
    ref.style.setProperty('width', 'auto', 'important');
    ref.style.setProperty('min-width', '0', 'important');
    ref.style.setProperty('max-width', 'none', 'important');
    ref.style.setProperty('flex', 'none', 'important');
    ref.style.setProperty('order', '0', 'important');
    ref.style.setProperty('field-sizing', 'content', 'important');
    card.appendChild(ref);
    o.needW = Math.round(ref.getBoundingClientRect().width);
    ref.remove();
    o.fits = o.inpW >= o.needW - 1;
    o.inpOverflowRight = Math.round(r.right - card.getBoundingClientRect().right);
    o.tagInRight = !!row.querySelector('.expected-date-tag');
    o.dupTagDisplay = o.tagInRight ? 'visible' : 'none-el';
    return o;
  }

  function offenders() {
    var vw = document.documentElement.clientWidth;
    var all = document.querySelectorAll('body *');
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > vw + 1) {
        var el = all[i];
        var cls = String(el.getAttribute('class') || '').split(' ')[0];
        hits.push((el.tagName + (cls ? '.' + cls : '')).slice(0, 44) + ' right=' + Math.round(r.right));
      }
      if (hits.length >= 4) break;
    }
    return hits.join(' | ') || 'none';
  }

  /** 在「修复后」与「撤掉修复」两种 CSS 下，量同一个指标，作为同口径对照 */
  function measureAll(prefix) {
    var card = document.querySelectorAll('.checkup-card')[0];
    var old = card.style.maxWidth;
    if (!WIDTHS.length) {
      var o0 = measureAt(card, FIXED_VP);       // 桌面：不改宽度，直接量
      var kv0 = [];
      for (var k0 in o0) kv0.push(prefix + k0 + '=' + o0[k0]);
      SK.push(kv0.join(','));
      return;
    }
    for (var i = 0; i < WIDTHS.length; i++) {
      var w = WIDTHS[i];
      card.style.maxWidth = (w - 64) + 'px';
      void card.offsetWidth;             // 强制重排
      var o = measureAt(card, w);
      var kv = [];
      for (var k in o) kv.push(prefix + k + '=' + o[k]);
      SK.push(kv.join(','));
    }
    card.style.maxWidth = old;
  }

  var SK = [];

  function measure() {
    var cards = document.querySelectorAll('.checkup-card');
    var host = document.getElementById('DIAG') || document.createElement('div');
    host.id = 'DIAG';
    var out = [];
    out.push('cards=' + cards.length);
    out.push('bodyScrollW=' + document.body.scrollWidth);
    out.push('overflowWidest=' + offenders());
    // 结构断言：预计日期标签在一张卡里只能有一个；已完成卡片要有「取消完成」入口
    var maxTags = 0;
    for (var ci = 0; ci < cards.length; ci++) {
      var n = cards[ci].querySelectorAll('.expected-date-tag').length;
      if (n > maxTags) maxTags = n;
    }
    var cancelBtns = 0, markBtns = 0, btns = document.querySelectorAll('.card-footer button');
    for (var bi = 0; bi < btns.length; bi++) {
      var t = btns[bi].textContent;
      if (t.indexOf('取消完成') !== -1) cancelBtns++;
      if (t.indexOf('标记完成') !== -1) markBtns++;
    }
    out.push('expectTagsMaxPerCard=' + maxTags);
    out.push('doneCards=' + document.querySelectorAll('.checkup-card.is-completed').length);
    out.push('cancelBtns=' + cancelBtns);
    out.push('markBtns=' + markBtns);
    if (cards.length) {
      SK = [];
      measureAll('fx_');                 // 修复后
      applyRevert(true);
      measureAll('rv_');                 // 撤掉修复（旧行为）
      applyRevert(false);
      out = out.concat(SK);
      out.push('bodyScrollW_reverted=' + document.body.scrollWidth);
      if (KEEP_REVERT) applyRevert(true);   // 截图用：保持旧写法
    }
    host.textContent = out.join(' ;; ');
    // 隐藏掉：长文本不换行会撑大 body.scrollWidth，污染探针读数、也可能给截图加横向滚动条
    host.style.display = 'none';
    document.body.appendChild(host);
  }

  /** 用 !important 压过 scoped 样式（scoped 选择器带 [data-v-xxx]，特异性更高），
      把本次改动"撤回"成旧写法，用于同口径对照。 */
  function applyRevert(on) {
    var el = document.getElementById('__revert');
    if (on && !el) {
      el = document.createElement('style');
      el.id = '__revert';
      el.textContent = '@media(max-width:768px){.card-right{flex-wrap:nowrap !important;row-gap:0 !important}' +
        '.date-input-small{order:0 !important;flex:0 0 auto !important;width:100px !important;min-width:100px !important;padding:4px 8px !important}' +
        '.card-right .n-tag{margin-left:0 !important}}';
      document.head.appendChild(el);
    } else if (!on && el) {
      el.remove();
    }
    void document.body.offsetWidth;
  }

  // 展开所有卡片的「检查内容」——子项默认折叠，不展开就看不到分类标签（.sub-item-cat-tag）。
  // 等 toggle 数量稳定两拍再点，避免首屏只渲染出前几张卡时漏点；
  // 只点一次（再点一次会折叠回去）。
  if (EXPAND) {
    var lastN = -1, stable = 0, clicked = false, ticks = 0;
    var et = setInterval(function () {
      if (clicked || ticks++ > 30) { clearInterval(et); return; }
      var tg = document.querySelectorAll('.sub-items-toggle');
      if (tg.length > 0 && tg.length === lastN) stable++; else stable = 0;
      lastN = tg.length;
      if (stable >= 2) {
        clicked = true; clearInterval(et);
        for (var ei = 0; ei < tg.length; ei++) tg[ei].click();
      }
    }, 250);
  }

  setTimeout(measure, 4500);
  setTimeout(measure, 7500);
})();
</script>
`;

(async () => {
  const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', '/api/v1/health'); if (r.status === 200) { ready = true; break; } } catch (e) { /* not up */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  // ---- 造数据：让卡片右半区元素齐全（预计日期 + 完成日期输入框 + 必检 + ✅）----
  const body = JSON.stringify;
  const H = { 'Content-Type': 'application/json' };
  const p1 = await req('POST', GW + '/api/v1/pregnancies', {
    headers: H, body: body({ last_period_date: dstr(-140), due_date: dstr(140) }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) { const pa = await req('GET', GW + '/api/v1/pregnancies/active'); pid = pa.json && pa.json.data && pa.json.data.id; }
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p1.json)); cleanup(); process.exit(2); }

  // 已完成一条（cs_002 NT）→ 出现 ✅ 与完成日期
  await req('PUT', `${GW}/api/v1/checkup-schedule/cs_002/complete?pregnancy_id=${encodeURIComponent(pid)}`);
  // 手填一条完成日期
  await req('POST', GW + '/api/v1/checkup-schedule/schedule-date', {
    headers: H, body: body({ pregnancy_id: pid, schedule_id: 'cs_004', date: dstr(-3) }),
  });
  // 加一条自定义
  await req('POST', GW + '/api/v1/checkups/custom', {
    headers: H, body: body({ pregnancy_id: pid, name: '建档立卡', checkup_date: dstr(10), notes: '' }),
  });

  // ---- 生成变体 HTML（注入探针 + 卡片限宽），放在静态根内，用完删 ----
  const staticDir = UI_DIR;
  const variant = path.join(staticDir, '_tmp_shot.html');
  const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
  const probeJs = PROBE
    .replace('__WIDTHS__', DESKTOP ? '[]' : '[390, 360, 320]')
    .replace('__FIXED_VP__', DESKTOP ? String(WIN_W) : '0')
    .replace('__KEEP_REVERT__', process.env.PJ_SHOT_REVERT === '1' ? 'true' : 'false')
    .replace('__EXPAND__', process.env.PJ_SHOT_EXPAND === '1' ? 'true' : 'false');
  fs.writeFileSync(variant, html.replace('</body>', probeJs + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); fs.unlinkSync(variant); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_shot.html#/checkup-schedule`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--window-size=${WIN_W},${WIN_H}`,
    '--virtual-time-budget=15000',
  ];

  const run = (args) => new Promise((resolve) => {
    const p = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });

  try {
    // 1) 探针：拿结构化数值
    const dom = await run([...common, '--dump-dom', url]);
    const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    const diagRaw = m ? m[1] : '';
    const summary = {};
    const byWidth = [];
    const byWidthReverted = [];
    let section = null;
    diagRaw.split(';;').forEach((chunk) => {
      const kv = {};
      chunk.split(',').forEach((pair) => {
        const i = pair.indexOf('=');
        if (i <= 0) return;
        const key = pair.slice(0, i).trim();
        if (key.indexOf('fx_') === 0) { section = 'fx'; kv[key.slice(3)] = pair.slice(i + 1).trim(); }
        else if (key.indexOf('rv_') === 0) { section = 'rv'; kv[key.slice(3)] = pair.slice(i + 1).trim(); }
        else kv[key] = pair.slice(i + 1).trim();
      });
      if (kv.cardW !== undefined || kv.inpW !== undefined) {
        if (section === 'rv') byWidthReverted.push(kv); else byWidth.push(kv);
      } else {
        Object.assign(summary, kv);
      }
    });
    const diag = { ...summary, byWidth, byWidthReverted };
    fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(diag, null, 2), 'utf-8');

    // 2) 截图
    fs.rmSync(profile, { recursive: true, force: true });
    await run([...common, `--screenshot=${path.join(OUT, LABEL + '.png')}`, url]);

    console.log(`[${LABEL}] 探针结果:`);
    console.log(JSON.stringify(diag, null, 2));
    console.log(`[${LABEL}] 截图: ${path.join(OUT, LABEL + '.png')}`);
  } finally {
    try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }
    cleanup();
  }
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
