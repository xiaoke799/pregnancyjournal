/**
 * 复现「产检标记完成后卡片不立即显示已完成」的问题。
 *
 * 症状（v0.0.28 手机端用户反馈）：
 *   点「标记完成」→ 当前卡片不变绿；再点下一条的「标记完成」，上一条才显示已完成。
 *
 * 手法：真起服务 + 无头 Edge 注入探针 ——
 *   探针找到第一张【未完成】卡片 → 记录其名称与 is-completed 状态 → 点它的「标记完成」按钮
 *   → 立即（同一事件循环末尾）再读一次该卡片状态 → 2 秒后再读一次。
 *   把三次观测写进 #DIAG，由 --dump-dom 取回。
 *
 * 判读：
 *   before=false, immediate=false, later=true   ⇒ 复现（乐观更新没生效/被回滚，要等下一轮）
 *   before=false, immediate=true,  later=true   ⇒ 无此问题
 *
 * 用法：node repro_checkup_complete.js [标签]
 * 产物：tools/verify/.tmp/checkup-shot/repro_<标签>.json / .png
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LABEL = process.argv[2] || 'now';
const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-repro-complete');
const OUT = path.join(require('./_env').TMP, 'checkup-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38495);
const GW = '/app/pregnancyjournal';
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
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (e) {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

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
  var R = [];
  var logged = false;
  var t0 = Date.now();
  function el() { return Date.now() - t0; }
  function flush() {
    if (logged) return; logged = true;
    var host = document.getElementById('DIAG') || document.createElement('div');
    host.id = 'DIAG';
    host.textContent = R.join(' ;; ');
    host.style.display = 'none';
    document.body.appendChild(host);
  }
  function cards() { return document.querySelectorAll('.checkup-card'); }
  function nameOf(c) { var n = c.querySelector('.checkup-name'); return n ? n.textContent.trim() : '?'; }
  function isDone(c) { return c.classList.contains('is-completed'); }
  function byName(n) {
    var cs = cards();
    for (var i = 0; i < cs.length; i++) if (nameOf(cs[i]) === n) return cs[i];
    return null;
  }
  function indexOfName(n) {
    var cs = cards();
    for (var i = 0; i < cs.length; i++) if (nameOf(cs[i]) === n) return i;
    return -1;
  }
  function findMarkBtn(c) {
    var bs = c.querySelectorAll('.card-footer button');
    for (var i = 0; i < bs.length; i++) if (bs[i].textContent.indexOf('标记完成') !== -1) return bs[i];
    return null;
  }

  // ---- 把「标记完成」的 PUT 人为延迟 3 秒，用来区分「乐观更新」与「等网络」----
  var DELAY = __DELAY__;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    try {
      var s = String(u);
      if (DELAY > 0 && String(m).toUpperCase() === 'PUT' && s.indexOf('/checkup-schedule/') !== -1 && s.indexOf('/complete') !== -1) {
        this.__pjDelay = DELAY;
        R.push('delayedPut=yes');
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    var self = this;
    if (self.__pjDelay) { setTimeout(function () { try { origSend.call(self, b); } catch (e) {} }, self.__pjDelay); return; }
    return origSend.apply(this, arguments);
  };

  var tries = 0, lastN = -1, stable = 0;
  var t = setInterval(function () {
    var cs = cards();
    if (cs.length === 0) { if (tries++ > 60) { clearInterval(t); R.push('no-cards'); flush(); } return; }
    if (cs.length === lastN) stable++; else stable = 0;
    lastN = cs.length;
    if (stable < 3) { if (tries++ > 80) { clearInterval(t); R.push('cards-unstable'); flush(); } return; }
    clearInterval(t);
    run();
  }, 250);

  function run() {
    var cs = cards();
    R.push('totalCards=' + cs.length);
    R.push('doneCountBefore=' + document.querySelectorAll('.checkup-card.is-completed').length);
    var target = null;
    for (var i = 0; i < cs.length; i++) if (!isDone(cs[i])) { target = cs[i]; break; }
    if (!target) { R.push('noIncompleteCard'); return flush(); }
    var nm = nameOf(target);
    R.push('target=' + nm);
    R.push('idxBefore=' + indexOfName(nm));
    R.push('before=' + isDone(target));
    var btn = findMarkBtn(target);
    if (!btn) { R.push('noMarkButton'); return flush(); }
    R.push('btnDisabled=' + (btn.disabled ? 'true' : 'false'));
    var tClick = Date.now();
    btn.click();

    // 细粒度轮询：记录「第一次变绿」的时刻，以及位置是否变动
    var firstGreenMs = -1, idxAfterGreen = -1, ticks = 0;
    var poll = setInterval(function () {
      ticks++;
      var c = byName(nm);
      if (c && firstGreenMs < 0 && isDone(c)) { firstGreenMs = Date.now() - tClick; idxAfterGreen = indexOfName(nm); }
      if (ticks > 400) {                       // 最多约 6.4s
        clearInterval(poll);
        R.push('firstGreenMs=' + firstGreenMs);
        R.push('idxAfterGreen=' + idxAfterGreen);
        R.push('btnStillThere=' + (findMarkBtn(byName(nm) || document.createElement('div')) ? 'true' : 'false'));
        R.push('doneCountAfter=' + document.querySelectorAll('.checkup-card.is-completed').length);
        flush();
      }
    }, 16);
  }

  setTimeout(function () { R.push('hardTimeout'); flush(); }, 40000);
})();
</script>
`;

(async () => {
  const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await req('GET', '/api/v1/health'); if (r.status === 200) { ready = true; break; } } catch (e) {} }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  const body = JSON.stringify;
  const H = { 'Content-Type': 'application/json' };
  const p1 = await req('POST', GW + '/api/v1/pregnancies', { headers: H, body: body({ last_period_date: dstr(-140), due_date: dstr(140) }) });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) { const pa = await req('GET', GW + '/api/v1/pregnancies/active'); pid = pa.json && pa.json.data && pa.json.data.id; }
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p1.json)); cleanup(); process.exit(2); }
  console.log('pregnancy_id =', pid);

  // 基线核对：后端 GET 是否能正确反映完成状态
  const before = await req('GET', `${GW}/api/v1/checkup-schedule?pregnancy_id=${encodeURIComponent(pid)}`);
  const itemsBefore = (before.json && before.json.data) || [];
  console.log('后端基线：条目数 =', itemsBefore.length, ' 已完成数 =', itemsBefore.filter((x) => x.is_completed).length);

  const staticDir = UI_DIR;
  const variant = path.join(staticDir, '_tmp_repro.html');
  const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
  const DELAY = Number(process.env.PJ_PUT_DELAY_MS || 0);
  fs.writeFileSync(variant, html.replace('</body>', PROBE.replace('__DELAY__', String(DELAY)) + '</body>'), 'utf-8');
  console.log('人为延迟「标记完成」PUT =', DELAY, 'ms');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); try { fs.unlinkSync(variant); } catch (e) {} cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_repro.html#/checkup-schedule`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, '--window-size=504,1800', '--virtual-time-budget=30000',
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
    const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    const raw = m ? m[1] : '';
    const kv = {};
    raw.split(';;').forEach((chunk) => {
      const i = chunk.indexOf('=');
      if (i <= 0) return;
      kv[chunk.slice(0, i).trim()] = chunk.slice(i + 1).trim();
    });
    fs.writeFileSync(path.join(OUT, `repro_${LABEL}.json`), JSON.stringify(kv, null, 2), 'utf-8');

    // 后端再查一次：确认完成状态是否真的写进去了
    const after = await req('GET', `${GW}/api/v1/checkup-schedule?pregnancy_id=${encodeURIComponent(pid)}`);
    const itemsAfter = (after.json && after.json.data) || [];
    const doneNames = itemsAfter.filter((x) => x.is_completed).map((x) => x.name);

    console.log('\n===== 探针观测 =====');
    console.log(JSON.stringify(kv, null, 2));
    console.log('\n===== 后端复读 =====');
    console.log('已完成条目数 =', doneNames.length, '\n已完成:', doneNames.join(' / '));

    console.log('\n===== 判读 =====');
    const fg = Number(kv.firstGreenMs);
    if (DELAY > 0) {
      console.log('本次对「标记完成」请求人为延迟了 ' + DELAY + ' ms。');
      if (fg >= 0 && fg < DELAY) {
        console.log('✅ 乐观更新生效：请求还没回来（' + fg + 'ms < ' + DELAY + 'ms）卡片就变绿了。');
      } else if (fg < 0) {
        console.log('🔴 等了 6.4 秒仍未变绿 —— 连请求返回后都没更新。');
      } else {
        console.log('🔴 卡片要等到请求返回后才变绿（firstGreenMs=' + fg + 'ms ≥ 延迟 ' + DELAY + 'ms）⇒ 没有乐观更新，纯等网络。');
      }
    } else {
      if (fg >= 0) console.log('卡片在 ' + fg + 'ms 后变绿（本机网络下的正常耗时）。');
      else console.log('🔴 6.4 秒内未变绿。');
    }
    console.log('位置：点击前索引=' + kv.idxBefore + '，变绿后索引=' + kv.idxAfterGreen + '（不同=完成后列表重排，卡片会跳位）');
    console.log('按钮状态："标记完成"按钮点击时 disabled=' + kv.btnDisabled + '，变绿后还在=' + kv.btnStillThere);

    fs.rmSync(profile, { recursive: true, force: true });
    await run([...common, `--screenshot=${path.join(OUT, `repro_${LABEL}.png`)}`, url]);
    console.log('截图:', path.join(OUT, `repro_${LABEL}.png`));
  } finally {
    try { fs.unlinkSync(variant); } catch (e) {}
    cleanup();
  }
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
