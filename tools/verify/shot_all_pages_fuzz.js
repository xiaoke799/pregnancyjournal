/**
 * 全页面「点击不崩」暴力核验（真后端 + 无头浏览器）
 *
 * 【为什么需要它】2026-09-29 连着修了两个同类崩溃：
 *   ① 宫缩「查看」→ `Invalid time value`（n-time-picker 的 formatted-value 收到空字符串）；
 *   ② 胎动计数页 → 按钮恒为「结束计数」（composable 不解构，Ref 对象恒真）。
 * 这两类都是**只有真实渲染 + 真实点击才暴露**的问题，静态检查看不见。
 *
 * 做法：
 *   1. 起真后端，建孕期，写一条**含全部字段**的当天记录（备注留空，贴近真实场景，
 *      并让 plan_date 为空 ⇒ 覆盖「回填时把空字符串喂给日期选择器」这条路径）；
 *   2. 逐个打开所有路由页面；
 *   3. 每个页面把所有可点元素（按钮 / 类别行 / 快捷菜单项 / 页签）**逐个点一遍**，
 *      打开弹窗后连弹窗内的按钮也点一遍，每次点击后检查 App.vue 的错误边界；
 *   4. 一旦崩溃，记录「点的是哪个元素」+ 错误描述（.app-error-desc 里有 err.message）。
 *
 * 用法：node shot_all_pages_fuzz.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const UI_DIR = env.UI_DIR;
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38537);
const GW = '/app/pregnancyjournal';
const LABEL = 'all-pages-fuzz';
const OUT = path.join(env.TMP, LABEL);
const T = path.join(env.TMP, LABEL + '-run');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(T, { recursive: true });

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
const spawned = new Set();
function killTree(pid) {
  if (!pid) return;
  try {
    require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (e) { /* 已退出 */ }
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

const PAGES = [
  { key: 'dashboard', hash: '', title: '首页' },
  { key: 'record', hash: 'record', title: '记录页' },
  { key: 'stats', hash: 'stats', title: '统计页' },
  { key: 'album', hash: 'album', title: '相册' },
  { key: 'diary', hash: 'diary', title: '日记' },
  { key: 'checkup', hash: 'checkup-schedule', title: '产检' },
  { key: 'diet', hash: 'diet', title: '饮食' },
  { key: 'checklist', hash: 'checklist', title: '清单' },
  { key: 'exercise', hash: 'exercise-guide', title: '运动指南' },
  { key: 'weekly', hash: 'weekly-detail', title: '本周变化' },
  { key: 'settings', hash: 'settings', title: '设置' },
  { key: 'contraction', hash: 'contraction-timer', title: '宫缩计时器' },
  { key: 'fetal', hash: 'fetal-movement-counter', title: '胎动计数' },
  { key: 'setup', hash: 'setup', title: '初始设置' },
];

