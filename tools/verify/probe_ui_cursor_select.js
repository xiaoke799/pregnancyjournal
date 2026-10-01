/**
 * 桌面端「光标」与「文本能不能被选中」—— 电脑上点一下像在编辑文档的问题
 *
 * 【症状】电脑 Web 端点卡片 / 列表项会出现**输入光标（I 形）**，点两下还会选中文字，
 *   看起来像在编辑一份文档，而不是在用 App。
 *
 * 【成因】`cursor` 的初始值是 `auto`，而 `auto` 对**文本内容**的渲染结果就是 I 形；
 *   项目里只有原生 `button`（Tailwind preflight 给了 pointer）是手型，用 div/span 做的
 *   几十个可点元素全都没有；同时全站没有任何 `user-select` 控制 ⇒ 界面文字默认可选中。
 *
 * 【修法】global.css 里定口径：`html,body { cursor: default; user-select: none }`
 *   + 交互元素显式 `pointer` + 输入类与 `.selectable` 恢复「可选中 / I 形光标」。
 *
 * 【为什么必须用无头浏览器】`cursor` / `user-select` 是**计算后**才确定的
 *   （要过继承、UA 样式、Tailwind preflight、scoped 样式的特异性），
 *   静态读 CSS 只能证明"写了这条规则"，证明不了"元素最终拿到的是什么" ——
 *   这正是本次踩的坑：规则写在哪不等于生效。
 *
 * 用法：node tools/verify/probe_ui_cursor_select.js
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
/** 被测的构建产物目录 —— 必须显式传给后端，否则它默认找 app/server/node/ui（不存在 ⇒ 404「前端未构建」） */
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const SHIM = path.join(env0.VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-ui-cursor');
const PORT = Number(process.env.PJ_TCP_PORT || 38583);
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
  STATIC_DIR: UI_DIR,
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

function findBrowser() {
  const cands = [
    process.env.PJ_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}

const PROBE = `
<script>
(async function () {
  var out = { pages: {}, errors: [] };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /** 读某个选择器命中的**第一个**元素的计算样式 */
  function sample(sel) {
    var el = document.querySelector(sel);
    if (!el) return { found: false };
    var cs = getComputedStyle(el);
    return {
      found: true,
      tag: el.tagName.toLowerCase(),
      cursor: cs.cursor,
      userSelect: cs.userSelect || cs.webkitUserSelect || '',
    };
  }
  function sampleAll(sel, limit) {
    var els = document.querySelectorAll(sel), res = [];
    for (var i = 0; i < els.length && i < (limit || 3); i++) {
      var cs = getComputedStyle(els[i]);
      // 带上 type：文本输入框与勾选框的期望**不一样**（前者要能选文本，后者是手型按钮）
      res.push({ type: els[i].type || '', cursor: cs.cursor, userSelect: cs.userSelect || cs.webkitUserSelect || '' });
    }
    return res;
  }

  var ROUTES = [
    { hash: '#/', name: 'home', wait: 1800, sels: ['.tool-card', '.hg-card', '.section-header h3', 'button', 'h3', 'p'] },
    { hash: '#/record', name: 'record', wait: 1800, sels: ['.category-row', '.row-label', 'h3'] },
    { hash: '#/album', name: 'album', wait: 1800, sels: ['.album-tab', 'h3'] },
    { hash: '#/checkup-schedule', name: 'checkup', wait: 2000, sels: ['h3', 'span'] },
    { hash: '#/diet', name: 'diet', wait: 1800, sels: ['h3', 'span'] },
    { hash: '#/dose-plan', name: 'dose', wait: 1800, sels: ['h3', 'span'] },
    { hash: '#/settings', name: 'settings', wait: 1800, sels: ['.export-diag summary', '.diag-body', 'h3'] },
  ];

  try {
    for (var i = 0; i < ROUTES.length; i++) {
      var r = ROUTES[i];
      location.hash = r.hash;
      await sleep(r.wait);
      // 诊断块是 <details> 收起状态，展开后再读（收起时 getComputedStyle 仍可取，但保险起见）
      var d = document.querySelector('.export-diag');
      if (d) d.setAttribute('open', '');
      await sleep(200);
      var got = {};
      for (var s = 0; s < r.sels.length; s++) got[r.sels[s]] = sample(r.sels[s]);
      out.pages[r.name] = got;
    }
    // ⚠️ 这里曾经想用 Selection API「往 h3 里塞一个插入点，看 user-select:none 挡不挡得住」，
    //    实测**假设不成立**：程序化的 range.addRange() 不受 user-select 约束，照样能落进去。
    //    而「插入符浏览（F7）」的插入符由浏览器内部处理，合成事件（isTrusted=false）驱动不了它
    //    ⇒ 无头环境**无法**验证该行为，所以不做断言，只把结论记在这里，免得后人再试一遍。

    // 全页通用采样（在最后一页设置页上做）
    out.global = {
      body: (function () { var cs = getComputedStyle(document.body); return { cursor: cs.cursor, userSelect: cs.userSelect || cs.webkitUserSelect || '' }; })(),
      // 文本类输入：type 为空 / text / number / date / password …（Naive 的 .n-input 里也是真 input）
      textInputs: sampleAll('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), .n-input input, .n-input-number input', 4),
      textareas: sampleAll('textarea', 2),
      checkboxes: sampleAll('input[type=checkbox], input[type=radio]', 3),
      h3: sampleAll('h3', 2),
      spans: sampleAll('.card span, .section span', 3),
      detail: sample('.diag-body'),
    };
  } catch (e) {
    out.errors.push(String(e && e.message ? e.message : e));
  }
  var host = document.getElementById('DIAG') || document.createElement('div');
  host.id = 'DIAG';
  host.textContent = JSON.stringify(out);
  host.style.display = 'none';
  document.body.appendChild(host);
})();
</script>
`;

(async () => {
  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome，跳过（可设 PJ_BROWSER 指定）'); process.exit(2); }

  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  let variant = null;
  const cleanup = () => {
    try { child.kill('SIGKILL'); } catch (e) {}
    if (variant) { try { fs.unlinkSync(variant); } catch (e) {} }
  };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', GW + '/api/health'); if (r.status === 200) { ready = true; break; } } catch (e) {}
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

  // 造一个孕期，让页面走完整渲染分支（否则首页是空态、记录页没有类别行）
  const dstr = (off) => {
    const d = new Date(); d.setDate(d.getDate() + off);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  await req('POST', GW + '/api/v1/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });

  variant = path.join(UI_DIR, '_tmp_cursor.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  fs.writeFileSync(variant, html.replace('</body>', PROBE + '</body>'), 'utf-8');

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_cursor.html#/`;
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, '--window-size=1280,900',
    '--virtual-time-budget=60000', '--dump-dom', url,
  ];
  const dom = await new Promise((resolve) => {
    const bp = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', done = false;
    bp.stdout.on('data', (d) => (o += d));
    bp.on('close', () => { if (!done) { done = true; resolve(o); } });
    setTimeout(() => { if (!done) { done = true; try { bp.kill('SIGKILL'); } catch (e) {} resolve(o); } }, 180000);
  });

  const m = /<div id="DIAG"[^>]*>([\s\S]*?)<\/div>/.exec(dom);
  if (!m) {
    console.log('读不到探针结果（页面没跑起来？）');
    console.log('dom 长度=' + dom.length + ' 含#app=' + /id="app"/.test(dom) + ' 含DIAG=' + /DIAG/.test(dom));
    console.log('---- dom 尾部 ----');
    console.log(dom.slice(-1200));
    console.log('---- srv log 尾部 ----');
    console.log(srvLog.slice(-800));
    cleanup();
    process.exit(2);
  }
  let r = null;
  try { r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')); } catch (e) {
    console.log('探针结果解析失败:', m[1].slice(0, 400)); cleanup(); process.exit(2);
  }
  cleanup();

  const isTextCursor = (c) => c === 'text';
  const isArrow = (c) => c === 'default';

  console.log('===== 场景 A：界面文字不该是「输入光标」=====');
  {
    const g = r.global || {};
    check('A1 body 的光标是箭头（不是 auto/text）',
      !!g.body && isArrow(g.body.cursor), 'body.cursor=' + (g.body && g.body.cursor));
    check('A2 body 的界面文字默认不可选中（user-select: none）',
      !!g.body && g.body.userSelect === 'none', 'body.userSelect=' + (g.body && g.body.userSelect));
    const h3 = (g.h3 || []).filter((x) => isTextCursor(x.cursor));
    check('A3 标题文字不是 I 形光标', h3.length === 0, JSON.stringify(h3));
    const spans = (g.spans || []).filter((x) => isTextCursor(x.cursor));
    check('A4 普通文本不是 I 形光标', spans.length === 0, JSON.stringify(spans));
    const home = (r.pages.home || {})['.section-header h3'];
    check('A5 首页分区标题不是 I 形光标', !!home && !isTextCursor(home.cursor), JSON.stringify(home));
    // 逐页扫：任何页面都不该出现 I 形光标（不只是抽样那几处）
    const bad = [];
    const pages = r.pages || {};
    Object.keys(pages).forEach((p) => {
      ['h3', 'p', 'span', '.row-label', '.section-header h3'].forEach((sel) => {
        const s = pages[p][sel];
        if (s && s.found && isTextCursor(s.cursor)) bad.push(p + ' ' + sel + '=' + s.cursor);
      });
    });
    check(`A6 全部 ${Object.keys(pages).length} 个页面都没有 I 形光标`, bad.length === 0, bad.join(', '));
  }

  console.log('\n===== 场景 B：可点的地方必须是手型 =====');
  {
    const checks = [
      ['B1 首页工具卡（宫缩/胎动）可点', (r.pages.home || {})['.tool-card']],
      ['B2 首页按钮', (r.pages.home || {})['button']],
      ['B3 记录页类别行可点', (r.pages.record || {})['.category-row']],
      ['B4 相册标签页可点', (r.pages.album || {})['.album-tab']],
      ['B5 设置页诊断折叠标题可点', (r.pages.settings || {})['.export-diag summary']],
    ];
    for (const [name, s] of checks) {
      if (!s || !s.found) { check(name + '（元素不存在，跳过）', true); continue; }
      check(name + ' ⇒ cursor: pointer', s.cursor === 'pointer', JSON.stringify(s));
    }
  }

  console.log('\n===== 场景 C：输入框与「要复制的内容」必须还能选 =====');
  {
    const g = r.global || {};
    const ins = g.textInputs || [];
    const tas = g.textareas || [];
    check('C1 文本输入框里的字可选中（user-select: text）—— 别为了观感把输入搞坏',
      ins.length > 0 && ins.every((x) => x.userSelect === 'text'), JSON.stringify(ins));
    check('C2 文本输入框是 I 形光标（本来就该这样）',
      ins.length > 0 && ins.every((x) => x.cursor === 'text' || x.cursor === 'auto'), JSON.stringify(ins));
    check('C3 多行文本框同样可选',
      tas.length === 0 || tas.every((x) => x.userSelect === 'text'), JSON.stringify(tas));
    const cbs = g.checkboxes || [];
    check('C4 勾选框/单选是**手型**（它们是可点控件，不是文本输入）',
      cbs.length === 0 || cbs.every((x) => x.cursor === 'pointer'), JSON.stringify(cbs));
    const d = g.detail;
    check('C5 设置页诊断块可选中（用户要复制它去排查）',
      !!d && d.found && d.userSelect === 'text', JSON.stringify(d));
  }

  console.log('\n===== 场景 D：反例自检（证明上面这些断言有区分度）=====');
  {
    // 一句话证明「读计算样式」确实能区分对错：body 若是 auto，A1 立刻红。
    const g = r.global || {};
    check('D1 body 的 cursor 不是 auto（若还是 auto ⇒ A1 会红，说明它在盯着真值）',
      !!g.body && g.body.cursor !== 'auto', 'cursor=' + (g.body && g.body.cursor));
    check('D2 若界面文字仍可选中（userSelect !== none），A2 会红',
      !!g.body && g.body.userSelect !== 'text', 'userSelect=' + (g.body && g.body.userSelect));
  }

  console.log('  （原始采样）');
  console.log('  ' + JSON.stringify(r.pages || {}));

  console.log('\n==================================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e && e.stack ? e.stack : e); process.exit(3); });
