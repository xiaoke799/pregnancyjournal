/**
 * 复现/验证「产检·取消完成 状态刷新是否及时」。
 *
 * 背景：用户反馈「完成后状态和取消完成状态刷新要及时」。
 *   markComplete 已修为乐观更新（见 repro_checkup_complete.js）；
 *   本脚本专门验证 cancelComplete 是否同样【本地先变、再发请求】。
 *
 * 手法：真起服务 + 无头 Edge 注入探针。
 *   ① 找第一张【未完成】卡片，点「标记完成」，等它变绿（这步顺带证明 mark 也 OK）；
 *   ② 在同一张卡上点「取消完成」，细粒度轮询记录它【变回未完成】的耗时 firstGrayMs。
 *
 * 判读（对 PUT 与 DELETE 同时注入延迟 DELAY）：
 *   firstGrayMs < DELAY  ⇒ 乐观更新生效（请求还没回来卡片就变回去了）
 *   firstGrayMs ≥ DELAY  ⇒ 没有乐观更新，纯等网络（即「点完不变、要再操作别的才刷新」）
 *
 * 用法：PJ_PUT_DELAY_MS=3000 node repro_checkup_cancel.js [标签]
 * 产物：tools/verify/.tmp/checkup-shot/cancel_<标签>.json / .png
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LABEL = process.argv[2] || 'now';
const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-repro-cancel');
const OUT = path.join(require('./_env').TMP, 'checkup-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38496);
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

  // 同时延迟「标记完成」PUT 与「取消完成」DELETE
  var DELAY = __DELAY__;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    try {
      var s = String(u);
      var mm = String(m).toUpperCase();
      if (DELAY > 0 && (mm === 'PUT' || mm === 'DELETE') && s.indexOf('/checkup-schedule/') !== -1 && s.indexOf('/complete') !== -1) {
        this.__pjDelay = DELAY; R.push('delayedCall=' + mm);
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    var self = this;
    if (self.__pjDelay) { setTimeout(function () { try { origSend.call(self, b); } catch (e) {} }, self.__pjDelay); return; }
    return origSend.apply(this, arguments);
  };

  function waitFor(pred, cb, budgetMs) {
    var start = Date.now();
    var iv = setInterval(function () {
      var v = pred();
      if (v) { clearInterval(iv); cb(true, Date.now() - start); }
      else if (Date.now() - start > budgetMs) { clearInterval(iv); cb(false, Date.now() - start); }
    }, 16);
  }

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
    var target = null;
    for (var i = 0; i < cs.length; i++) if (!isDone(cs[i])) { target = cs[i]; break; }
    if (!target) { R.push('noIncompleteCard'); return flush(); }
    var nm = nameOf(target);
    R.push('target=' + nm);
    R.push('beforeDone=' + isDone(target));

    // ---- 阶段一：标记完成 ----
    var markBtn = btnByText(target, '标记完成');
    if (!markBtn) { R.push('noMarkButton'); return flush(); }
    markBtn.click();
    waitFor(function () { var c = byName(nm); return c && isDone(c); }, function (ok, ms) {
      R.push('markFirstGreenMs=' + (ok ? ms : -1));
      if (!ok) { R.push('markFail'); return flush(); }

      // ---- 阶段二：取消完成 ----
      // 说明：标记请求在途时，「取消完成」按钮按设计是 disabled（防止连点乱序）。
      //       所以要等它变为可用（标记请求已 settle）再点 —— 这才是真实用户的节奏。
      waitFor(function () {
        var c = byName(nm);
        var b = btnByText(c, '取消完成');
        return b && !b.disabled;
      }, function (enabled, waitMs) {
        R.push('cancelBtnEnabledAfterMs=' + waitMs);
        var c2 = byName(nm);
        var cancelBtn = btnByText(c2, '取消完成');
        if (!cancelBtn) { R.push('noCancelButton'); return flush(); }
        R.push('cancelBtnFound=yes');
        var tCancel = Date.now();
        cancelBtn.click();
        waitFor(function () { var c = byName(nm); return c && !isDone(c); }, function (ok2, ms2) {
          R.push('cancelFirstGrayMs=' + (ok2 ? ms2 : -1));
          var c3 = byName(nm);
          R.push('afterCancelMarkBtnBack=' + (btnByText(c3, '标记完成') ? 'true' : 'false'));
          R.push('doneCountEnd=' + document.querySelectorAll('.checkup-card.is-completed').length);
          setTimeout(flush, 200);
        }, 8000);
      }, 12000);
    }, 8000);
  }

  setTimeout(function () { R.push('hardTimeout'); flush(); }, 45000);
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

  const staticDir = UI_DIR;
  const variant = path.join(staticDir, '_tmp_repro_cancel.html');
  const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
  const DELAY = Number(process.env.PJ_PUT_DELAY_MS || 0);
  fs.writeFileSync(variant, html.replace('</body>', PROBE.replace('__DELAY__', String(DELAY)) + '</body>'), 'utf-8');
  console.log('人为延迟「标记完成/取消完成」调用 =', DELAY, 'ms');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); try { fs.unlinkSync(variant); } catch (e) {} cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_repro_cancel.html#/checkup-schedule`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, '--window-size=504,1800', '--virtual-time-budget=40000',
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
    fs.writeFileSync(path.join(OUT, `cancel_${LABEL}.json`), JSON.stringify(kv, null, 2), 'utf-8');

    const after = await req('GET', `${GW}/api/v1/checkup-schedule?pregnancy_id=${encodeURIComponent(pid)}`);
    const itemsAfter = (after.json && after.json.data) || [];
    const doneNames = itemsAfter.filter((x) => x.is_completed).map((x) => x.name);

    console.log('\n===== 探针观测 =====');
    console.log(JSON.stringify(kv, null, 2));
    console.log('\n===== 后端复读（取消后应回到 0 条已完成）=====');
    console.log('已完成条目数 =', doneNames.length, '\n已完成:', doneNames.join(' / ') || '（无）');

    console.log('\n===== 判读 =====');
    const mg = Number(kv.markFirstGreenMs);
    const cg = Number(kv.cancelFirstGrayMs);
    if (DELAY > 0) {
      console.log('本次对标记/取消请求人为延迟了 ' + DELAY + ' ms。');
      console.log((mg >= 0 && mg < DELAY ? '✅' : '🔴') + ' 标记完成 firstGreenMs=' + mg + 'ms');
      console.log((cg >= 0 && cg < DELAY ? '✅' : '🔴') + ' 取消完成 firstGrayMs=' + cg + 'ms');
      if (mg >= 0 && mg < DELAY && cg >= 0 && cg < DELAY) console.log('✅ 两个方向的乐观更新都生效：请求未返回，界面已先变。');
      else if (cg >= DELAY || cg < 0) console.log('🔴 取消完成不是乐观更新 ⇒ 用户会感到「点了没反应」。');
    } else {
      console.log('标记完成 ' + mg + 'ms，取消完成 ' + cg + 'ms（本机网络下的正常耗时）。');
    }

    fs.rmSync(profile, { recursive: true, force: true });
    await run([...common, `--screenshot=${path.join(OUT, `cancel_${LABEL}.png`)}`, url]);
    console.log('截图:', path.join(OUT, `cancel_${LABEL}.png`));
  } finally {
    try { fs.unlinkSync(variant); } catch (e) {}
    cleanup();
  }
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
