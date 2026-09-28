/**
 * 验证「产检·取消完成」是否乐观更新（本地先变灰，再发请求）。
 *
 * 为什么单独一个脚本：markComplete 的返回分支会后台 loadAll() 刷新列表；
 * 若「标记→立刻取消」连在一起测，那次 loadAll 可能把刚变灰的状态又刷回绿色，
 * 造成 16ms 的灰窗被探针错过 → 误判成「没有乐观更新」。
 * 所以这里【先在后台用接口把一条标成已完成】，页面带着「已完成」卡片加载，
 * 探针只做一件事：点【取消完成】→ 测它变回未完成的耗时 firstGrayMs。
 *
 * 判读：对 DELETE 注入延迟 DELAY
 *   firstGrayMs < DELAY ⇒ 乐观更新生效
 *   firstGrayMs ≥ DELAY ⇒ 纯等网络（用户会感到「点了没反应」）
 *
 * 用法：PJ_PUT_DELAY_MS=3000 node repro_checkup_cancel.js [标签]
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LABEL = process.argv[2] || 'now';
const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-repro-cancel2');
const OUT = path.join(require('./_env').TMP, 'checkup-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38497);
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
  function byName(n) { var cs = cards(); for (var i = 0; i < cs.length; i++) if (nameOf(cs[i]) === n) return cs[i]; return null; }
  function btnByText(c, txt) {
    if (!c) return null;
    var bs = c.querySelectorAll('.card-footer button');
    for (var i = 0; i < bs.length; i++) if (bs[i].textContent.indexOf(txt) !== -1) return bs[i];
    return null;
  }
  function waitFor(pred, cb, budgetMs) {
    var start = Date.now();
    var iv = setInterval(function () {
      var v = pred();
      if (v) { clearInterval(iv); cb(true, Date.now() - start); }
      else if (Date.now() - start > budgetMs) { clearInterval(iv); cb(false, Date.now() - start); }
    }, 16);
  }

  // 只延迟 DELETE（取消完成）
  var DELAY = __DELAY__;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    try {
      var s = String(u);
      if (DELAY > 0 && String(m).toUpperCase() === 'DELETE' && s.indexOf('/checkup-schedule/') !== -1 && s.indexOf('/complete') !== -1) {
        this.__pjDelay = DELAY; R.push('delayedDelete=yes');
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
    for (var i = 0; i < cs.length; i++) if (isDone(cs[i])) { target = cs[i]; break; }
    if (!target) { R.push('noCompletedCard'); return flush(); }
    var nm = nameOf(target);
    R.push('target=' + nm);
    R.push('beforeDone=' + isDone(target));
    var cancelBtn = btnByText(target, '取消完成');
    if (!cancelBtn) { R.push('noCancelButton'); return flush(); }
    R.push('cancelBtnDisabled=' + (cancelBtn.disabled ? 'true' : 'false'));
    if (cancelBtn.disabled) { R.push('cancelBtnDisabledAtStart'); return flush(); }

    cancelBtn.click();
    waitFor(function () { var c = byName(nm); return c && !isDone(c); }, function (ok, ms) {
      R.push('cancelFirstGrayMs=' + (ok ? ms : -1));
      var c2 = byName(nm);
      R.push('markBtnBack=' + (btnByText(c2, '标记完成') ? 'true' : 'false'));
      R.push('doneCountEnd=' + document.querySelectorAll('.checkup-card.is-completed').length);
      setTimeout(flush, 200);
    }, 8000);
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

  // 后台预置：把第一张标准产检标成已完成（走真实接口），页面就会带一张「已完成」卡片加载。
  const sched = await req('GET', `${GW}/api/v1/checkup-schedule?pregnancy_id=${encodeURIComponent(pid)}`);
  const items = (sched.json && sched.json.data) || [];
  if (!items.length) { console.log('产检排期为空'); cleanup(); process.exit(2); }
  const first = items[0];
  const mk = await req('PUT', `${GW}/api/v1/checkup-schedule/${first.id}/complete?pregnancy_id=${encodeURIComponent(pid)}`, { headers: H });
  console.log('预置完成:', first.name, '→ http', mk.status);
  const chk = await req('GET', `${GW}/api/v1/checkup-schedule?pregnancy_id=${encodeURIComponent(pid)}`);
  console.log('预置后已完成数 =', ((chk.json && chk.json.data) || []).filter((x) => x.is_completed).length);

  const staticDir = UI_DIR;
  const variant = path.join(staticDir, '_tmp_repro_cancel2.html');
  const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
  const DELAY = Number(process.env.PJ_PUT_DELAY_MS || 0);
  fs.writeFileSync(variant, html.replace('</body>', PROBE.replace('__DELAY__', String(DELAY)) + '</body>'), 'utf-8');
  console.log('人为延迟「取消完成」DELETE =', DELAY, 'ms');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); try { fs.unlinkSync(variant); } catch (e) {} cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_repro_cancel2.html#/checkup-schedule`;
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
    fs.writeFileSync(path.join(OUT, `cancel2_${LABEL}.json`), JSON.stringify(kv, null, 2), 'utf-8');

    const after = await req('GET', `${GW}/api/v1/checkup-schedule?pregnancy_id=${encodeURIComponent(pid)}`);
    const doneNames = ((after.json && after.json.data) || []).filter((x) => x.is_completed).map((x) => x.name);

    console.log('\n===== 探针观测 =====');
    console.log(JSON.stringify(kv, null, 2));
    console.log('\n===== 后端复读（取消后应回 0）=====');
    console.log('已完成条目数 =', doneNames.length, '\n已完成:', doneNames.join(' / ') || '（无）');

    console.log('\n===== 判读 =====');
    const cg = Number(kv.cancelFirstGrayMs);
    if (DELAY > 0) {
      console.log('本次对「取消完成」DELETE 人为延迟了 ' + DELAY + ' ms。');
      if (cg >= 0 && cg < DELAY) console.log('✅ 取消完成乐观更新生效：请求还没回来（' + cg + 'ms < ' + DELAY + 'ms）卡片已变回未完成。');
      else if (cg < 0) console.log('🔴 8 秒内未变回 —— 连请求返回后都没更新。');
      else console.log('🔴 卡片要等请求返回才变回（firstGrayMs=' + cg + 'ms ≥ 延迟）⇒ 取消完成没有乐观更新。');
    } else {
      console.log('取消完成耗时 ' + cg + 'ms（本机网络下正常）。');
    }

    fs.rmSync(profile, { recursive: true, force: true });
    await run([...common, `--screenshot=${path.join(OUT, `cancel2_${LABEL}.png`)}`, url]);
    console.log('截图:', path.join(OUT, `cancel2_${LABEL}.png`));
  } finally {
    try { fs.unlinkSync(variant); } catch (e) {}
    cleanup();
  }
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
