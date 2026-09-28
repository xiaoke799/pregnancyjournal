/**
 * 端到端验证：日记插图（HEIC 支持 + 备份/恢复覆盖）
 *
 * 跑法：node e2e_diary_image.js
 *
 * 覆盖：
 *   1. HEIC 插图可上传 → 返回的 URL 指向转好的 .jpg；原 .heic 保留
 *   2. TIFF 被明确拒收（不再是一句 500）
 *   3. 超过 5MB 给友好提示
 *   4. 备份**包含**日记插图（files/diary/ + _file_map.diary）—— 此前完全没备份，恢复后插图会全丢
 *   5. 恢复能把插图放回去（文件名不变，日记正文里的 URL 才对得上）
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const SAMPLE_HEIC = path.join(require('./_env').FIXTURES, 'heic-test/sample.heic');
const PORT = Number(process.env.PJ_TCP_PORT || 38477);
const T = path.join(os.tmpdir(), 'pj-diary-image-e2e');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

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
  STATIC_DIR: path.join(ROOT, 'app/ui'),
};

function req(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function multipart(field, filePath, filename, contentType) {
  const boundary = '----pjdiary' + Date.now();
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const body = Buffer.concat(parts);
  return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const logFile = fs.openSync(path.join(T, 'server.log'), 'w');
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env: ENV, stdio: ['ignore', logFile, logFile] });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await req('GET', '/api/v1/health')).status === 200; } catch (e) { /* wait */ }
      if (!ready) await sleep(300);
    }
    if (!ready) { console.error('服务未启动'); process.exit(1); }
    console.log('服务已启动\n');

    const diaryDir = path.join(T, 'photos', 'diary');

    console.log('[1] HEIC 插图上传');
    const up = await req('POST', '/api/v1/daily-records/diary-image', multipart('file', SAMPLE_HEIC, 'IMG_0007.HEIC', 'image/heic'));
    const url = up.json?.data?.url;
    check('上传成功', up.status === 200 && up.json?.code === 0, JSON.stringify(up.json).slice(0, 160));
    check('返回的 URL 指向 .jpg', !!url && /\.jpg$/i.test(url), String(url));
    if (url) {
      const got = await req('GET', url);
      check('按该 URL 能取到图片', got.status === 200, String(got.status));
      check('返回的是 image/jpeg（浏览器能显示）', /image\/jpeg/.test(String(got.headers['content-type'])), String(got.headers['content-type']));
      check('响应带 nosniff', got.headers['x-content-type-options'] === 'nosniff', String(got.headers['x-content-type-options']));
      const jpgName = url.split('/').pop();
      check('.jpg 真实落盘', fs.existsSync(path.join(diaryDir, jpgName)));
      check('HEIC 原图保留（不删用户数据）', fs.existsSync(path.join(diaryDir, jpgName.replace(/\.jpg$/i, '.HEIC'))));
    }

    console.log('\n[2] 不支持的格式给明确提示');
    const tiffPath = path.join(T, 'x.tiff');
    fs.writeFileSync(tiffPath, Buffer.from('II*\u0000not-a-real-tiff', 'latin1'));
    const upT = await req('POST', '/api/v1/daily-records/diary-image', multipart('file', tiffPath, 'x.tiff', 'image/tiff'));
    check('TIFF 被拒且是 JSON 提示（不是 500）', upT.status === 200 && upT.json?.code === 1001 && /仅允许/.test(upT.json?.message || ''), `${upT.status} ${upT.json?.message}`);

    console.log('\n[3] 超限给友好提示');
    const bigPath = path.join(T, 'big.jpg');
    fs.writeFileSync(bigPath, Buffer.alloc(6 * 1024 * 1024));
    const upB = await req('POST', '/api/v1/daily-records/diary-image', multipart('file', bigPath, 'big.jpg', 'image/jpeg'));
    check('超 5MB 提示可读（不是 500）', upB.status === 200 && upB.json?.code === 1001 && /5MB/.test(upB.json?.message || ''), `${upB.status} ${upB.json?.message}`);

    console.log('\n[4] 备份包含日记插图');
    const bk = await req('POST', '/api/v1/backup', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const bkDir = bk.json?.data?.dir;
    check('备份成功', bk.status === 200 && bk.json?.code === 0, JSON.stringify(bk.json).slice(0, 160));
    const diaryBackupDir = bkDir ? path.join(bkDir, 'files', 'diary') : '';
    const diaryBackupFiles = diaryBackupDir && fs.existsSync(diaryBackupDir) ? fs.readdirSync(diaryBackupDir) : [];
    check('备份里有日记插图文件', diaryBackupFiles.length >= 1, JSON.stringify(diaryBackupFiles.slice(0, 4)));
    let map = null;
    try { map = JSON.parse(fs.readFileSync(path.join(bkDir, 'data.json'), 'utf8'))._file_map; } catch (e) { /* ignore */ }
    check('data.json 里记录了 _file_map.diary', !!map && !!map.diary && Object.keys(map.diary).length >= 1, JSON.stringify(map && map.diary));

    console.log('\n[5] 恢复能把插图放回去');
    const restoredName = diaryBackupFiles[0];
    if (restoredName) {
      const target = path.join(diaryDir, restoredName);
      fs.rmSync(target, { force: true });
      check('先删掉本地插图（模拟重装后）', !fs.existsSync(target));
      const rs = await req('POST', '/api/v1/restore', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: bkDir }),
      });
      check('恢复接口返回成功', rs.status === 200 && rs.json?.code === 0, JSON.stringify(rs.json).slice(0, 160));
      check('插图文件被恢复回来（文件名不变）', fs.existsSync(target), target);
    }
  } catch (e) {
    fail++;
    console.error('测试异常:', e.message);
  } finally {
    child.kill();
    await sleep(500);
    try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  console.log(`（临时数据: ${T}）`);
  process.exit(fail === 0 ? 0 : 1);
})();
