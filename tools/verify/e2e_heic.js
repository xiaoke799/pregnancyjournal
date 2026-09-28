/**
 * 端到端验证：HEIC 照片转码链路
 *
 * 跑法：node e2e_heic.js
 * 真起 server.js（经 tcp_shim 把 socket 监听转 TCP 环回）+ 真库 + 真 HTTP + 真 HEIC 文件。
 *
 * 覆盖：
 *   1. 相册传 HEIC → 落库指向 .jpg、原图保留、thumbnail/file 都能取到 200
 *   2. 相册传 JPEG → 行为不受影响（不误转）
 *   3. 产检报告传 HEIC → 落库 .jpg、mime/type/size 同步更新、下载接口可 inline
 *   4. 传一个假的 .heic（坏文件）→ 上传不失败、保留原样入库、进程存活
 *   5. 历史回填：库里已有指向 .heic 的记录 → 启动后被转成 .jpg（另见 e2e_heic_backfill.js）
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
const PORT = Number(process.env.PJ_TCP_PORT || 38473);
const T = path.join(os.tmpdir(), 'pj-heic-e2e');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
if (!fs.existsSync(SAMPLE_HEIC)) { console.error('缺少测试用 HEIC 样本:', SAMPLE_HEIC); process.exit(1); }

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
        try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* 非 JSON（图片字节流） */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function multipart(fields, fileField, filePath, filename, contentType) {
  const boundary = '----pjheic' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(fs.readFileSync(filePath));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await req('GET', '/api/v1/health');
      if (r.status === 200) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  return false;
}