const PROBE = `
<script>
(function () {
  const out = { steps: [], clicks: 0, modals: 0, crashed: false, crashAt: '', errMsg: '', skipped: '' };
  function dump() {
    const old = document.getElementById('DIAG'); if (old) old.remove();
    const d = document.createElement('div'); d.id = 'DIAG';
    d.textContent = JSON.stringify(out); document.body.appendChild(d);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errState = () => {
    const t = document.querySelector('.app-error-title');
    const d = document.querySelector('.app-error-desc');
    return t ? { crashed: true, msg: (d ? d.textContent : '').trim() } : { crashed: false, msg: '' };
  };
  const describe = (el) => {
    const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 18);
    const cls = (el.className || '').toString().split(' ')[0];
    return (cls ? cls + '|' : '') + t;
  };
  const SELECTOR = 'button, .category-row, .type-menu-item, .n-tab, .n-radio-button, .mode-tab';
  (async function () {
    try {
      await wait(4000);
      const e0 = errState();
      if (e0.crashed) { out.crashed = true; out.crashAt = '(页面打开即崩)'; out.errMsg = e0.msg; dump(); return; }
      const seen = new Set();
      const list = Array.from(document.querySelectorAll(SELECTOR));
      out.steps.push('可点元素=' + list.length);
      let guard = 0;
      for (let i = 0; i < list.length && guard < 70; i++) {
        guard++;
        const el = list[i];
        const label = describe(el);
        if (seen.has(label)) continue;
        seen.add(label);
        try { el.click(); } catch (e) { /* ignore */ }
        out.clicks++;
        await wait(420);
        let e = errState();
        if (e.crashed) { out.crashed = true; out.crashAt = label; out.errMsg = e.msg; dump(); return; }
        // 弹窗内按钮也点一遍
        const modal = document.querySelector('.n-modal, .n-dialog');
        if (modal) {
          out.modals++;
          const mbtns = Array.from(modal.querySelectorAll('button'));
          for (const b of mbtns) {
            const bl = '弹窗内:' + describe(b);
            if (seen.has(bl)) continue;
            seen.add(bl);
            try { b.click(); } catch (e2) { /* ignore */ }
            out.clicks++;
            await wait(420);
            e = errState();
            if (e.crashed) { out.crashed = true; out.crashAt = bl; out.errMsg = e.msg; dump(); return; }
          }
          const mask = document.querySelector('.n-modal-mask');
          if (mask) { mask.click(); await wait(320); }
        }
      }
      out.steps.push('共点击 ' + out.clicks + ' 次、打开弹窗 ' + out.modals + ' 个，无崩溃');
    } catch (e) {
      out.steps.push('探针异常: ' + (e && e.message));
    }
    dump();
  })();
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
  const cleanup = () => {
    for (const bp of spawned) killTree(bp.pid);
    spawned.clear();
    killTree(child.pid);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const r = await req('GET', GW + '/api/v1/pregnancies/active');
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* 还没起来 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  const H = { 'Content-Type': 'application/json' };
  const p1 = await req('POST', GW + '/api/v1/pregnancies', {
    headers: H, body: JSON.stringify({ last_period_date: dstr(-162), due_date: dstr(118) }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) {
    const pa = await req('GET', GW + '/api/v1/pregnancies/active');
    pid = pa.json && pa.json.data && pa.json.data.id;
  }
  if (!pid) { console.log('建孕期失败'); cleanup(); process.exit(2); }

  // 一条记录塞满所有字段：让记录页每个类别行都「有数据」⇒ 点它就走进编辑大弹窗，
  // 一次覆盖全部类型的**回填**路径（这是崩得最多的地方）。
  // ⚠️ 注意几点刻意的取值：
  //   - note 留空（贴近真实：用户小弹窗记录时常不写备注）
  //   - plan_date 不传 ⇒ 回填时 `r.plan_date || ''` 会得到空字符串
  //   - contraction_pain 用历史值「中度」⇒ 覆盖取值域归一路径
  const allFields = {
    pregnancy_id: pid, record_date: dstr(0),
    weight: 64.2, blood_pressure_systolic: '118', blood_pressure_diastolic: '76',
    fetal_heart_rate: 145, body_temperature: 36.6,
    bust: 88, waist: 92, hip: 96,
    blood_glucose_fasting: 4.8, blood_glucose_1h: 7.2, blood_glucose_2h: 6.1,
    mood: '4', mood_note: '还行', note: '',
    stool_record: JSON.stringify({ count: 1, consistency: 'normal' }),
    sleep_hours: 7.5, sleep_quality: 'good',
    symptoms: JSON.stringify(['腰痛']),
    exercise_type: '散步', exercise_duration: 30,
    diet_note: JSON.stringify([{ type: '早餐', content: '小米粥' }]),
    medication: JSON.stringify([{ name: '叶酸片', dosage: '0.4mg', frequency: '一日一次' }]),
    edema_level: 'mild', vaginal_discharge: 'normal',
    skin_condition: 'normal', urination_frequency: 'normal',
    hcg_value: 50000, hcg_weeks: 6,
    uric_acid: 250, uric_acid_period: '空腹',
    supplement_record: JSON.stringify([{ name: '叶酸' }]),
    intimacy_record: JSON.stringify({ count: 1, has_protection: 'yes', protection_type: 'condom' }),
    water_intake: 1800, habit_text: '早睡',
    contraction_count: 2, contraction_interval: 8, contraction_duration: 45, contraction_pain: '中度',
    fetal_movement_count: 12, fetal_movement_duration: 20,
    plan_text: '下次产检',
  };
  const w = await req('POST', GW + '/api/v1/daily-records', { headers: H, body: JSON.stringify(allFields) });
  console.log('写入全字段记录: code=' + (w.json && w.json.code));

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); cleanup(); process.exit(2); }
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const profile = path.join(T, 'edge-profile');

  async function runPage(p) {
    const name = `_tmp_fuzz_${p.key}.html`;
    const variant = path.join(UI_DIR, name);
    fs.writeFileSync(variant, html.replace('</body>', PROBE + '</body>'), 'utf-8');
    const url = `http://127.0.0.1:${PORT}${GW}/${name}#/${p.hash}`;
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--disable-extensions',
      `--user-data-dir=${profile}`, '--window-size=430,900',
      '--virtual-time-budget=150000', '--dump-dom', url,
    ];
    const WATCH_MS = 150000;
    const dom = await new Promise((resolve) => {
      const proc = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      spawned.add(proc);
      let o = '', done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(wd); spawned.delete(proc); resolve(o); };
      const wd = setTimeout(() => { o += '\n[看门狗] 超时'; killTree(proc.pid); finish(); }, WATCH_MS);
      proc.stdout.on('data', (d) => (o += d));
      proc.stderr.on('data', (d) => (o += d));
      proc.on('close', finish);
      proc.on('error', () => { killTree(proc.pid); finish(); });
    });
    try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }
    const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    if (!m) {
      fs.writeFileSync(path.join(OUT, `dom-${p.key}.html`), dom, 'utf-8');
      return null;
    }
    try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { return null; }
  }

  const results = [];
  let fail = 0;
  for (const p of PAGES) {
    const r = await runPage(p);
    if (!r) {
      console.log(`\n【${p.title}】 ⚠️ 没取到结果`);
      results.push({ page: p.key, title: p.title, error: 'no-result' });
      continue;
    }
    if (r.crashed) {
      fail++;
      console.log(`\n【${p.title}】 ✘ 崩溃`);
      console.log('    💬 点的是: ' + r.crashAt);
      console.log('    💬 错误描述: ' + (r.errMsg || '(空)'));
    } else {
      console.log(`\n【${p.title}】 ✔ ${(r.steps || []).join(' / ')}`);
    }
    results.push({ page: p.key, title: p.title, ...r });
  }

  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log('\n明细: ' + path.join(OUT, LABEL + '.json'));
  console.log('合计: ' + (PAGES.length - fail) + ' 个页面通过 / ' + fail + ' 个页面崩溃');
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
