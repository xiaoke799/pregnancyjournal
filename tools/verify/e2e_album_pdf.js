/**
 * 端到端验证：相册 PDF 导出对「pdfkit 嵌不进去的格式」回退用缩略图
 *
 * 跑法：node e2e_album_pdf.js
 *
 * 场景（真实痛点）：pdfkit 0.19 只认 JPEG / PNG 的魔数，WebP / GIF / BMP / AVIF 一律抛
 * `Unknown image format`，导出件里就留一个「无法加载」的占位框。
 * 现在改成：原图嵌不进 → 退回用我们的 JPEG 缩略图（缩略图一定是 JPEG）。
 *
 * 判据：PDF 字节里 `/Subtype /Image` 的次数
 *   - 有缩略图的那张 → 应该嵌进去（计数 +1）
 *   - 只有 WebP、没缩略图的那张 → 占位框是矢量矩形，不产生 /Subtype /Image
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const PORT = Number(process.env.PJ_TCP_PORT || 38475);
const T = path.join(os.tmpdir(), 'pj-album-pdf-e2e');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENV = {
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
  LOG_LEVEL: 'WARN',
  STATIC_DIR: path.join(ROOT, 'app/ui'),
};

// ---------- 阶段 1：离线建库（独立的 node 进程，避免与服务端抢 sql.js 实例） ----------
async function setup() {
  fs.rmSync(T, { recursive: true, force: true });
  const albumDir = path.join(T, 'photos', 'album', '2026', '09');
  fs.mkdirSync(albumDir, { recursive: true });

  const jpegLib = require(path.join(NODE_DIR, 'node_modules/jpeg-js'));
  const W = 640, H = 480;
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 120; rgba[i + 1] = 60; rgba[i + 2] = 180; rgba[i + 3] = 255; }
  const thumbJpg = path.join(albumDir, 'withthumb_thumb.jpg');
  fs.writeFileSync(thumbJpg, jpegLib.encode({ data: rgba, width: W, height: H }, 80).data);

  const fakeWebp1 = path.join(albumDir, 'withthumb.webp');
  const fakeWebp2 = path.join(albumDir, 'nothumb.webp');
  fs.writeFileSync(fakeWebp1, Buffer.from('RIFF____WEBPVP8 ______not-a-real-webp______'));
  fs.writeFileSync(fakeWebp2, Buffer.from('RIFF____WEBPVP8 ______not-a-real-webp______'));

  Object.assign(process.env, ENV);
  const db = require(path.join(NODE_DIR, 'db'));
  await db.initDb();
  const pregId = db.generateId();
  db.run("INSERT INTO pregnancy (id, last_period_date, due_date, is_active, created_at, updated_at) VALUES (?, '2026-03-15', '2026-12-20', 1, datetime('now'), datetime('now'))", [pregId]);
  const p1 = db.generateId();
  db.run("INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, gestational_week, note, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'photo', 20, '有缩略图', datetime('now'), datetime('now'))", [p1, pregId, fakeWebp1, thumbJpg]);
  const p2 = db.generateId();
  db.run("INSERT INTO pregnancy_photo (id, pregnancy_id, photo_type, file_path, thumbnail_path, media_type, gestational_week, note, created_at, updated_at) VALUES (?, ?, 'belly', ?, ?, 'photo', 21, '无缩略图', datetime('now'), datetime('now'))", [p2, pregId, fakeWebp2, fakeWebp2]);
  db.saveDb();
  fs.writeFileSync(path.join(T, 'preg_id.txt'), pregId);
  console.log('建库完成，孕期 id =', pregId);
}

function req(method, urlPath) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

// ---------- 阶段 2：起真服务，导 PDF ----------
async function run() {
  const pregId = fs.readFileSync(path.join(T, 'preg_id.txt'), 'utf8').trim();
  const logFile = fs.openSync(path.join(T, 'server.log'), 'w');
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env: ENV, stdio: ['ignore', logFile, logFile] });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await req('GET', '/api/v1/health')).status === 200; } catch (e) { /* wait */ }
      if (!ready) await sleep(300);
    }
    if (!ready) { console.error('服务未启动'); process.exitCode = 1; return; }
    console.log('服务已启动\n');

    const pdf = await req('GET', `/api/v1/export/album-pdf?pregnancy_id=${pregId}`);
    check('相册 PDF 导出返回 200', pdf.status === 200, String(pdf.status));
    check('返回的是 PDF', pdf.buf.slice(0, 5).toString('latin1') === '%PDF-', pdf.buf.slice(0, 8).toString('latin1'));
    const imgCount = (pdf.buf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
    check('有缩略图的那张被嵌进了 PDF', imgCount >= 1, `/Subtype /Image 出现 ${imgCount} 次`);
    check('没有缩略图的那张不产生图片（仍为占位框）', imgCount === 1, `期望恰好 1 张，实际 ${imgCount} 张`);
    check('进程存活', (await req('GET', '/api/v1/health')).status === 200);
    const logText = fs.readFileSync(path.join(T, 'server.log'), 'utf8');
    check('日志记录了回退（尝试下一个候选）', logText.includes('嵌入失败') || logText.includes('尝试下一个候选'), '（未命中也不影响结论）');
  } finally {
    child.kill();
    await sleep(400);
    try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
}

(async () => {
  if (process.argv[2] === 'setup') {
    await setup();
    process.exit(0);
  }
  fs.rmSync(T, { recursive: true, force: true });
  const st = spawn(process.execPath, [__filename, 'setup'], { stdio: 'inherit' });
  await new Promise((r) => st.on('exit', r));
  await run();
  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  console.log(`（临时数据: ${T}）`);
  process.exit(fail === 0 ? 0 : 1);
})();
