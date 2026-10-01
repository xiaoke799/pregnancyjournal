/**
 * 深浅色主题截图工具（可视化验证，不做断言）
 *
 * 【为什么需要它】
 * 深色模式修复后，机器上一直没有"看一眼"的手段——此前误判"本机无头浏览器缺失"。
 * 实际上其它套件（probe_dashboard_record_coverage 等）早就在用 Edge/Chrome 的
 * `--headless=new` 模式做真实渲染取证，只是用 --dump-dom 而已。本工具用同一套路子
 * 换成 `--screenshot`，把首页 / 记录页 / 设置页在深色、浅色下各截一张，
 * 供人（或 AI 读图）核对：背景、卡片、文字、图表颜色是否真的随主题翻转。
 *
 * 【做法】
 * - 起真后端（tcp_shim + dev 模式 + 临时存储），POST 造一个孕期 + 三天体重，
 *   让首页成长曲线真的有数据可画（图表深色配色才有东西可看）。
 * - 往 app/ui 写两份 _tmp_theme_*.html 变体，头部注入
 *   `localStorage.setItem('pj-theme-mode','dark'|'light')`——主题 store 在模块
 *   初始化时读它，内联脚本先于 deferred module 执行，正好赶在前面。
 * - 每张截图用全新 user-data-dir，避免 localStorage / 磁盘缓存串味。
 * - ⚠️ 临时 html 写在 app/ui 里（要被静态服务托管），进出各擦一次——
 *   残留会让 verify_ui_orphans 假绿、还会随 fpk 发出去（套件注释里的教训）。
 *
 * 用法：node tools/verify/shot_theme_screens.js
 * 产物：.workbuddy/.tmp/theme_shots/<mode>-<page>.png
 */
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env = require('./_env');

const PORT = Number(process.env.PJ_TCP_PORT || 38567);
const GW = '/app/pregnancyjournal';
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-theme-'));
const OUT = path.join(env.REPO, '.workbuddy', '.tmp', 'theme_shots');
fs.mkdirSync(OUT, { recursive: true });

const spawned = new Set();
function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (off) => {
  const d = new Date(Date.now() + off * 86400000);
  return d.toISOString().slice(0, 10);
};

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
  STATIC_DIR: env.UI_DIR,
};

/** 擦掉 _tmp_theme_*.html（进出各一次，防残留进包 / 孤儿检查假绿） */
function cleanVariants(quiet) {
  let left = [];
  try {
    for (const f of fs.readdirSync(env.UI_DIR)) {
      if (!f.startsWith('_tmp_theme_') || !f.endsWith('.html')) continue;
      try { fs.unlinkSync(path.join(env.UI_DIR, f)); } catch (e) { left.push(f); }
    }
  } catch (e) { /* UI_DIR 不存在 */ }
  if (left.length && !quiet) console.log('⚠️ 临时 html 删不掉（被占用？）：' + left.join('、'));
  return left;
}
cleanVariants(true);

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let o = '';
      res.on('data', (c) => (o += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(o); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

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

function shoot(browser, url, png, profile) {
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, '--window-size=430,900',
    '--virtual-time-budget=30000', `--screenshot=${png}`, url,
  ];
  return new Promise((resolve) => {
    const bp = spawn(browser, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    spawned.add(bp);
    let err = '';
    bp.stderr.on('data', (d) => (err += d));
    let done = false;
    const wd = setTimeout(() => {
      if (done) return; done = true; spawned.delete(bp);
      killTree(bp.pid); resolve(false);
    }, 150000);
    bp.on('exit', () => {
      if (done) return; done = true; clearTimeout(wd); spawned.delete(bp);
      const ok = fs.existsSync(png) && fs.statSync(png).size > 10000;
      if (!ok) console.log(`  ⚠️ 截图失败: ${path.basename(png)} ${err.split('\n').slice(-3).join(' | ')}`);
      resolve(ok);
    });
  });
}

(async () => {
  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); process.exit(2); }

  // ── 起服务 ──
  const child = spawn(env.NODE, ['-r', path.join(env.VERIFY_DIR, 'tcp_shim.js'), env.SERVER_ENTRY], {
    cwd: env.SERVER_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
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

  // ── 造数据：孕期 + 三天体重（成长曲线的「妈妈体重」线才有内容）──
  const API = GW + '/api/v1';
  const p = await req('POST', API + '/pregnancies', { last_period_date: dstr(-162), due_date: dstr(118) });
  const pid = p.json && p.json.data && p.json.data.id;
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p.json)); cleanup(); process.exit(2); }
  for (const [off, w] of [[-3, 58.5], [-2, 58.9], [-1, 59.2]]) {
    await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: dstr(off), weight: w });
  }

  // ── 写主题变体 html ──
  const baseHtml = fs.readFileSync(path.join(env.UI_DIR, 'index.html'), 'utf-8');
  const variants = {};
  for (const mode of ['dark', 'light']) {
    const name = `_tmp_theme_${mode}.html`;
    const inject = `<script>try{localStorage.setItem('pj-theme-mode','${mode}')}catch(e){}</script>`;
    fs.writeFileSync(path.join(env.UI_DIR, name), baseHtml.replace('</body>', inject + '</body>'), 'utf-8');
    variants[mode] = name;
  }

  // ── 逐张截图 ──
  const pages = [['dashboard', '#/'], ['record', '#/record'], ['settings', '#/settings']];
  const results = [];
  for (const mode of ['dark', 'light']) {
    for (const [page, hash] of pages) {
      const png = path.join(OUT, `${mode}-${page}.png`);
      try { fs.unlinkSync(png); } catch (e) { /* 不存在 */ }
      const profile = path.join(T, `profile-${mode}-${page}`);
      const url = `http://127.0.0.1:${PORT}${GW}/${variants[mode]}${hash}`;
      const ok = await shoot(browser, url, png, profile);
      const size = ok ? fs.statSync(png).size : 0;
      results.push({ mode, page, ok, size });
      console.log(`  ${ok ? '✔' : '✘'} ${mode}-${page}.png  ${(size / 1024).toFixed(0)} KB`);
    }
  }

  cleanVariants(false);
  cleanup();
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n截图：${okCount}/${results.length} 张成功 → ${OUT}`);
  process.exit(okCount === results.length ? 0 : 1);
})();
