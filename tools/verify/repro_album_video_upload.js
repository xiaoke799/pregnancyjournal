/**
 * 复现：相册「上传视频」→ 点「上传」没反应
 *
 * 用户实测反馈：相册上传视频，点击上传没反应。
 *
 * 本脚本用真服务 + 无头 Edge 走完整前端流程：
 *   打开 #/album → 打开上传对话框 → 构造一个视频 File 塞进 file input（等价于用户选中视频）
 *   → 点对话框里的「上传」→ 记录：
 *     · 提交按钮点击前是否 disabled
 *     · 点击后按钮是否出现过 loading（这是"有没有反馈"的客观证据）
 *     · POST /photos 是否真的发出、耗时、响应内容
 *     · toast 文案（naive-ui message）
 *     · 异常（window.onerror）
 *
 * 用法：
 *   node repro_album_video_upload.js                 # 正常场景（1MB 假视频）
 *   PJ_DELAY_MS=3000 node repro_album_video_upload.js   # 服务端响应慢 3 秒（模拟大视频/慢网络）
 *   PJ_NO_PREG=1 node repro_album_video_upload.js    # 不预建孕期档案（测静默 return 路径）
 *   PJ_W=390 PJ_H=844 node repro_album_video_upload.js   # 手机尺寸
 *
 * 产物：tools/verify/.tmp/album-upload/repro.json + 截图
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-album-upload');
const OUT = path.join(require('./_env').TMP, 'album-upload');
const PORT = Number(process.env.PJ_TCP_PORT || 38505);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const DELAY_MS = Number(process.env.PJ_DELAY_MS || 0);
const NO_PREG = process.env.PJ_NO_PREG === '1';
const W = Number(process.env.PJ_W || 1280);
const H = Number(process.env.PJ_H || 900);
const VIDEO_MB = Number(process.env.PJ_VIDEO_MB || 1);

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
  function log(k, v) { R.push(k + '=' + String(v).replace(/[\\r\\n]+/g, ' ')); }
  function flush() {
    var h = document.getElementById('DIAG') || document.createElement('div');
    h.id = 'DIAG'; h.style.display = 'none';
    h.textContent = R.join(' ;; ');
    if (!h.parentNode) document.body.appendChild(h);
  }
  window.onerror = function (m, s, l, c) { log('jsError', m + ' @' + l + ':' + c); };
  window.onunhandledrejection = function (e) { log('jsRejection', (e.reason && e.reason.message) || String(e.reason)); };

  var DELAY = ${DELAY_MS};
  var reqs = [];
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    var x = this, args = arguments;
    x.__t0 = Date.now();
    x.addEventListener('loadend', function () {
      reqs.push((x.__m || '') + ' ' + String(x.__u || '').split('/api/v1').pop() + ' status=' + x.status + ' ms=' + (Date.now() - x.__t0) + ' resp=' + String(x.responseText || '').replace(/\\s+/g, ' ').slice(0, 200));
    });
    var isPhotoPost = String(x.__m || '').toUpperCase() === 'POST' && String(x.__u || '').indexOf('/photos') >= 0;
    if (DELAY > 0 && isPhotoPost) { setTimeout(function () { _send.apply(x, args); }, DELAY); return; }
    return _send.apply(x, args);
  };

  function findButtons(root, text) {
    var out = [];
    root.querySelectorAll('button').forEach(function (b) { if ((b.textContent || '').trim() === text) out.push(b); });
    return out;
  }

  var tries = 0;
  var t = setInterval(function () {
    if (document.querySelector('.album-view')) { clearInterval(t); run(); }
    else if (tries++ > 160) { clearInterval(t); log('album-not-found', '1'); flush(); }
  }, 250);

  function run() {
    setTimeout(function () {
      var topBtns = findButtons(document, '上传');
      log('topUploadBtns', topBtns.length);
      if (!topBtns.length) { log('no-upload-btn', 1); flush(); return; }
      topBtns[0].click();
      setTimeout(function () {
        var modal = document.querySelector('.n-modal');
        log('modalOpen', modal ? 1 : 0);
        if (!modal) { flush(); return; }
        var input = modal.querySelector('input[type=file]');
        log('fileInputFound', input ? 1 : 0);
        try {
          var dt = new DataTransfer();
          var bytes = new Uint8Array(${VIDEO_MB} * 1024 * 1024);
          for (var i = 0; i < bytes.length; i += 4096) bytes[i] = i & 255;
          dt.items.add(new File([bytes], 'test-video.mp4', { type: 'video/mp4' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          log('changeDispatched', 1);
        } catch (e) { log('dataTransferError', e && e.message); }
        setTimeout(function () {
          log('fileNameShown', (modal.querySelector('.file-name') || {}).textContent || '(none)');
          var subs = findButtons(modal, '上传');
          log('submitBtnsInModal', subs.length);
          var sub = subs[0];
          if (!sub) { flush(); return; }
          log('submitDisabledBeforeClick', sub.disabled ? 1 : 0);

          var t0 = Date.now();
          var everLoading = false, firstLoadingMs = -1, lastLoadingSeenMs = -1;
          var markLoading = function () {
            if (sub.className.indexOf('loading') >= 0 || sub.querySelector('.n-base-loading')) {
              everLoading = true;
              if (firstLoadingMs < 0) firstLoadingMs = Date.now() - t0;
              lastLoadingSeenMs = Date.now() - t0;
            }
          };
          // 快请求（本机 ~10ms）轮询会漏采，MutationObserver 盯住按钮的 class 与内部节点
          var mo = new MutationObserver(markLoading);
          mo.observe(sub, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
          var poll = setInterval(markLoading, 15);

          sub.click();
          log('clicked', 1);

          var waited = 0;
          var w = setInterval(function () {
            waited += 150;
            var hasPhotoReq = reqs.some(function (r) { return r.indexOf('POST /photos') >= 0; });
            var toastEl = document.querySelector('.n-message-container, .n-message');
            var toast = toastEl ? (toastEl.textContent || '').trim().slice(0, 80) : '';
            var finished = (hasPhotoReq && waited > 1500) || toast || waited > 9000;
            if (finished) {
              clearInterval(w); clearInterval(poll); mo.disconnect();
              setTimeout(function () {
                log('everLoading', everLoading ? 1 : 0);
                log('firstLoadingMs', firstLoadingMs);
                log('lastLoadingSeenMs', lastLoadingSeenMs);
                var mm = document.querySelector('.n-modal');
                log('modalStillOpen', mm ? 1 : 0);
                // 关掉的 modal 可能还在 DOM 里（过渡/display:none），用可见性做最终判定
                log('modalVisible', mm && mm.offsetParent !== null ? 1 : 0);
                log('fileNameAfter', (document.querySelector('.n-modal .file-name') || {}).textContent || '(cleared/none)');
                log('timelineItems', document.querySelectorAll('.timeline-item').length);
                log('reqs', reqs.length ? reqs.join(' || ') : '(none)');
                log('toast', toast || '(none)');
                log('totalElapsedMs', Date.now() - t0);
                flush();
              }, 600);
            }
          }, 150);
        }, 400);
      }, 700);
    }, 1200);
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

  if (!NO_PREG) {
    await req('POST', GW + '/api/v1/pregnancies', { last_period_date: '2026-05-10' });
  }

  const variant = path.join(UI_DIR, '_tmp_album_upload.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  fs.writeFileSync(variant, html.replace('</body>', PROBE + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); fs.rmSync(variant, { force: true }); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_album_upload.html#/album`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--virtual-time-budget=45000',
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
    const meta = { scenario: { DELAY_MS, NO_PREG, W, H, VIDEO_MB, UI_DIR }, kv };
    fs.writeFileSync(path.join(OUT, 'repro.json'), JSON.stringify(meta, null, 2), 'utf-8');
    console.log('\n===== 相册视频上传复现 =====');
    console.log('场景:', JSON.stringify(meta.scenario));
    console.log(JSON.stringify(kv, null, 2));
    await run([...common, `--screenshot=${path.join(OUT, 'repro.png')}`, url]);
    console.log('\n截图:', path.join(OUT, 'repro.png'));
    console.log('\n--- 服务端日志尾部（photo 相关）---');
    console.log(srvLog.split('\n').filter((l) => /photo|上传|error|Error/.test(l)).slice(-12).join('\n'));
  } finally {
    try { fs.rmSync(variant, { force: true }); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  cleanup();
  process.exit(0);
})();
