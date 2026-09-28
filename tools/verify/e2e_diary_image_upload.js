/**
 * 日记插图上传：端到端测试（含「字段名」契约）
 *
 * 背景（用户拿日志来问的那个问题）：
 *   日志里反复出现 `[daily-record] 日记插图上传失败: Unexpected field`，HTTP 却是 200。
 *   根因：multer 用 `upload.single('image')`，而**前端传的字段名是 'file'**
 *   （本项目所有上传接口都是 'file'）⇒ multer 抛 `Unexpected field`，插图从来没上传成功过。
 *
 * 本脚本真的走一遍 multipart 上传：
 *   ① 用 'file' 字段上传 → 必须成功，且文件真的落到相册 diary 目录、返回的 URL 能取回原图；
 *   ② 用 'image' 字段上传 → **必须失败**（内建对照：证明这个测试真的在验字段名，
 *      而不是"反正都能过"）；
 *   ③ 不支持的图片类型 → 必须被友好拒绝。
 *
 * 用法：node e2e_diary_image_upload.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-diaryimg-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38495);
const PHOTOS = path.join(T, 'photos');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: PHOTOS,
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
};

/** 手搓一个 multipart/form-data 请求体（不引第三方依赖） */
function buildMultipart({ field, filename, contentType, data, extraFields = {} }) {
  const boundary = '----wb' + Date.now() + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(extraFields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function req(method, urlPath, { headers = {}, body = null, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (raw) return resolve({ status: res.statusCode, buf, headers: res.headers });
        try { resolve({ status: res.statusCode, json: JSON.parse(buf.toString('utf8')), buf }); }
        catch { resolve({ status: res.statusCode, json: null, raw: buf.toString('utf8') }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  [OK]   ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${extra ? '  ← ' + extra : ''}`); }
}

// 一个最小的合法 PNG（1x1 透明像素）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const srvLog = [];
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env });
  child.stdout.on('data', (d) => srvLog.push(String(d)));
  child.stderr.on('data', (d) => srvLog.push(String(d)));

  for (let i = 0; i < 40; i++) {
    try { const h = await req('GET', '/api/health'); if (h.json && h.json.status === 'ok') break; } catch {}
    await sleep(500);
  }

  try {
    console.log('\n########## 1. 用正确字段名 file 上传（修复后应成功）##########');
    const ok = buildMultipart({ field: 'file', filename: 'test.png', contentType: 'image/png', data: PNG });
    const up = await req('POST', '/api/v1/daily-records/diary-image', {
      headers: { 'Content-Type': ok.contentType, 'Content-Length': ok.body.length },
      body: ok.body,
    });
    check('上传接口返回成功', !!(up.json && up.json.code === 0),
      JSON.stringify(up.json && up.json.message));
    const url = (up.json && up.json.data && up.json.data.url) || '';
    check('返回了图片地址', !!url, url);

    const savedName = url.split('/').pop();
    const savedPath = path.join(PHOTOS, 'diary', savedName);
    check('文件真的落到了相册 diary 目录', !!savedName && fs.existsSync(savedPath),
      savedPath);
    check('落盘内容与上传字节一致',
      fs.existsSync(savedPath) && Buffer.compare(fs.readFileSync(savedPath), PNG) === 0,
      fs.existsSync(savedPath) ? `尺寸 ${fs.statSync(savedPath).size}B` : '文件不存在');

    console.log('\n########## 2. 取回图片（前端插进日记用的就是这个地址）##########');
    const got = await req('GET', url, { raw: true });
    check('取回成功且是图片字节', got.status === 200 && Buffer.compare(got.buf, PNG) === 0,
      `status=${got.status} size=${got.buf ? got.buf.length : 0}`);

    console.log('\n########## 3. 内建对照：换回旧的错误字段名 image 应被拒 ##########');
    const bad = buildMultipart({ field: 'image', filename: 'test.png', contentType: 'image/png', data: PNG });
    const up2 = await req('POST', '/api/v1/daily-records/diary-image', {
      headers: { 'Content-Type': bad.contentType, 'Content-Length': bad.body.length },
      body: bad.body,
    });
    check('字段名不对时会被拒绝（说明测试确实在验字段名）',
      !(up2.json && up2.json.code === 0),
      `code=${up2.json && up2.json.code} msg=${JSON.stringify(up2.json && up2.json.message)}`);

    console.log('\n########## 4. 不支持的格式应被友好拒绝 ##########');
    const badType = buildMultipart({
      field: 'file', filename: 'note.txt', contentType: 'text/plain',
      data: Buffer.from('这不是图片'),
    });
    const up3 = await req('POST', '/api/v1/daily-records/diary-image', {
      headers: { 'Content-Type': badType.contentType, 'Content-Length': badType.body.length },
      body: badType.body,
    });
    check('非图片被拒绝且给了友好提示',
      !(up3.json && up3.json.code === 0) && /仅允许|图片/.test(String(up3.json && up3.json.message || '')),
      JSON.stringify(up3.json && up3.json.message));

    // 服务端日志里不应再出现 Unexpected field
    const unexpected = srvLog.join('').match(/Unexpected field/g);
    check('服务端日志里不再出现 Unexpected field（除第 3 步的对照外）',
      !unexpected || unexpected.length <= 1, `出现 ${unexpected ? unexpected.length : 0} 次`);
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.join('').slice(-1200));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();
