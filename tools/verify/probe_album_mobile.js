/**
 * 相册页移动端体检：390px 视口下找出「撑宽页面」的元素并截图。
 *
 * 背景（用户反馈）：相册 0.0.29 新增的格式提示在手机端撑大页面、
 * 整页过大、交互吃力。本脚本不猜 —— 直接量：
 *   ① document.scrollWidth 是否超过视口（= 有横向滚动）
 *   ② 遍历全部元素，列出宽度超过视口的「元凶」（类名 + 实际宽度）
 *   ③ 分别对「空相册 / 有照片的时间线 / 上传对话框展开」三个状态各测一轮
 *
 * 用法：node probe_album_mobile.js
 * 产物：tools/verify/.tmp/checkup-shot/album_mobile_<状态>.png / .json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-album-mobile');
const OUT = path.join(require('./_env').TMP, 'checkup-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38499);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const VW = 390; // iPhone 12/13/14 逻辑宽

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: UI_DIR,
};

function req(m, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch (e) {}
        resolve({ status: res.statusCode, json, buf });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
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

// 1x1 红色 JPEG（最小合法图）
const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfa28a2800a28a2800a28a2803ffd9',
  'hex');

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
  function scan(tag) {
    var vw = document.documentElement.clientWidth;
    var docW = document.documentElement.scrollWidth;
    R.push(tag + '_viewport=' + vw);
    R.push(tag + '_docWidth=' + docW);
    R.push(tag + '_hScroll=' + (docW > vw + 1 ? 'YES' : 'no'));
    var seen = {}, n = 0;
    document.querySelectorAll('*').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width > vw + 1 && n < 8) {
        var cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 60);
        var key = cls + '@' + Math.round(r.width);
        if (seen[key]) return; seen[key] = 1; n++;
        R.push(tag + '_wide[' + n + ']=' + cls + ' w=' + Math.round(r.width));
      }
    });
    if (n === 0) R.push(tag + '_wide=none');
  }
  // 等相册视图渲染
  var tries = 0;
  var t = setInterval(function () {
    var v = document.querySelector('.album-view');
    if (v) { clearInterval(t); run(); }
    else if (tries++ > 80) { clearInterval(t); R.push('no-album-view'); flush(); }
  }, 250);
  function run() {
    setTimeout(function () {
      scan('empty');
      // 打开上传对话框（格式提示在这里面）
      var btn = document.querySelector('.album-header button');
      if (btn) {
        btn.click();
        setTimeout(function () {
          var hint = document.querySelector('.format-hint');
          R.push('formatHintVisible=' + (hint ? 'yes' : 'no'));
          if (hint) {
            var r = hint.getBoundingClientRect();
            R.push('formatHintWidth=' + Math.round(r.width));
          }
          scan('dialog');
          flush();
        }, 1200);
      } else { R.push('no-upload-btn'); scan('dialog'); flush(); }
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

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await req('GET', GW + '/api/v1/health'); if (r.status === 200) { ready = true; break; } } catch (e) {} }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  const H = { 'Content-Type': 'application/json' };
  const p1 = await req('POST', GW + '/api/v1/pregnancies', { headers: H, body: JSON.stringify({ last_period_date: '2026-05-10' }) });
  const pid = p1.json && p1.json.data && p1.json.data.id;
  console.log('pregnancy_id =', pid);

  // 传一张照片，让相册有时间线内容（multipart）
  const boundary = '----pjbnd' + Date.now();
  const mp = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    TINY_JPEG,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="pregnancy_id"\r\n\r\n${pid}\r\n--${boundary}\r\nContent-Disposition: form-data; name="photo_type"\r\n\r\nbelly\r\n--${boundary}--\r\n`),
  ]);
  const up = await req('POST', GW + '/api/v1/photos', {
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': mp.length },
    body: mp,
  });
  console.log('上传测试照片:', up.status, up.json && (up.json.code === 0 ? 'OK' : JSON.stringify(up.json).slice(0, 160)));

  const variant = path.join(UI_DIR, '_tmp_album_mobile.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  fs.writeFileSync(variant, html.replace('</body>', PROBE + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); fs.rmSync(variant, { force: true }); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_album_mobile.html#/album`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`, `--window-size=${VW},844`, '--virtual-time-budget=30000',
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
    const raw = m ? m[1] : '';
    const kv = {};
    raw.split(';;').forEach((chunk) => {
      const i = chunk.indexOf('=');
      if (i <= 0) return;
      kv[chunk.slice(0, i).trim()] = chunk.slice(i + 1).trim();
    });
    fs.writeFileSync(path.join(OUT, 'album_mobile.json'), JSON.stringify(kv, null, 2), 'utf-8');
    console.log('\n===== 390px 视口体检 =====');
    console.log(JSON.stringify(kv, null, 2));
    fs.rmSync(profile, { recursive: true, force: true });
    await run([...common, `--screenshot=${path.join(OUT, 'album_mobile.png')}`, url]);
    console.log('\n截图:', path.join(OUT, 'album_mobile.png'));
  } finally {
    try { fs.rmSync(variant, { force: true }); } catch (e) {}
  }
  cleanup();
  process.exit(0);
})();
