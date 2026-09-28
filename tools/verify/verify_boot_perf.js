/**
 * 首屏性能改动回归（v0.0.31）
 *
 * 覆盖四件事：
 *   A. index.html 有加载骨架（不再纯白）+ 版本号注入正确
 *   B. 静态资源 gzip 生效，且**解压后与磁盘原文件逐字节一致**（防止压坏）
 *   C. 缓存策略：assets = immutable，html = no-store
 *   D. 降级路径：客户端不支持 gzip 时，必须完整拿到原始内容
 *
 * ⚠️ 反例验证：脚本会特意用「不带 Accept-Encoding」和「带 gzip」两种方式取同一个文件，
 *    断言两者内容一致且都不为空 —— 只测其中一种会漏掉「压缩响应内容损坏」这类致命问题。
 *
 * 用法：node tools/verify/verify_boot_perf.js
 */
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const NODE_DIR = path.resolve(__dirname, '../../app/server/node');
const SHIM = path.resolve(__dirname, 'tcp_shim.js');
const UI = path.resolve(__dirname, '../../app/ui');
const PORT = 38511;

let pass = 0;
let fail = 0;
function ok(name, extra) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
function ng(name, extra) { fail++; console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
function assert(cond, name, extra) { cond ? ok(name, extra) : ng(name, extra); }

const tmpData = path.join(os.tmpdir(), 'pj_bootperf_' + Date.now());
fs.mkdirSync(tmpData, { recursive: true });
const sampleDb = path.resolve(__dirname, '../../data/pregnancy-journal.db');
if (fs.existsSync(sampleDb)) fs.copyFileSync(sampleDb, path.join(tmpData, 'pregnancyjournal.db'));

const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
  cwd: NODE_DIR,
  env: {
    ...process.env,
    PJ_TCP_PORT: String(PORT),
    APP_MODE: 'fnos',
    STORAGE_DIR: tmpData,
    DATABASE_PATH: path.join(tmpData, 'pregnancyjournal.db'),
    STATIC_DIR: UI,
    ASSETS_DIR: path.join(NODE_DIR, 'data'),
    TRIM_APPDEST: NODE_DIR,
    TRIM_PKGVAR: tmpData,
    PJ_BACKFILL_DELAY_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
child.stdout.on('data', (d) => serverLog.push(d.toString()));
child.stderr.on('data', (d) => serverLog.push(d.toString()));

function waitPort(port, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(Date.now() - start); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) resolve(-1);
        else setTimeout(tryOnce, 20);
      });
    };
    tryOnce();
  });
}

/** 取回完整响应体（Buffer），headers 另给 */
function getRaw(urlPath, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', (e) => resolve({ error: e.message }));
    r.end();
  });
}

(async () => {
  const portMs = await waitPort(PORT);
  console.log(`\n服务冷启动 → 端口可连：${portMs} ms\n`);

  // ---------- A. index.html 骨架屏 ----------
  console.log('A. index.html 首屏骨架');
  const htmlDisk = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  assert(/boot-splash/.test(htmlDisk), '含有加载骨架节点 #boot-splash');
  assert(/<div id="app">\s*<div id="boot-splash">/.test(htmlDisk), '骨架位于 #app 内部（Vue 挂载后会被自动替换）');
  assert(/@keyframes boot-slide/.test(htmlDisk), '骨架样式内联（此刻外部 CSS 还没加载）');
  assert(/孕程记/.test(htmlDisk) && /正在加载/.test(htmlDisk), '骨架有中文文案');

  const idx = await getRaw('/app/pregnancyjournal/');
  assert(idx.status === 200, 'GET / 返回 200');
  const idxBody = idx.body.toString('utf8');
  assert(idxBody.includes('boot-splash'), '服务端返回的 HTML 里也有骨架');
  assert(/index-Dj4l5ONK\.js|index-[A-Za-z0-9_-]{8,12}\.js/.test(idxBody), 'HTML 引用了带 hash 的主包');

  // ---------- B. gzip 生效且不压坏 ----------
  console.log('\nB. gzip 压缩');
  const m = htmlDisk.match(/assets\/(index-[A-Za-z0-9_-]{8,12}\.js)/);
  const mainName = m ? m[1] : null;
  assert(!!mainName, '解析出主包文件名', mainName ? `(${mainName})` : '');

  const mainPath = path.join(UI, 'assets', mainName);
  const rawDisk = fs.readFileSync(mainPath);

  const gz = await getRaw(`/app/pregnancyjournal/assets/${mainName}`, { 'Accept-Encoding': 'gzip' });
  assert(gz.status === 200, '带 gzip 请求主包返回 200');
  assert(gz.headers['content-encoding'] === 'gzip', '响应带 Content-Encoding: gzip');
  assert(/Accept-Encoding/.test(gz.headers.vary || ''), '响应带 Vary: Accept-Encoding（防代理串味）');

  const ratio = (1 - gz.body.length / rawDisk.length) * 100;
  assert(gz.body.length < rawDisk.length * 0.5, '压缩后体积不到原来一半',
    `${(rawDisk.length / 1048576).toFixed(2)}MB → ${(gz.body.length / 1048576).toFixed(2)}MB（省 ${ratio.toFixed(0)}%）`);

  let unzipped;
  try {
    unzipped = zlib.gunzipSync(gz.body);
  } catch (e) {
    unzipped = null;
  }
  assert(!!unzipped, 'gzip 响应能被正常解压（没压坏）');
  assert(unzipped && unzipped.equals(rawDisk), '解压后与磁盘原文件逐字节一致');

  // ---------- C. 缓存策略 ----------
  console.log('\nC. 缓存策略');
  assert(/immutable/.test(gz.headers['cache-control'] || ''), 'assets 带 immutable',
    `(${gz.headers['cache-control']})`);
  assert(/max-age=31536000/.test(gz.headers['cache-control'] || ''), 'assets 长缓存一年');
  assert(/no-store/.test(idx.headers['cache-control'] || ''), 'index.html 仍不缓存',
    `(${idx.headers['cache-control']})`);

  // ---------- D. 降级路径 ----------
  console.log('\nD. 不支持 gzip 的客户端');
  const plain = await getRaw(`/app/pregnancyjournal/assets/${mainName}`);
  assert(plain.status === 200, '不带 Accept-Encoding 也返回 200');
  assert(!plain.headers['content-encoding'], '未声明 gzip（原样发送）');
  assert(plain.body.equals(rawDisk), '原样响应与磁盘文件逐字节一致',
    `(${(plain.body.length / 1048576).toFixed(2)}MB)`);

  // ---------- E. 服务本身没被改坏 ----------
  console.log('\nE. 服务健康');
  const health = await getRaw('/app/pregnancyjournal/api/health');
  if (health.status === 200) {
    const h = JSON.parse(health.body.toString('utf8'));
    assert(h.status === 'ok', 'health 返回 ok');
    assert(h.version === '0.0.31', '版本号已同步到 0.0.31', `(实际 ${h.version})`);
    assert(h.routes >= 20, `路由全部加载 (${h.routes})`);
  } else {
    ng('health 接口', `status=${health.status}`);
  }

  // 图片等不可压缩类型不应被压缩
  const favicon = await getRaw('/app/pregnancyjournal/favicon.png', { 'Accept-Encoding': 'gzip' });
  assert(favicon.status === 200 && !favicon.headers['content-encoding'], '图片不被压缩（省 CPU）');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(50));

  child.kill('SIGKILL');
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