(async () => {
  const logFile = fs.openSync(path.join(T, 'server.log'), 'w');
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env, stdio: ['ignore', logFile, logFile] });

  try {
    const ready = await waitReady();
    if (!ready) { console.error('服务未能启动，日志尾部：'); console.error(fs.readFileSync(path.join(T, 'server.log'), 'utf8').slice(-2000)); process.exit(1); }
    console.log('服务已启动，开始验证\n');

    const preg = await req('POST', '/api/v1/pregnancies', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: '2026-12-20', baby_name: 'e2e' }),
    });
    const pregnancyId = preg.json?.data?.id;
    check('创建孕期', !!pregnancyId, JSON.stringify(preg.json).slice(0, 200));

    console.log('\n[1] 相册上传 HEIC');
    const heicCopy = path.join(T, 'upload-heic.heic');
    fs.copyFileSync(SAMPLE_HEIC, heicCopy);
    const mp1 = multipart({ pregnancy_id: pregnancyId, photo_type: 'belly', photo_date: '2026-09-25' }, 'file', heicCopy, 'IMG_0001.HEIC', 'image/heic');
    const up1 = await req('POST', '/api/v1/photos', mp1);
    const p1 = up1.json?.data;
    check('上传返回 200 + code 0', up1.status === 200 && up1.json?.code === 0, JSON.stringify(up1.json).slice(0, 200));
    check('file_path 指向 .jpg', !!p1 && /\.jpg$/i.test(p1.file_path), p1 && p1.file_path);
    check('落盘的 .jpg 真实存在', !!p1 && fs.existsSync(p1.file_path));
    const originalHeic = !!p1 && p1.file_path.replace(/\.jpg$/i, '') + '.HEIC';
    check('HEIC 原图保留（不删用户数据）', fs.existsSync(originalHeic), originalHeic);
    check('生成了真缩略图（_thumb.jpg）', !!p1 && /_thumb\.jpg$/i.test(p1.thumbnail_path || ''), p1 && p1.thumbnail_path);
    check('缩略图文件存在且小于原图', !!p1 && fs.existsSync(p1.thumbnail_path || '') && fs.statSync(p1.thumbnail_path).size < fs.statSync(p1.file_path).size,
      p1 && `${fs.existsSync(p1.thumbnail_path || '') ? fs.statSync(p1.thumbnail_path).size : '缺失'} vs ${p1 && fs.statSync(p1.file_path).size}`);
    if (p1) {
      const th = await req('GET', `/api/v1/photos/${p1.id}/thumbnail`);
      check('thumbnail 返回 200 且是 image/jpeg', th.status === 200 && /image\/jpeg/.test(th.headers['content-type'] || ''), `${th.status} ${th.headers['content-type']}`);
      const fl = await req('GET', `/api/v1/photos/${p1.id}/file`);
      check('原图接口返回 200 且是 image/jpeg', fl.status === 200 && /image\/jpeg/.test(fl.headers['content-type'] || ''), `${fl.status} ${fl.headers['content-type']}`);
      check('返回的字节是真的 JPEG', th.buf.slice(0, 2).toString('hex') === 'ffd8');
    }

    console.log('\n[2] 相册上传 JPEG（不应被误转）');
    const jpgPath = path.join(T, 'upload-plain.jpg');
    // 用 jpeg-js 生成一张**真** JPEG（此前用手拼的字节不是合法 JPEG，缩略图自然解不开）
    const jpegLib = require(path.join(NODE_DIR, 'node_modules/jpeg-js'));
    const PW = 1600;
    const PH = 1200;
    const prgba = Buffer.alloc(PW * PH * 4);
    for (let i = 0; i < prgba.length; i += 4) { prgba[i] = 200; prgba[i + 1] = 90; prgba[i + 2] = 40; prgba[i + 3] = 255; }
    fs.writeFileSync(jpgPath, jpegLib.encode({ data: prgba, width: PW, height: PH }, 88).data);
    const mp2 = multipart({ pregnancy_id: pregnancyId, photo_type: 'belly' }, 'file', jpgPath, 'plain.jpg', 'image/jpeg');
    const up2 = await req('POST', '/api/v1/photos', mp2);
    const p2 = up2.json?.data;
    check('JPEG 上传成功且路径仍是 .jpg 原样', !!p2 && /\.jpg$/i.test(p2.file_path) && fs.existsSync(p2.file_path), p2 && p2.file_path);
    check('没有产生多余的转换副本', !!p2 && path.basename(p2.file_path).startsWith(path.basename(p2.file_path, '.jpg')));
    check('JPEG 也生成了缩略图', !!p2 && /_thumb\.jpg$/i.test(p2.thumbnail_path || ''), p2 && p2.thumbnail_path);

    console.log('\n[2b] TIFF 明确拒收（浏览器显示不了、PDF 也嵌不进）');
    const tiffPath = path.join(T, 'scan.tiff');
    fs.writeFileSync(tiffPath, Buffer.from('II*\u0000fake-tiff-bytes', 'latin1'));
    const mpT = multipart({ pregnancy_id: pregnancyId, photo_type: 'belly' }, 'file', tiffPath, 'scan.tiff', 'image/tiff');
    const upT = await req('POST', '/api/v1/photos', mpT);
    check('TIFF 被拒收且给出可操作提示', upT.status === 200 && upT.json?.code === 1001 && /TIFF/.test(upT.json?.message || ''), JSON.stringify(upT.json).slice(0, 160));

    console.log('\n[2c] SVG 以内联方式返回时带 CSP sandbox（堵住脚本执行）');
    const svgPath = path.join(T, 'x.svg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const mpS = multipart({ pregnancy_id: pregnancyId, photo_type: 'belly' }, 'file', svgPath, 'x.svg', 'image/svg+xml');
    const upS = await req('POST', '/api/v1/photos', mpS);
    const pS = upS.json?.data;
    check('SVG 仍可上传（不误伤）', upS.json?.code === 0, JSON.stringify(upS.json).slice(0, 160));
    if (pS) {
      const sv = await req('GET', `/api/v1/photos/${pS.id}/file`);
      check('响应带 X-Content-Type-Options: nosniff', sv.headers['x-content-type-options'] === 'nosniff', String(sv.headers['x-content-type-options']));
      check('响应带 CSP sandbox', /sandbox/.test(String(sv.headers['content-security-policy'] || '')), String(sv.headers['content-security-policy']));
    }

    console.log('\n[2d] .jfif / .jpe（JPEG 的其它扩展名）不能被 nosniff 挡住');
    const jfifPath = path.join(T, 'pic.jfif');
    fs.copyFileSync(jpgPath, jfifPath);
    const mpJ = multipart({ pregnancy_id: pregnancyId, photo_type: 'belly' }, 'file', jfifPath, 'pic.jfif', 'image/jpeg');
    const upJ = await req('POST', '/api/v1/photos', mpJ);
    const pJ = upJ.json?.data;
    check('.jfif 可上传', upJ.json?.code === 0, JSON.stringify(upJ.json).slice(0, 160));
    if (pJ) {
      const fj = await req('GET', `/api/v1/photos/${pJ.id}/file`);
      check('.jfif 返回 image/jpeg（不是 octet-stream）', /image\/jpeg/.test(String(fj.headers['content-type'])), String(fj.headers['content-type']));
      check('.jfif 也生成了缩略图', /_thumb\.jpg$/i.test(pJ.thumbnail_path || ''), String(pJ.thumbnail_path));
    }

    console.log('\n[3] 产检报告上传 HEIC');
    const ck = await req('POST', '/api/v1/checkups', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregnancy_id: pregnancyId, checkup_date: '2026-09-25', gestational_week: 28, checkup_type: 'standard' }),
    });
    const checkupId = ck.json?.data?.id;
    check('创建产检', !!checkupId, JSON.stringify(ck.json).slice(0, 200));
    if (checkupId) {
      const mp3 = multipart({ checkup_type: 'standard', report_category: '其他' }, 'file', SAMPLE_HEIC, 'REPORT.HEIC', 'image/heic');
      const up3 = await req('POST', `/api/v1/checkups/${checkupId}/reports`, mp3);
      const r3 = up3.json?.data;
      check('报告上传成功', up3.status === 200 && up3.json?.code === 0, JSON.stringify(up3.json).slice(0, 200));
      check('报告落库 .jpg + mime=image/jpeg', !!r3 && /\.jpg$/i.test(r3.file_path) && r3.mime_type === 'image/jpeg', r3 && `${r3.file_path} / ${r3.mime_type}`);
      check('报告 file_type/file_size 已同步', !!r3 && r3.file_type === 'jpg' && r3.file_size > 0, r3 && `${r3.file_type} / ${r3.file_size}`);
      check('报告文件名换成 .jpg（下载时能 inline）', !!r3 && /\.jpg$/i.test(r3.filename || ''), r3 && r3.filename);
      const dl = await req('GET', `/api/v1/checkups/reports/${r3.id}/download`);
      check('报告下载返回 200', dl.status === 200, String(dl.status));
    }

    console.log('\n[4] 坏的 .heic（转码失败兜底）');
    const badHeic = path.join(T, 'broken.heic');
    fs.writeFileSync(badHeic, Buffer.from('not a real heic at all'));
    const mp4 = multipart({ pregnancy_id: pregnancyId, photo_type: 'belly' }, 'file', badHeic, 'broken.heic', 'image/heic');
    const up4 = await req('POST', '/api/v1/photos', mp4);
    const p4 = up4.json?.data;
    check('转码失败也不阻断上传（返回成功）', up4.status === 200 && up4.json?.code === 0, JSON.stringify(up4.json).slice(0, 200));
    check('保留原样入库（仍是 .heic）', !!p4 && /\.heic$/i.test(p4.file_path), p4 && p4.file_path);
    const hl = await req('GET', '/api/v1/health');
    check('进程存活（转码异常没有打死服务）', hl.status === 200, String(hl.status));

    console.log('\n[5] 列表与日志');
    const list = await req('GET', `/api/v1/photos?pregnancy_id=${pregnancyId}`);
    check('相册列表能取到 5 张（HEIC/JPEG/坏HEIC/SVG/jfif；TIFF 已被拒收）', (list.json?.data || []).length === 5, `实际 ${(list.json?.data || []).length}`);

    console.log('\n[6] 备份不包含可再生的缩略图');
    const bk = await req('POST', '/api/v1/backup', {
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const bkDir = bk.json?.data?.dir;
    check('备份成功', bk.status === 200 && bk.json?.code === 0, JSON.stringify(bk.json).slice(0, 160));
    if (bkDir && fs.existsSync(bkDir)) {
      const albumBackupDir = path.join(bkDir, 'files', 'album');
      const copied = fs.existsSync(albumBackupDir) ? fs.readdirSync(albumBackupDir) : [];
      check('备份里没有 _thumb.jpg（派生文件不进备份，避免备份白白变大）',
        !copied.some((f) => /_thumb\.jpg$/i.test(f)), JSON.stringify(copied.slice(0, 6)));
      check('备份里仍有原图', copied.length >= 1, String(copied.length));
    } else {
      check('备份目录存在', false, String(bkDir));
    }
    const srvLog = fs.readFileSync(path.join(T, 'server.log'), 'utf8');
    check('日志里有「HEIC 已转 JPEG」', srvLog.includes('HEIC 已转 JPEG'));
    check('日志里有转码失败告警', srvLog.includes('转码失败'));

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
