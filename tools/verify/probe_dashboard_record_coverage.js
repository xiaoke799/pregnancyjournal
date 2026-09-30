/**
 * 首页 ↔ 记录页「覆盖度」审计探针（无头浏览器，真实渲染取证）
 *
 * 【为什么需要它】用户提出「全面检查首页各个功能和记录页功能关联问题」。
 * 光读代码容易得出"看起来接上了"的结论，所以这里用真实数据把首页渲染出来，
 * 逐条回答三个只有渲染才能回答的问题：
 *   ① 今天**只记了非健康类**（饮水 / 运动 / 便便…）时，首页「今日记录」板块会显示成什么样？
 *      （模板条件是 `Object.keys(todayRecord).length > 1`，只要有任意一列就会走"有内容"分支，
 *        但宫格里只有 9 个健康指标 ⇒ 可能渲染出一个**空板块**，而空态 CTA 反而不显示）
 *   ② 首页到底能看见记录页的哪几类？差集有几类？
 *   ③ 首页有没有「今日运动」这类展示（记录页与统计页都有运动数据）
 *
 * 用法：node probe_dashboard_record_coverage.js [标签]
 * 产物：tools/verify/.tmp/dashcover/<标签>.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env = require('./_env');
const LABEL = process.argv[2] || 'dashcover';
const ROOT = env.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const OUT = path.join(env.TMP, 'dashcover');
const PORT = Number(process.env.PJ_TCP_PORT || 38563);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const WIN_W = 520;
const WIN_H = 1400;

function prepareTmpDir() {
  const base = path.join(os.tmpdir(), 'pj-dashcover');
  try { fs.rmSync(base, { recursive: true, force: true }); return base; }
  catch (e) { return `${base}-${process.pid}-${Date.now()}`; }
}
const T = prepareTmpDir();
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/**
 * 清掉上次被中断留下的临时 html。
 * ⚠️ 这些文件写在 `app/ui/` 里（要被静态服务托管），**必须自己擦干净**：
 *   它们引用的旧 hash chunk 会让 `verify_ui_orphans.js` 把孤儿算成"可达"（检查静默失效），
 *   而且会随 fpk 一起发出去。Windows 上刚写完的文件偶尔被占用删不掉，所以进出各擦一次。
 */
function cleanStaleVariants(quiet) {
  let left = [];
  try {
    for (const f of fs.readdirSync(UI_DIR)) {
      if (!f.startsWith('_tmp_dashcover_') || !f.endsWith('.html')) continue;
      try { fs.unlinkSync(path.join(UI_DIR, f)); } catch (e) { left.push(f); }
    }
  } catch (e) { /* UI_DIR 不存在 */ }
  if (left.length && !quiet) console.log('⚠️ 有临时 html 删不掉（被占用？）：' + left.join('、'));
  return left;
}
cleanStaleVariants(true);

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

