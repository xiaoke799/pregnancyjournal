/**
 * 胎动计数器页「点击有没有反应」真实核验（真后端 + 无头浏览器）
 *
 * 【背景】用户反馈「胎动记录点击没反应」。数据通路（daily_record 的胎动字段）
 * 已由 verify_record_page_functions 覆盖且全绿，所以怀疑点在**交互层**：
 *   - FetalMovementCounterView 的 startCounting() 在孕期档案还没取回时
 *     是 `if (currentPregnancy) {...}` —— 为假时**什么都不做、也不提示**；
 *   - startSession() 里接口失败同样静默（isRunning 不变 ⇒ 按钮纹丝不动）。
 * 这两条都表现为「点了没反应」，且**没有任何反馈**，用户无从判断发生了什么。
 *
 * 做法：起真后端 → 建孕期 → 无头 Edge 打开胎动计数页 → 真实点击
 * 「开始计数」，轮询看是否切换成「结束计数」，再点「记录胎动」看计数是否增加。
 *
 * 用法：node shot_fetal_movement_click.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const UI_DIR = env.UI_DIR;
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38531);
const GW = '/app/pregnancyjournal';
const LABEL = 'fetal-click';
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

/**
 * 浏览器探针：按 PAGE 走两条分支
 *  - fetal：胎动计数页，点「开始计数」→ 应切「结束计数」→ 点 3 次「记录胎动」看计数
 *  - contraction：宫缩计时页，**会话按钮必须出现**（v-if="sessionId"）⇒ 能证明会话真的建起来了；
 *    再点「开始」→ 应变「停止」
 * ⚠️ 宫缩页的 `v-if="sessionId"` 是个天然探针：sessionId 为空时按钮根本不渲染，
 *    这正是「孕期没取回 ⇒ 会话没建 ⇒ 点了全没反应」的根因现场。
 */
