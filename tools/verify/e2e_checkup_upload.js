/**
 * 端到端验证：向「产检时间表条目」上传报告附件
 *
 * 用法：node e2e_checkup_upload.js <expect>     expect = fail | ok
 * 跑法：真起 server.js（经 tcp_shim 把 socket 监听转 TCP 环回）+ 真库 + 真 HTTP
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXPECT = process.argv[2] || 'ok';
const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
// 注意：本机安全策略禁止在工作区目录下监听 Unix Socket（listen EACCES），
// 且 unix socket 路径上限约 100 字符，故临时目录放系统 TEMP。
const T = path.join(os.tmpdir(), 'pj-e2e');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
const SOCK = path.join(T, 'a.sock'); // 仅作占位，实际走 TCP
const PORT = Number(process.env.PJ_TCP_PORT || 38471);

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: SOCK,
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
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 300) });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function multipart(fields, fileField, filename, contentType, fileBuf) {
  const B = '----pjboundary' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(fileBuf);
  parts.push(Buffer.from(`\r\n--${B}--\r\n`));
  return { body: Buffer.concat(parts), ct: `multipart/form-data; boundary=${B}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));

  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  // 等 socket 就绪
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const r = await req('GET', '/api/v1/health');
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* 还没起来 */ }
  }
  if (!ready) {
    console.log('服务未就绪。server 输出末尾：\n' + srvLog.slice(-1500));
    cleanup(); process.exit(2);
  }

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

  // 建孕期档案
  const p1 = await req('POST', '/api/v1/pregnancies', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_period_date: '2026-01-01', due_date: '2026-10-08' }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) {
    const pa = await req('GET', '/api/v1/pregnancies/active');
    pid = pa.json && pa.json.data && pa.json.data.id;
  }
  check('建孕期档案', !!pid, pid || JSON.stringify(p1.json).slice(0, 160));

  // 上传报告到「产检条目」cs_003（NT检查）
  const mp = multipart(
    { checkup_type: 'standard', report_category: '其他' },
    'file', 'nt.png', 'image/png', PNG
  );
  const up = await req('POST', '/api/v1/checkups/cs_003/reports', {
    headers: { 'Content-Type': mp.ct, 'Content-Length': mp.body.length },
    body: mp.body,
  });
  const upMsg = up.json && up.json.message;
  const upOk = up.json && up.json.code === 0;
  console.log(`\n[上传 cs_003 报告] HTTP ${up.status}  message=${upMsg}`);
  check('上传到条目 cs_003 成功', upOk, `code=${up.json && up.json.code} message=${upMsg}`);

  // 列报告
  const ls = await req('GET', '/api/v1/checkups/cs_003/reports?checkup_type=standard');
  const n = ls.json && Array.isArray(ls.json.data) ? ls.json.data.length : -1;
  console.log(`[列出 cs_003 报告] 数量=${n}`);
  check('能读回刚上传的报告', n === 1, `数量=${n}`);

  // 文件是否真落盘
  const dir = path.join(T, 'photos', 'checkups', 'cs_003', 'reports');
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
  check('文件已落盘到 photos/checkups/cs_003/reports', onDisk === 1, `目录内文件数=${onDisk}`);

  // 路径穿越必须仍被拒绝
  const trav = await req('POST', '/api/v1/checkups/..%2F..%2Fevil/reports', {
    headers: { 'Content-Type': mp.ct, 'Content-Length': mp.body.length },
    body: mp.body,
  });
  const travMsg = trav.json && trav.json.message;
  console.log(`[穿越尝试 ..%2F..%2Fevil] message=${travMsg}`);
  check('路径穿越仍被拒绝', !(trav.json && trav.json.code === 0), `message=${travMsg}`);

  // 子项上传（前端另一条路径）
  const mp2 = multipart(
    { checkup_type: 'standard', report_category: '超声', sub_item: 'NT测量' },
    'file', 'nt2.png', 'image/png', PNG
  );
  const up2 = await req('POST', '/api/v1/checkups/cs_003/reports', {
    headers: { 'Content-Type': mp2.ct, 'Content-Length': mp2.body.length },
    body: mp2.body,
  });
  const up2Ok = up2.json && up2.json.code === 0;
  console.log(`[子项上传] message=${up2.json && up2.json.message}`);
  check('带 sub_item 的子项上传成功', up2Ok, `code=${up2.json && up2.json.code}`);

  // 自定义产检（真 UUID）必须仍然可用
  const cu = await req('POST', '/api/v1/checkups/custom', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregnancy_id: pid, name: '自费加做检查', checkup_date: '2026-06-01' }),
  });
  const cid = cu.json && cu.json.data && cu.json.data.id;
  let uuidOk = false;
  if (cid) {
    const mp3 = multipart(
      { checkup_type: 'custom', report_category: '其他' }, 'file', 'c.png', 'image/png', PNG
    );
    const up3 = await req('POST', `/api/v1/checkups/${cid}/reports`, {
      headers: { 'Content-Type': mp3.ct, 'Content-Length': mp3.body.length },
      body: mp3.body,
    });
    uuidOk = up3.json && up3.json.code === 0;
    console.log(`[自定义产检上传] message=${up3.json && up3.json.message}`);
  }
  check('自定义产检(UUID)上传仍正常', uuidOk, cid ? '' : '未能创建自定义产检');

  console.log('\n================ 结果 ================');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`  ${r.pass ? '[OK]  ' : '[FAIL]'} ${r.name}  ${r.detail || ''}`);
  }
  console.log(`\n期望=${EXPECT}  实际=${allPass ? 'ok' : 'fail'}`);

  cleanup();
  process.exit(allPass === (EXPECT === 'ok') ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(3); });
