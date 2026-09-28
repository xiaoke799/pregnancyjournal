/**
 * 记录页图标体检：390px 级视口下验证「清理表情包后图标空白」已修复。
 *
 * 背景：AppIcon 对字典外的名字原来渲染空 SVG ⇒ 记录页一批内容型图标（心情/症状/便便…）全空白。
 * 修复：AppIcon 增加兜底 —— 字典未命中时把名字当文本符号渲染。
 * 本脚本打开 #/record，逐个检查图标容器：svg / 文本符号 / **空** 三态，空即为 FAIL；
 * 顺带测整页横向溢出。
 *
 * 用法：node probe_record_icons.js
 * 产物：tools/verify/.tmp/checkup-shot/record_icons.png / .json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-record-icons');
const OUT = path.join(require('./_env').TMP, 'checkup-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38503);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev', FNOS_SOCKET_PATH: path.join(T, 'a.sock'), PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
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

function findBrowser() {
  for (const c of [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ]) { if (fs.existsSync(c)) return c; }
  return null;
}

const PROBE = `
<script>
(function () {
  var R = [];
  var logged = false;
  function flush() {
    if (logged) return; logged = true;
    var h = document.getElementById('DIAG') || document.createElement('div');
    h.id = 'DIAG'; h.style.display = 'none';
    h.textContent = R.join(' ;; ');
    document.body.appendChild(h);
  }
  var tries = 0;
  var t = setInterval(function () {
    var v = document.querySelector('.record-view') || document.querySelector('main') || document.body;
    if (document.querySelectorAll('.record-view,.record-list,.category-list').length) { clearInterval(t); run(); }
    else if (tries++ > 100) { clearInterval(t); R.push('record-view-not-found'); flush(); }
  }, 250);
  function iconState(span) {
    if (span.querySelector('svg')) return 'svg';
    if (span.textContent.trim()) return 'glyph';
    return 'EMPTY';
  }
  function scan(sel, tag) {
    var els = document.querySelectorAll(sel);
    var stat = { svg: 0, glyph: 0, EMPTY: 0 };
    els.forEach(function (el) { stat[iconState(el)]++; });
    R.push(tag + '_count=' + els.length);
    R.push(tag + '_svg=' + stat.svg);
    R.push(tag + '_glyph=' + stat.glyph);
    R.push(tag + '_EMPTY=' + stat.EMPTY);
  }
  function run() {
    setTimeout(function () {
      var vw = document.documentElement.clientWidth;
      R.push('viewport=' + vw);
      R.push('docWidth=' + document.documentElement.scrollWidth);
      R.push('hScroll=' + (document.documentElement.scrollWidth > vw + 1 ? 'YES' : 'no'));
      scan('.record-view .type-menu-icon', 'typeMenu');
      scan('.record-view .preview-icon', 'preview');
      scan('.record-list .row-icon', 'listRow');
      // 打开「添加记录」弹窗里的类型图标
      var addBtn = document.querySelector('.record-view .add-btn, .record-view button');
      flush();
    }, 1500);
  }
})();
</script>
`;

(async () => {
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await req('GET', GW + '/api/v1/health'); if (r.status === 200) break; } catch (e) {} }

  const H = { 'Content-Type': 'application/json' };
  await req('POST', GW + '/api/v1/pregnancies', { headers: H, body: JSON.stringify({ last_period_date: '2026-05-10' }) });

  const variant = path.join(UI_DIR, '_tmp_record_icons.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  fs.writeFileSync(variant, html.replace('</body>', PROBE + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); fs.rmSync(variant, { force: true }); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_record_icons.html#/record`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`, '--window-size=390,844', '--virtual-time-budget=30000',
  ];
  const run = (args) => new Promise((resolve) => {
    const p = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });

  try {
    const dom = await run([...common, '--dump-dom', url]);
    const m = dom.match(/<div id="DIAG"[^>]*>([\s\S]*?)<\/div>/);
    const kv = {};
    (m ? m[1] : '').split(';;').forEach((chunk) => {
      const i = chunk.indexOf('=');
      if (i <= 0) return;
      kv[chunk.slice(0, i).trim()] = chunk.slice(i + 1).trim();
    });
    fs.writeFileSync(path.join(OUT, 'record_icons.json'), JSON.stringify(kv, null, 2), 'utf-8');
    console.log('\n===== 记录页图标体检 =====');
    console.log(JSON.stringify(kv, null, 2));
    fs.rmSync(profile, { recursive: true, force: true });
    await run([...common, `--screenshot=${path.join(OUT, 'record_icons.png')}`, url]);
    console.log('\n截图:', path.join(OUT, 'record_icons.png'));
  } finally {
    try { fs.rmSync(variant, { force: true }); } catch (e) {}
  }
  cleanup();
  process.exit(0);
})();