/** 页面内探针：先 dump 首页，再切到记录页 dump 类别清单（一次浏览器启动拿两份数据） */
const PROBE = `
<script>
(function () {
  var out = { label: '__LABEL__', home: null, record: null, recordDate: null, errors: [] };
  var RECORD_ONLY = __RECORD_ONLY__;
  window.addEventListener('error', function (e) { out.errors.push(String(e.message || e)); });
  function clean(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function vis(el) { return !!el && el.offsetWidth > 2 && el.offsetHeight > 2; }

  function dumpHome() {
    var view = document.querySelector('.dashboard-view');
    var secs = view ? view.querySelectorAll('.section') : [];
    var sections = [];
    for (var i = 0; i < secs.length; i++) {
      var h = secs[i].querySelector('h3');
      var name = clean(h ? h.textContent : '');
      if (!name) continue;
      sections.push({
        name: name,
        hgCards: secs[i].querySelectorAll('.hg-card').length,
        planItems: secs[i].querySelectorAll('.plan-item').length,
        textLen: clean(secs[i].textContent).length,
        rectH: Math.round(secs[i].getBoundingClientRect().height)
      });
    }
    var toolCards = [];
    var tcs = view ? view.querySelectorAll('.tool-card') : [];
    for (var t = 0; t < tcs.length; t++) {
      toolCards.push({
        title: clean((tcs[t].querySelector('.tool-card-title') || {}).textContent),
        stat: clean((tcs[t].querySelector('.tool-card-stat') || {}).textContent)
      });
    }
    var sec = document.querySelector('.record-section');
    var content = sec ? sec.querySelector('.record-content') : null;
    var empty = sec ? sec.querySelector('.empty-record') : null;
    var labels = [];
    if (sec) {
      var ls = sec.querySelectorAll('.hg-card .hg-label');
      for (var k = 0; k < ls.length; k++) labels.push(clean(ls[k].textContent));
    }
    // 「有记录但无健康指标」时的兜底块（.other-recorded 里的类别 chip）
    var other = sec ? sec.querySelector('.other-recorded') : null;
    var chips = [];
    if (other) {
      var cs = other.querySelectorAll('.or-chip');
      for (var q = 0; q < cs.length; q++) chips.push(clean(cs[q].textContent));
    }
    return {
      hasDashboard: !!view,
      sections: sections,
      toolCards: toolCards,
      recordLink: sec ? clean((sec.querySelector('.view-all') || {}).textContent) : null,
      gridCards: labels,
      gridChildren: content ? content.children.length : -1,
      gridH: content ? content.offsetHeight : null,
      emptyCtaShown: vis(empty),
      emptyCtaText: empty ? clean(empty.textContent) : '',
      otherChips: chips,
      otherH: other ? other.offsetHeight : null
    };
  }

  function dumpRecord() {
    var items = document.querySelectorAll('.record-list .category-item');
    var cats = [], withData = [];
    for (var i = 0; i < items.length; i++) {
      var lbl = clean((items[i].querySelector('.row-label') || {}).textContent);
      if (!lbl) continue;
      cats.push(lbl);
      if (items[i].classList.contains('has-data')) withData.push(lbl);
    }
    var heads = [];
    var hs = document.querySelectorAll('.session-detail .sd-title, .session-detail h4');
    for (var j = 0; j < hs.length; j++) heads.push(clean(hs[j].textContent));
    return { categories: cats, hasData: withData, sessionHeads: heads };
  }

  (async function () {
    var host;
    // 只验记录页：直接等记录页渲染完，读它标题上的日期 + 类别清单
    if (RECORD_ONLY) {
      for (var w0 = 0; w0 < 60; w0++) { await sleep(250); if (document.querySelector('.date-title')) break; }
      await sleep(1200);
      out.recordDate = clean((document.querySelector('.date-title') || {}).textContent);
      out.record = dumpRecord();
      host = document.getElementById('DIAG') || document.createElement('div');
      host.id = 'DIAG';
      host.textContent = JSON.stringify(out);
      document.body.appendChild(host);
      return;
    }
    for (var w = 0; w < 48; w++) { await sleep(250); if (document.querySelector('.dashboard-view')) break; }
    await sleep(1500);
    out.home = dumpHome();
    location.hash = '#/record';
    for (var w2 = 0; w2 < 48; w2++) { await sleep(250); if (document.querySelector('.record-list .category-list')) break; }
    await sleep(800);
    out.record = dumpRecord();
    host = document.getElementById('DIAG') || document.createElement('div');
    host.id = 'DIAG';
    host.textContent = JSON.stringify(out);
    document.body.appendChild(host);
  })();
})();
</script>`;

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
  const pid = p.json && p.json.data && p.json.data.id;
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p.json)); cleanup(); process.exit(2); }

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); cleanup(); process.exit(2); }

  /** 清掉今天的记录再写入指定字段 —— 保证每个场景互不污染 */
  async function seed(payload, desc) {
    const rec = await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`);
    const id = rec.json && rec.json.data && rec.json.data.id;
    if (id) await req('DELETE', `${API}/daily-records/${id}`);
    const w = await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: today, ...payload });
    return { desc, wrote: w.json && w.json.code === 0 };
  }

  /**
   * 「只用过一次胎动计数器」——这是**最高概率**的真实路径：
   * 用户没在记录页填过任何东西，只是点开计数器记了两下。
   * 计数器写回会**新建**当天的 daily_record 行 ⇒ 首页「核心功能」会说「今日已记录」，
   * 但「今日记录」宫格只有 9 个健康指标、没有一个命中 ⇒ 这个板块的正文是空的。
   */
  async function seedViaCounter() {
    const rec = await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`);
    const id = rec.json && rec.json.data && rec.json.data.id;
    if (id) await req('DELETE', `${API}/daily-records/${id}`);
    const s = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: today, start_time: '00:00:00' });
    const sid = s.json && s.json.data && s.json.data.id;
    if (!sid) return { desc: '计数器', wrote: false, why: JSON.stringify(s.json).slice(0, 200) };
    await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);
    await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);
    await req('PUT', `${API}/fetal-movements/sessions/${sid}`);
    const rd = await req('GET', `${API}/daily-records/by-date/${today}?pregnancy_id=${pid}`);
    const d = (rd.json && rd.json.data) || {};
    return { desc: '计数器', wrote: true, rolledUp: { count: d.fetal_movement_count, duration: d.fetal_movement_duration } };
  }

  async function shot(label, opts) {
    const o = opts || {};
    const variant = path.join(UI_DIR, `_tmp_dashcover_${label}.html`);
    const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
    const probeJs = PROBE
      .replace('__LABEL__', label)
      .replace('__RECORD_ONLY__', o.recordOnly ? 'true' : 'false');
    fs.writeFileSync(variant, html.replace('</body>', probeJs + '</body>'), 'utf-8');
    const profile = path.join(T, 'edge-profile-' + label);
    const hash = o.hash || '#/';
    const url = `http://127.0.0.1:${PORT}${GW}/_tmp_dashcover_${label}.html${hash}`;
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--disable-extensions',
      `--user-data-dir=${profile}`, `--window-size=${WIN_W},${WIN_H}`,
      '--virtual-time-budget=60000', '--dump-dom', url,
    ];
    const dom = await new Promise((resolve) => {
      const bp = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      spawned.add(bp);
      let o = '', done = false;
      const finish = (t) => {
        if (done) return; done = true; clearTimeout(wd); spawned.delete(bp);
        if (t) o += '\n[看门狗] 浏览器超时';
        resolve(o);
      };
      const wd = setTimeout(() => { killTree(bp.pid); finish(true); }, 180000);
      bp.stdout.on('data', (d) => (o += d));
      bp.stderr.on('data', (d) => (o += d));
      bp.on('close', () => finish(false));
      bp.on('error', () => finish(true));
    });
    try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }
    const mm = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    if (!mm) return { label, parseFailed: true, raw: dom.slice(-400) };
    try { return JSON.parse(mm[1].replace(/&quot;/g, '"')); } catch (e) { return { label, parseFailed: true, raw: mm[1].slice(0, 400) }; }
  }

  const CASES = [
    { label: '计数器', viaCounter: true },
    { label: '饮水', payload: { water_intake: 1500 } },
    { label: '运动', payload: { exercise_type: '散步', exercise_duration: 30, exercise_intensity: '轻松' } },
    { label: '体重', payload: { weight: 60 } },
    { label: '仅备注', payload: { note: '今天有点累' } },
  ];

  const results = [];
  let pass = 0, fail = 0;
  const checks = [];
  function check(name, cond, extra) {
    if (cond) { pass++; checks.push(`  ✔ ${name}`); }
    else { fail++; checks.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
  }
  for (const c of CASES) {
    const s = c.viaCounter ? await seedViaCounter() : await seed(c.payload, c.label);
    const r = await shot(c.label);
    r.seeded = s;
    const h0 = r.home || {};
    // 「板块说"有记录"（查看详情）、宫格一张卡没有、空态 CTA 也没显示、兜底也没内容」
    // = 用户看到的是一块**空盒子**。这就是本探针要抓的形态。
    r.brokenEmptyBox = h0.recordLink === '查看详情 →'
      && (h0.gridCards || []).length === 0
      && h0.emptyCtaShown === false
      && (h0.otherChips || []).length === 0;
    results.push(r);
    console.log(`\n===== 场景「今天只记了${c.label}」 =====`);
    if (r.parseFailed) {
      console.log('  探针解析失败: ' + String(r.raw).slice(0, 300));
      check(`场景「只记了${c.label}」渲染取证成功`, false, '探针没抓到 DIAG 节点');
      continue;
    }
    const h = r.home || {};
    console.log(`  今日记录 板块：链接文字「${h.recordLink}」 · 宫格卡片 ${JSON.stringify(h.gridCards)}`);
    console.log(`  宫格子节点数 ${h.gridChildren} · 宫格高度 ${h.gridH}px · 空态CTA显示 ${h.emptyCtaShown}${h.emptyCtaShown ? '（「' + h.emptyCtaText + '」）' : ''}`);
    console.log(`  兜底「今天已记录」：chips ${JSON.stringify(h.otherChips || [])} · 块高 ${h.otherH}px`);
    console.log('  可见板块：' + (h.sections || []).map((x) => `${x.name}(卡${x.hgCards}/待办${x.planItems})`).join(' · '));
    console.log('  工具卡：' + (h.toolCards || []).map((x) => `${x.title}｜${x.stat}`).join(' ／ '));
    if (s.rolledUp) console.log('  计数器写回结果：' + JSON.stringify(s.rolledUp));
    console.log(`  → ${r.brokenEmptyBox ? '❌ 空盒子（板块说有记录，正文什么都没有）' : '✅ 板块正文有内容'}`);
    // ① 板块不能是空盒子；② 有健康指标时宫格必须真的画出卡（别只把兜底文案顶上去）
    check(`场景「只记了${c.label}」首页「今日记录」板块正文非空`, !r.brokenEmptyBox,
      '宫格 0 卡 / 空态 CTA 未显示 / 兜底也没 chip —— 用户看到的是一块空盒子');
    // ③ 「查看详情 →」= 后端说今天有记录；此时**绝不能**再显示「今天还没有记录」
    //    （反例实测：把兜底分支删掉后，Vue 会落到 v-else，对"只记了饮水"的用户谎称"今天还没有记录"）
    check(`场景「只记了${c.label}」不会一边说「查看详情」一边说「今天还没有记录」`,
      !(h.recordLink === '查看详情 →' && h.emptyCtaShown),
      `链接「${h.recordLink}」/ 空态CTA显示 ${h.emptyCtaShown}（空态文案「${h.emptyCtaText}」）`);
    const hasMetric = (h.gridCards || []).length > 0;
    check(`场景「只记了${c.label}」宫格与兜底二者必有其一`,
      hasMetric || (h.otherChips || []).length > 0,
      `宫格卡 ${(h.gridCards || []).length} 张 / 兜底 chip ${(h.otherChips || []).length} 个`);
    if (h.gridH != null) check(`场景「只记了${c.label}」板块正文有实际高度（> 20px）`, h.gridH > 20, `实测 ${h.gridH}px`);
    if (r.errors && r.errors.length) { console.log('  ⚠️ JS 错误：' + r.errors.join(' / ')); check(`场景「只记了${c.label}」无 JS 报错`, false, r.errors.join(' / ')); }
  }

  console.log(`\n===== 汇总：空盒子场景 ${results.filter((r) => r.brokenEmptyBox).length} / ${CASES.length} =====`);

  // ===== 附带取证：首页「查看详情 →」带过去的 ?date= 到底有没有被记录页采纳 =====
  // 记录页以前**完全不读** route.query（selectedDate 恒为今天）⇒ 带日期跳转被静默忽略。
  // 这里用过去日期真跑一遍：有数据的过去日期应显示该日期、没数据的应显示为空。
  const past3 = dstr(-3), past5 = dstr(-5);
  await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: past3, weight: 58.5 });
  const qA = await shot('q3', { recordOnly: true, hash: `#/record?date=${past3}` });
  const qB = await shot('q5', { recordOnly: true, hash: `#/record?date=${past5}` });
  const dayTitle = (r) => String((r && r.recordDate) || '').slice(0, 10);
  const okA = dayTitle(qA) === past3 && ((qA.record || {}).hasData || []).length > 0;
  const okB = dayTitle(qB) === past5 && ((qB.record || {}).hasData || []).length === 0;
  console.log('\n===== 附带：记录页是否采纳首页带的 ?date= =====');
  console.log(`  带 ${past3}（有体重记录）→ 标题显示 ${dayTitle(qA) || '(空)'} · 有数据类别 ${JSON.stringify((qA.record || {}).hasData || [])}  ${okA ? '✅' : '❌'}`);
  console.log(`  带 ${past5}（无任何记录）→ 标题显示 ${dayTitle(qB) || '(空)'} · 有数据类别 ${JSON.stringify((qB.record || {}).hasData || [])}  ${okB ? '✅' : '❌'}`);
  console.log(`  → ${okA && okB ? '✅ 记录页正确采纳 ?date=' : '❌ ?date= 被忽略或错位'}`);
  check(`记录页采纳 ?date=${past3}（有数据的过去日期）`, okA, `标题「${dayTitle(qA)}」/ 有数据类别 ${JSON.stringify((qA.record || {}).hasData || [])}`);
  check(`记录页采纳 ?date=${past5}（无记录的过去日期）`, okB, `标题「${dayTitle(qB)}」/ 有数据类别 ${JSON.stringify((qB.record || {}).hasData || [])}`);
  results.push({ label: 'q-date', past3, past5, okA, okB, a: { title: dayTitle(qA), hasData: (qA.record || {}).hasData }, b: { title: dayTitle(qB), hasData: (qB.record || {}).hasData } });

  // 取最后一次**跑过首页场景**的记录页快照（末尾的 ?date= 两条是 recordOnly，没有 .record.categories）
  const lastScan = [...results].reverse().find((r) => r && r.record && r.record.categories) || {};
  console.log('\n===== 记录页类别清单（用于算覆盖差集）=====');
  console.log('  ' + JSON.stringify((lastScan.record || {}).categories || []));
  console.log('  有数据的类别：' + JSON.stringify((lastScan.record || {}).hasData || []));

  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log('\n产物：' + path.join(OUT, LABEL + '.json'));

  const leftover = cleanStaleVariants(false);
  if (leftover.length) { fail++; checks.push(`  ✘ 临时 html 没擦干净（会污染 app/ui 孤儿判定）: ${leftover.join('、')}`); }
  else { pass++; checks.push('  ✔ app/ui 里没有残留的临时 html（不污染孤儿判定）'); }
  console.log('\n【逐条判定】');
  console.log(checks.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
