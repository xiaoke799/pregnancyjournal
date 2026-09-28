/**
 * 截「统计」两处界面的真实渲染 + 用探针量结构化数值。
 *
 * 覆盖两个面：
 *   - stats  ：独立页 #/stats（视图 views/StatsView.vue，大号版式）
 *   - record ：记录页 #/record → 点「统计」子标签（内嵌紧凑版式）
 *
 * 为什么这样做：
 *   - 不肉眼看缩略图估结果：探针读真实 DOM，输出卡片标题、汇总条文字、时段按钮、
 *     横向溢出元素，落成 JSON 便于逐项核对。
 *   - 造一份「字段齐全」的数据：同一天里把 14 类指标都写上，才能验证
 *     胎心率 / 宫缩持续时间这两张新卡真的会出来。
 *   - 不覆盖共享的 app/ui：用 PJ_UI_DIR 指向验证用的临时构建产物。
 *
 * 用法：node shot_stats.js <标签> <stats|record> [desktop]
 * 产物：tools/verify/.tmp/stats-shot/<标签>.png 与 <标签>.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LABEL = process.argv[2] || 'shot';
const MODE = process.argv[3] === 'record' ? 'record' : 'stats';
const DESKTOP = process.argv[4] === 'desktop' || process.env.PJ_SHOT_DESKTOP === '1';
const WIN_W = DESKTOP ? 1280 : 504;
const WIN_H = Number(process.env.PJ_SHOT_H || 2400);
const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-stats-shot');
const OUT = path.join(require('./_env').TMP, 'stats-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38486);
const GW = '/app/pregnancyjournal';
/** 前端产物目录：默认 app/ui。设 PJ_UI_DIR 指向验证用临时构建，避免覆盖共享产物。 */
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
<script>
(function () {
  var MODE = '__MODE__';
  var TABLES = __TABLES__;   // true = 展开所有「数据列表」，并按卡 dump 表格行（查备注是否重复等）
  var PERIOD = '__PERIOD__'; // 要点击的时段按钮文字；空字符串 = 保持默认档位

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
      if (hits.length >= 5) break;
    }
    return hits.join(' | ') || 'none';
  }

  function collect(tag) {
    var out = [];
    out.push(tag + 'cards=' + document.querySelectorAll('.metric-card').length);
    out.push(tag + 'panels=' + document.querySelectorAll('.stats-panel').length);
    var cards = document.querySelectorAll('.metric-card');
    var titles = [];
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].querySelector('.card-title');
      if (t) titles.push(t.textContent.trim());
    }
    out.push(tag + 'titles=' + titles.join('|'));
    // 汇总条：条目总数 + 每张卡各自的条数（用来确认"每张卡都有汇总数字"）
    var items = document.querySelectorAll('.summary-strip .sum-item');
    var sums = [];
    for (var j = 0; j < items.length; j++) sums.push(items[j].textContent.replace(/\\s+/g, '').trim());
    out.push(tag + 'sumCount=' + items.length);
    out.push(tag + 'sums=' + sums.join(' / '));
    var per = [];
    for (var k = 0; k < cards.length; k++) per.push(cards[k].querySelectorAll('.sum-item').length);
    out.push(tag + 'sumPerCard=' + per.join(','));
    // 表头（汇总条在首张卡内的位置：应在标题下方、图表上方）
    var first = cards[0];
    if (first) {
      var head = first.querySelector('.card-head');
      var strip = first.querySelector('.summary-strip');
      var wrap = first.querySelector('.chart-wrap');
      var order = [head, strip, wrap].filter(Boolean).map(function (e) { return e.className.split(' ')[0]; });
      out.push(tag + 'firstCardOrder=' + order.join('>'));
    }
    // 时段控件
    var tabs = document.querySelectorAll('.period-tab');
    var tl = [];
    for (var m = 0; m < tabs.length; m++) {
      var active = tabs[m].className.indexOf('active') >= 0;
      tl.push((active ? '[' : '') + tabs[m].textContent.trim() + (active ? ']' : ''));
    }
    out.push(tag + 'tabs=' + tl.join(','));
    var pi = document.querySelector('.period-info');
    out.push(tag + 'periodInfo=' + (pi ? pi.textContent.trim() : 'none'));
    out.push(tag + 'bodyScrollW=' + document.body.scrollWidth);
    out.push(tag + 'vw=' + document.documentElement.clientWidth);
    out.push(tag + 'overflow=' + offenders());
    // 每张卡的数据点/表格行数（v-show 隐藏时行仍在 DOM 里，无需展开）+ 图表高度
    var rpc = [];
    var hpc = [];
    for (var w = 0; w < cards.length; w++) {
      rpc.push(cards[w].querySelectorAll('.data-table tbody tr').length);
      var cw = cards[w].querySelector('.chart-wrap');
      hpc.push(cw ? Math.round(cw.getBoundingClientRect().height) : 0);
    }
    out.push(tag + 'rowsPerCard=' + rpc.join(','));
    out.push(tag + 'chartH=' + hpc.join(','));
    // 缩放条：canvas 画的看不到，但 MetricCard 会在「有点多」时给 .chart-wrap 加 has-zoom
    var zc = [];
    var metas = [];
    for (var z2 = 0; z2 < cards.length; z2++) {
      zc.push(cards[z2].querySelector('.chart-wrap.has-zoom') ? 1 : 0);
      var mm = cards[z2].querySelector('.card-meta');
      metas.push(mm ? mm.textContent.trim() : '-');
    }
    out.push(tag + 'zoomWraps=' + zc.join(','));
    out.push(tag + 'metas=' + metas.join(' | '));
    out.push(tag + 'noDataCards=' + document.querySelectorAll('.metric-card .no-data').length);
    out.push(tag + 'canvases=' + document.querySelectorAll('.metric-card canvas').length);
    out.push(tag + 'docH=' + document.documentElement.scrollHeight);
    // 每张卡的坐标（top:height），配合 _crop_cards.py 精确裁图逐卡复核
    var rects = [];
    for (var y2 = 0; y2 < cards.length; y2++) {
      var rr = cards[y2].getBoundingClientRect();
      rects.push(Math.round(rr.top + window.scrollY) + ':' + Math.round(rr.height));
    }
    out.push(tag + 'rects=' + rects.join(','));
    // 数据列表：按卡 dump（重点查宫缩/胎心的「备注」列是否被写了两遍）
    if (TABLES) {
      var dump = [];
      for (var q = 0; q < cards.length; q++) {
        var tt = cards[q].querySelector('.card-title');
        var name = tt ? tt.textContent.trim() : ('#' + q);
        var trs = cards[q].querySelectorAll('.data-table tbody tr');
        var rows = [];
        for (var z = 0; z < trs.length; z++) {
          var tds = trs[z].querySelectorAll('td');
          var cells = [];
          for (var c = 0; c < tds.length; c++) cells.push(tds[c].textContent.replace(/\\s+/g, ' ').trim());
          rows.push(cells.join('~'));
        }
        if (name === '胎心率' || name === '宫缩持续时间' || name === '胎动次数') {
          dump.push(name + '[' + rows.length + '行]' + rows.join(' ; '));
        }
      }
      out.push(tag + 'tableDump=' + dump.join(' || '));
      // 表头列数（有 extra/note 时才多出「补充」「备注」两列）
      var ths = first ? first.querySelectorAll('.data-table thead th') : [];
      var thTxt = [];
      for (var v = 0; v < ths.length; v++) thTxt.push(ths[v].textContent.trim());
      out.push(tag + 'firstTableHead=' + thTxt.join('/'));
    }
    return out;
  }

  function clickByText(sel, text) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent.trim().indexOf(text) !== -1) { els[i].click(); return true; }
    }
    return false;
  }

  var SK = [];
  var clicked = false;

  function measure() {
    var host = document.getElementById('DIAG') || document.createElement('div');
    host.id = 'DIAG';
    var out = ['mode=' + MODE];
    if (MODE === 'record') {
      out.push('subTabClicked=' + clicked);
      out.push('statsPanelVisible=' + !!document.querySelector('.stats-panel .metric-card'));
    }
    out = out.concat(collect('m_'));
    host.textContent = out.join(' ;; ');
    host.style.display = 'none';
    document.body.appendChild(host);
  }

  // 记录页：先切到「统计」子标签，再切时段到「孕期全部」；需要时展开所有数据列表
  function expandTables() {
    var tg = document.querySelectorAll('.table-toggle');
    for (var i = 0; i < tg.length; i++) tg[i].click();
  }

  function drive() {
    if (MODE === 'record') {
      clicked = clickByText('.sub-tab-btn', '统计');
    }
    setTimeout(function () {
      if (PERIOD) clickByText('.period-tab', PERIOD);
      if (TABLES) setTimeout(expandTables, 1500);
    }, MODE === 'record' ? 1200 : 200);
  }

  setTimeout(drive, 1500);
  setTimeout(measure, 8000);
  setTimeout(measure, 13000);
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
    try {
      const r = await req('GET', GW + '/api/v1/pregnancies/active');
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* not up */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

  const H = { 'Content-Type': 'application/json' };
  const body = JSON.stringify;

  // ---- 建孕期 ----
  const BIG = process.env.PJ_SHOT_BIG === '1';
  const BIG_DAYS = Number(process.env.PJ_SHOT_BIG_DAYS || 240);
  const lmpOffset = BIG ? -(BIG_DAYS + 14) : -120;
  const p1 = await req('POST', GW + '/api/v1/pregnancies', {
    headers: H, body: body({ last_period_date: dstr(lmpOffset), due_date: dstr(lmpOffset + 280) }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) {
    const pa = await req('GET', GW + '/api/v1/pregnancies/active');
    pid = pa.json && pa.json.data && pa.json.data.id;
  }
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p1.json)); cleanup(); process.exit(2); }

  // ---- 造数据：孕期早期两条（体重基准）+ 本月五条（14 类指标写齐）----
  let rows = [
    // 孕期早期：只写体重，作为「孕期增重」的起点
    { record_date: dstr(-70), weight: 58.0 },
    { record_date: dstr(-40), weight: 61.5 },
    // 本月（2026-09）：逐条把指标写齐，确保 14 张卡都有数据
    {
      record_date: dstr(-21), weight: 62.5, blood_pressure_systolic: 112, blood_pressure_diastolic: 72,
      body_temperature: 36.5, sleep_hours: 7.5, water_intake: 1500,
    },
    {
      record_date: dstr(-14), weight: 63.8, blood_pressure_systolic: 114, blood_pressure_diastolic: 74,
      blood_glucose_fasting: 4.8, blood_glucose_1h: 7.2, blood_glucose_2h: 6.1,
      bust: 98, waist: 92, hip: 100, water_intake: 1800,
    },
    {
      record_date: dstr(-7), weight: 64.6, blood_pressure_systolic: 118, blood_pressure_diastolic: 78,
      hcg_value: 8500, hcg_weeks: 12, uric_acid: 280, uric_acid_period: '晨起',
      body_temperature: 36.7, sleep_hours: 6.5, sleep_quality: '一般',
      fetal_heart_rate: 148, water_intake: 2000,
    },
    {
      record_date: dstr(-3), weight: 65.2, blood_pressure_systolic: 120, blood_pressure_diastolic: 80,
      fetal_heart_rate: 152, fetal_movement_count: 12, fetal_movement_duration: 35,
      contraction_duration: 45, contraction_interval: 8, contraction_count: 4,
      contraction_pain: '轻度', note: '常规复查',
    },
    {
      record_date: dstr(0), weight: 65.4, blood_pressure_systolic: 116, blood_pressure_diastolic: 76,
      fetal_heart_rate: 150, fetal_movement_count: 15, fetal_movement_duration: 40,
      water_intake: 2200, body_temperature: 36.6,
    },
  ];

  // PJ_SHOT_BIG=1：模拟「孕期全程每天都在记」的大数据量（默认 240 天），
  // 用来复核「孕期全部」时段下曲线还看不看得清、缩放够不够用。
  if (process.env.PJ_SHOT_BIG === '1') {
    const N = Number(process.env.PJ_SHOT_BIG_DAYS || 240);
    rows = [];
    for (let i = N; i >= 0; i--) {
      const d = dstr(-i);
      const t = (N - i) / N; // 0 → 1 推进
      const r = {
        record_date: d,
        weight: +(55 + t * 11 + Math.sin(i * 0.7) * 0.35).toFixed(1),
        blood_pressure_systolic: Math.round(108 + t * 14 + Math.sin(i * 0.5) * 4),
        blood_pressure_diastolic: Math.round(68 + t * 12 + Math.cos(i * 0.6) * 3),
        body_temperature: +(36.4 + Math.sin(i * 0.9) * 0.3).toFixed(1),
        sleep_hours: +(6 + Math.abs(Math.sin(i * 0.4)) * 2.5).toFixed(1),
        water_intake: Math.round(1400 + Math.abs(Math.cos(i * 0.3)) * 1000),
        note: i % 30 === 0 ? '月度小结' : undefined,
      };
      // 每 7 天量一次三围
      if (i % 7 === 0) {
        r.bust = +(88 + t * 14).toFixed(1);
        r.waist = +(78 + t * 18).toFixed(1);
        r.hip = +(92 + t * 12).toFixed(1);
      }
      // 28 周后才有胎心/胎动/宫缩
      if (i <= 110) {
        r.fetal_heart_rate = Math.round(142 + Math.sin(i * 0.35) * 9);
        r.fetal_movement_count = Math.round(8 + Math.abs(Math.sin(i * 0.5)) * 10);
        r.fetal_movement_duration = Math.round(25 + Math.abs(Math.cos(i * 0.4)) * 20);
      }
      if (i <= 30) {
        r.contraction_duration = Math.round(30 + Math.abs(Math.sin(i * 0.8)) * 35);
        r.contraction_interval = Math.round(5 + Math.abs(Math.cos(i * 0.7)) * 8);
        r.contraction_count = Math.round(2 + Math.abs(Math.sin(i * 0.3)) * 6);
        r.contraction_pain = i % 2 ? '轻度' : '中度';
      }
      // 血糖/HCG/尿酸只在前几次产检时抽
      if (i % 45 === 0) {
        r.blood_glucose_fasting = +(4.4 + Math.abs(Math.sin(i)) * 0.9).toFixed(1);
        r.blood_glucose_1h = +(6.6 + Math.abs(Math.cos(i)) * 1.4).toFixed(1);
        r.blood_glucose_2h = +(5.6 + Math.abs(Math.sin(i * 1.3)) * 1.2).toFixed(1);
        r.hcg_value = Math.round(3000 + (N - i) * 900);
        r.hcg_weeks = Math.round((N - i) / 7);
        r.uric_acid = Math.round(240 + Math.abs(Math.sin(i * 0.6)) * 90);
        r.uric_acid_period = '晨起';
      }
      rows.push(r);
    }
    console.log('大数据量模式：将写入', rows.length, '条记录');
  }

  for (const r of rows) {
    const res = await req('POST', GW + '/api/v1/daily-records', {
      headers: H, body: body({ pregnancy_id: pid, ...r }),
    });
    if (!res.json || res.json.code !== 0) {
      console.log('写记录失败', r.record_date, JSON.stringify(res.json));
    }
  }
  // 回读确认条数
  const chk = await req('GET', `${GW}/api/v1/daily-records?pregnancy_id=${encodeURIComponent(pid)}&page_size=1000`);
  const list = chk.json && chk.json.data && chk.json.data.list;
  console.log('已写入记录条数:', Array.isArray(list) ? list.length : 'N/A');

  // ---- 生成变体 HTML（注入探针），放在静态根内，用完删 ----
  const variant = path.join(UI_DIR, '_tmp_stats_shot.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const probeJs = PROBE
    .replace('__MODE__', MODE)
    .replace('__TABLES__', process.env.PJ_SHOT_TABLES === '1' ? 'true' : 'false')
    .replace('__PERIOD__', process.env.PJ_SHOT_PERIOD === 'keep' ? '' : (process.env.PJ_SHOT_PERIOD || '孕期全部'));
  fs.writeFileSync(variant, html.replace('</body>', probeJs + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); fs.unlinkSync(variant); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const hash = MODE === 'record' ? '#/record' : '#/stats';
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_stats_shot.html${hash}`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--window-size=${WIN_W},${WIN_H}`,
    '--virtual-time-budget=40000',
  ];

  const run = (args) => new Promise((resolve) => {
    const p = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });

  try {
    // 1) 探针：结构化数值
    const dom = await run([...common, '--dump-dom', url]);
    const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    const diagRaw = m ? m[1] : '';
    const diag = {};
    diagRaw.split(';;').forEach((chunk) => {
      const pair = chunk.trim();
      const i = pair.indexOf('=');
      if (i <= 0) return;
      diag[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
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
