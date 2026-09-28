/**
 * 实测：起真实 server.js（tcp_shim 转 TCP），测
 *   1) 从进程启动到端口可连接的时间（= 冷启动阻塞时长）
 *   2) index.html / 主包 JS 的响应头（有无 gzip、缓存策略）与传输体积
 */
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const NODE_DIR = path.resolve(__dirname, '../../app/server/node');
const SHIM = path.resolve(__dirname, 'tcp_shim.js');
const PORT = 38499;

const tmpData = path.join(os.tmpdir(), 'pj_probe_' + Date.now());
fs.mkdirSync(tmpData, { recursive: true });
const sampleDb = path.resolve(__dirname, '../../data/pregnancy-journal.db');
if (fs.existsSync(sampleDb)) fs.copyFileSync(sampleDb, path.join(tmpData, 'pregnancyjournal.db'));

const t0 = Date.now();
const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
  cwd: NODE_DIR,
  env: {
    ...process.env,
    PJ_TCP_PORT: String(PORT),
    APP_MODE: 'fnos',
    STORAGE_DIR: tmpData,
    DATABASE_PATH: path.join(tmpData, 'pregnancyjournal.db'),
    STATIC_DIR: path.resolve(__dirname, '../../app/ui'),
    ASSETS_DIR: path.join(NODE_DIR, 'data'),
    TRIM_APPDEST: NODE_DIR,
    TRIM_PKGVAR: tmpData,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});

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

function req(urlPath, extraHeaders = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET', headers: extraHeaders },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => { bytes += c.length; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes, ms: Date.now() - start }));
      }
    );
    r.on('error', (e) => resolve({ error: e.message }));
    r.end();
  });
}

(async () => {
  const portMs = await waitPort(PORT);
  console.log('===== 1) 冷启动 =====');
  console.log(`  进程启动 → 端口可接受连接：${portMs} ms  （本机 i9；NAS/ARM 弱 CPU 需按数倍放大）`);

  console.log('\n===== 2) index.html =====');
  const idx = await req('/app/pregnancyjournal/');
  if (idx.error) { console.log('  错误:', idx.error); }
  else {
    console.log(`  状态 ${idx.status} | ${idx.bytes} B | ${idx.ms} ms`);
    console.log(`  Content-Type: ${idx.headers['content-type']}`);
    console.log(`  Cache-Control: ${idx.headers['cache-control']}`);
    console.log(`  Content-Encoding: ${idx.headers['content-encoding'] || '(无，即未压缩)'}`);
  }

  // 取主包文件名
  const html = fs.readFileSync(path.resolve(__dirname, '../../app/ui/index.html'), 'utf8');
  const m = html.match(/src="[^"]*\/assets\/(index-[^"]+\.js)"/);
  const mainJs = m ? m[1] : null;
  console.log('\n===== 3) 首屏主包 =====');
  if (!mainJs) console.log('  未找到主包');
  else {
    const disk = fs.statSync(path.resolve(__dirname, '../../app/ui/assets', mainJs)).size;
    const r1 = await req(`/app/pregnancyjournal/assets/${mainJs}`);
    console.log(`  文件: ${mainJs}`);
    console.log(`  磁盘 ${(disk / 1048576).toFixed(2)} MB → 网络传输 ${(r1.bytes / 1048576).toFixed(2)} MB  (${r1.ms} ms)`);
    console.log(`  Content-Encoding: ${r1.headers['content-encoding'] || '(无 = 未启用 gzip/brotli)'}`);
    console.log(`  Cache-Control: ${r1.headers['cache-control']}`);
    console.log(`  ETag: ${r1.headers['etag'] ? '有' : '无'}`);

    // 二次请求（带 If-None-Match）模拟"再次加载"
    const r2 = await req(`/app/pregnancyjournal/assets/${mainJs}`, { 'If-None-Match': r1.headers['etag'] });
    console.log(`  二次请求(带 ETag): 状态 ${r2.status} | ${r2.bytes} B | ${r2.ms} ms  ← 这就是"再次加载变快"的原因`);
  }

  console.log('\n===== 4) 首屏 API =====');
  const p = await req('/app/pregnancyjournal/api/v1/pregnancy/active');
  console.log(`  /api/v1/pregnancy/active → ${p.status} | ${p.bytes} B | ${p.ms} ms`);

  const d = await req('/app/pregnancyjournal/api/v1/dashboard?pregnancy_id=x');
  console.log(`  /api/v1/dashboard        → ${d.status} | ${d.bytes} B | ${d.ms} ms`);

  child.kill('SIGKILL');
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})();
