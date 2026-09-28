/**
 * 端到端验证：数据导出三件套（CSV / 日记 PDF / 纪念册 PDF）的手机端下载路径
 *
 * 跑法：node e2e_export_mobile.js
 *
 * 手机端的做法是：先用 `?check=1` 问一句「有没有数据」（只数条数、不生成文件），
 * 有数据再把**接口地址直接交给浏览器**下载（响应带 Content-Disposition: attachment）。
 * 因此要验证三件事：
 *   1. 三个 `check=1` 预检都能返回条数，且**不会生成文件**（快）
 *   2. 没有数据时预检返回 count=0（前端据此提示，不会让用户下载到一个错误页）
 *   3. 真实下载响应带 `attachment` + RFC 5987 的 `filename*=UTF-8''`（中文名不会变成 %E5%AD…）
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const PORT = Number(process.env.PJ_TCP_PORT || 38479);
const T = path.join(os.tmpdir(), 'pj-export-mobile-e2e');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function multipart(fields, fileField, filePath, filename, contentType) {
  const boundary = '----pjexp' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(fs.readFileSync(filePath));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) } };
}

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

    // ---- 造点数据：孕期 + 一条记录 + 一篇日记 + 一张照片 ----
    const preg = await req('POST', '/api/v1/pregnancies', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: '2026-12-20', baby_name: 'e2e' }),
    });
    const pid = preg.json?.data?.id;
    check('创建孕期', !!pid, JSON.stringify(preg.json).slice(0, 120));

    await req('PUT', '/api/v1/pregnancies', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: '2026-12-20', baby_name: 'e2e' }),
    });
    await req('POST', '/api/v1/daily-records', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregnancy_id: pid, record_date: '2026-09-26', weight: 60.5, note: 'export-e2e' }),
    });
    await req('POST', '/api/v1/diaries', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregnancy_id: pid, entry_date: '2026-09-26', content: '<p>今天很有精神</p>', mood: 'happy' }),
    });
    const jpegLib = require(path.join(NODE_DIR, 'node_modules/jpeg-js'));
    const W = 800, H = 600;
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 90; rgba[i + 1] = 140; rgba[i + 2] = 200; rgba[i + 3] = 255; }
    const jpg = path.join(T, 'p.jpg');
    fs.writeFileSync(jpg, jpegLib.encode({ data: rgba, width: W, height: H }, 85).data);
    const up = await req('POST', '/api/v1/photos', multipart({ pregnancy_id: pid, photo_type: 'belly' }, 'file', jpg, 'p.jpg', 'image/jpeg'));
    check('准备数据（记录/日记/照片）', up.json?.code === 0, JSON.stringify(up.json).slice(0, 120));

    console.log('\n[1] 预检（check=1）：只数条数、不生成文件');
    for (const [name, ep] of [['CSV', 'csv'], ['日记 PDF', 'diary-pdf'], ['纪念册 PDF', 'album-pdf']]) {
      const t0 = Date.now();
      const r = await req('GET', `/api/v1/export/${ep}?pregnancy_id=${pid}&check=1`);
      const ms = Date.now() - t0;
      check(`${name} 预检返回 count>0`, r.json?.code === 0 && Number(r.json?.data?.count) > 0, JSON.stringify(r.json).slice(0, 120));
      check(`${name} 预检很快（没有真的生成文件）`, ms < 800, `${ms}ms`);
      check(`${name} 预检响应是 JSON（不是文件）`, /application\/json/.test(String(r.headers['content-type'])), String(r.headers['content-type']));
    }

    console.log('\n[2] 无数据时预检 count=0（前端据此提示，不会下载到错误页）');
    const empty = await req('GET', '/api/v1/export/csv?pregnancy_id=no-such-pregnancy&check=1');
    check('空数据预检 count=0 且 code=0', empty.json?.code === 0 && Number(empty.json?.data?.count) === 0, JSON.stringify(empty.json).slice(0, 120));

    console.log('\n[3] 真实下载：响应头必须能被浏览器当附件下载，中文名用 RFC 5987');
    const csv = await req('GET', `/api/v1/export/csv?pregnancy_id=${pid}`);
    check('CSV 返回 200', csv.status === 200, String(csv.status));
    const cdCsv = String(csv.headers['content-disposition'] || '');
    check('CSV 带 attachment', /attachment/.test(cdCsv), cdCsv.slice(0, 120));
    check("CSV 带 filename*=UTF-8''（中文名不会变 %E5%AD…）", /filename\*=UTF-8''/.test(cdCsv), cdCsv.slice(0, 160));
    check('CSV 正文非空且是 UTF-8 BOM 开头', csv.buf.length > 3 && csv.buf[0] === 0xef && csv.buf[1] === 0xbb && csv.buf[2] === 0xbf, csv.buf.slice(0, 6).toString('hex'));

    const dpdf = await req('GET', `/api/v1/export/diary-pdf?pregnancy_id=${pid}`);
    check('日记 PDF 返回 200 且是 PDF', dpdf.status === 200 && dpdf.buf.slice(0, 5).toString('latin1') === '%PDF-', `${dpdf.status} ${dpdf.buf.slice(0, 5).toString('latin1')}`);
    check("日记 PDF 带 filename*=UTF-8''", /filename\*=UTF-8''/.test(String(dpdf.headers['content-disposition'] || '')), String(dpdf.headers['content-disposition']).slice(0, 160));

    const apdf = await req('GET', `/api/v1/export/album-pdf?pregnancy_id=${pid}`);
    check('纪念册 PDF 返回 200 且是 PDF', apdf.status === 200 && apdf.buf.slice(0, 5).toString('latin1') === '%PDF-', `${apdf.status}`);
    check("纪念册 PDF 带 filename*=UTF-8''", /filename\*=UTF-8''/.test(String(apdf.headers['content-disposition'] || '')), String(apdf.headers['content-disposition']).slice(0, 160));

    console.log('\n[4] 进程存活');
    check('服务仍然健康', (await req('GET', '/api/v1/health')).status === 200);
  } catch (e) {
    fail++;
    console.error('测试异常:', e.message);
  } finally {
    child.kill();
    await sleep(400);
    try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  console.log(`（临时数据: ${T}）`);
  process.exit(fail === 0 ? 0 : 1);
})();