const probeFor = (page) => `
<script>
(function () {
  const PAGE = ${JSON.stringify(page)};
  const out = { page: PAGE, steps: [], startFound: false, afterStart: '',
                kickClicks: 0, countAfter: null, sessionBtn: false, msg: '' };
  const btnByText = (t) => Array.from(document.querySelectorAll('button'))
    .find((b) => (b.textContent || '').trim() === t);
  const countText = () => {
    const el = document.querySelector('.count-display');
    return el ? el.textContent.trim() : null;
  };
  const anyToast = () => {
    const els = document.querySelectorAll('.n-message, .n-message__content, .n-notification');
    if (!els.length) return '';
    return (els[els.length - 1].textContent || '').trim().slice(0, 80);
  };
  function dump() {
    const old = document.getElementById('DIAG');
    if (old) old.remove();
    const d = document.createElement('div');
    d.id = 'DIAG';
    d.textContent = JSON.stringify(out);
    document.body.appendChild(d);
  }
  setTimeout(async () => {
    try {
      const h2 = document.querySelector('h2');
      out.steps.push('页面标题=' + (h2 ? h2.textContent.trim() : '(无)'));
      if (PAGE === 'fetal') {
        const start = btnByText('开始计数');
        out.startFound = !!start;
        if (!start) { out.steps.push('没找到「开始计数」按钮'); dump(); return; }
        start.click();
        out.steps.push('已点击「开始计数」');
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (btnByText('结束计数')) { out.afterStart = 'OK:已切换为结束计数'; break; }
        }
        if (!out.afterStart) out.afterStart = 'FAIL:仍停在「开始计数」（点击无反应）';
        const kick = document.querySelector('.kick-button');
        if (kick && !kick.disabled) {
          for (let i = 0; i < 3; i++) { kick.click(); out.kickClicks++; await new Promise((r) => setTimeout(r, 400)); }
          out.countAfter = countText();
        } else {
          out.steps.push('「记录胎动」不可用（disabled=' + (kick ? kick.disabled : 'no btn') + '）');
        }
      } else {
        // 会话按钮出现 ⇒ 说明 onMounted 里 startSession 成功了
        out.sessionBtn = !!document.querySelector('.end-session-btn');
        out.steps.push('「结束本次会话」按钮=' + (out.sessionBtn ? '存在（会话已建立）' : '不存在（会话没建起来）'));
        const start = btnByText('开始');
        out.startFound = !!start;
        if (!start) { out.steps.push('没找到「开始」按钮'); dump(); return; }
        start.click();
        out.steps.push('已点击「开始」');
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (btnByText('停止')) { out.afterStart = 'OK:已切换为停止'; break; }
        }
        if (!out.afterStart) out.afterStart = 'FAIL:仍停在「开始」（点击无反应）';
      }
      out.msg = anyToast();
    } catch (e) {
      out.steps.push('探针异常: ' + (e && e.message));
    }
    dump();
  }, 3000);
  setTimeout(dump, 25000);
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
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p1.json)); cleanup(); process.exit(2); }
  console.log('孕期 id: ' + pid);

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');

  /** 打开一个页面并取回探针结果 */
  async function runPage(page, hashPath) {
    const name = `_tmp_${page}.html`;
    const variant = path.join(UI_DIR, name);
    fs.writeFileSync(variant, html.replace('</body>', probeFor(page) + '</body>'), 'utf-8');
    const url = `http://127.0.0.1:${PORT}${GW}/${name}#/${hashPath}`;
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--disable-extensions',
      `--user-data-dir=${profile}`, '--window-size=430,900',
      '--virtual-time-budget=60000', '--dump-dom', url,
    ];
    const WATCH_MS = 120000;
    const dom = await new Promise((resolve) => {
      const p = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      spawned.add(p);
      let o = '', done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(wd); spawned.delete(p); resolve(o); };
      const wd = setTimeout(() => { o += '\n[看门狗] 浏览器超时'; killTree(p.pid); finish(); }, WATCH_MS);
      p.stdout.on('data', (d) => (o += d));
      p.stderr.on('data', (d) => (o += d));
      p.on('close', finish);
      p.on('error', () => { killTree(p.pid); finish(); });
    });
    try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }
    fs.writeFileSync(path.join(OUT, `dom-${page}.html`), dom, 'utf-8');
    const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    if (!m) return null;
    try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { return null; }
  }

  let fail = 0;
  const check = (name, ok, extra) => {
    if (ok) console.log('  ✔ ' + name);
    else { fail++; console.log('  ✘ ' + name + (extra ? '  ← ' + extra : '')); }
  };

  // —— 页面一：胎动计数 ——
  const rf = await runPage('fetal', 'fetal-movement-counter');
  console.log('\n【胎动计数页 · 真实点击核验】');
  if (!rf) { console.log('  ❌ 没取到探针结果'); fail += 3; }
  else {
    (rf.steps || []).forEach((s) => console.log('  · ' + s));
    check('渲染出「开始计数」按钮（不是一上来就「结束计数」）', rf.startFound === true);
    check('点「开始计数」后切换为「结束计数」', /^OK/.test(rf.afterStart || ''), rf.afterStart || '(无)');
    check('点「记录胎动」3 次后计数变成 3', rf.countAfter === '3',
      '计数=' + rf.countAfter + ' 点击=' + rf.kickClicks);
  }

  // —— 页面二：宫缩计时 ——
  const rc = await runPage('contraction', 'contraction-timer');
  console.log('\n【宫缩计时页 · 真实点击核验】');
  if (!rc) { console.log('  ❌ 没取到探针结果'); fail += 3; }
  else {
    (rc.steps || []).forEach((s) => console.log('  · ' + s));
    // sessionId 为空时这个按钮根本不渲染 ⇒ 它能证明会话真的建起来了
    check('会话已建立（底部「结束本次会话」按钮存在）', rc.sessionBtn === true);
    check('渲染出「开始」按钮', rc.startFound === true);
    check('点「开始」后切换为「停止」', /^OK/.test(rc.afterStart || ''), rc.afterStart || '(无)');
  }

  console.log('\n合计: ' + (6 - Math.min(fail, 6)) + ' 通过 / ' + fail + ' 失败');
  if (fail) console.log('❌ 计时器点击链路有问题');
  else console.log('✅ 两个计时器点击链路均正常');
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
