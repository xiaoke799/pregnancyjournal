// 测试 #13：错误信息脱敏（server.js 出口中间件）端到端验证
// 做法：用真实 server.js 起两个实例（fnos 生产模式 / dev 开发模式），
//       用同一组「会产生敏感错误」的请求打进去，对比 message 差异。
// 这样既验证了脱敏生效，也用 dev 侧证明「这条请求原本确实会泄露原文」——即反例对照。
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const SERVER_DIR = require('./_env').SERVER_DIR;
const NODE = require('./_env').NODE;
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const BASE = require('./_env').TMP;

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

function req(port, method, p, body, headers = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const h = { 'X-Trim-Userid': '1000', 'X-Trim-Username': 'tester', 'X-Trim-Isadmin': 'true', ...headers };
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, raw: d, json: j }); });
    });
    r.on('error', e => resolve({ status: 0, raw: 'ERR ' + e.message, json: null }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function waitReady(port, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await req(port, 'GET', '/api/health');
    if (r.status === 200) return true;
    await new Promise(rr => setTimeout(rr, 300));
  }
  return false;
}

function startServer(mode, port, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    APP_MODE: mode,
    PJ_TCP_PORT: String(port),
    STORAGE_DIR: dir,
    DATA_DIR: dir,
    PHOTOS_DIR: path.join(dir, 'photos'),
    MEDIA_DIR: path.join(dir, 'media'),
    DATABASE_PATH: path.join(dir, 'pj.db'),
  };
  const child = spawn(NODE, ['-r', SHIM, path.join(SERVER_DIR, 'server.js')], {
    cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => out += d);
  return { child, log: () => out };
}

// 这组请求会产生「含内部细节」的错误
const SENSITIVE_PROBES = [
  { name: 'FK 约束失败（孤儿 pregnancy_id）', method: 'POST', path: '/api/v1/habit-checkins', body: { pregnancy_id: 'NOT-EXIST-PG', date: '2026-09-28', items: [] } },
];
// 这组是正常业务文案，绝不能被脱敏
const BUSINESS_PROBES = [
  { name: '参数缺失提示', method: 'POST', path: '/api/v1/habit-checkins', body: { pregnancy_id: 'pg', /* 缺 date */ } },
  { name: '缺 pregnancy_id 提示', method: 'GET', path: '/api/v1/habit-checkins/by-date/2026-09-28' },
  { name: '记录不存在提示', method: 'GET', path: '/api/v1/habit-checkins/no-such-id-xyz' },
  { name: '上传校验提示（请上传文件）', method: 'POST', path: '/api/v1/photos', body: { pregnancy_id: 'NA', photo_type: null } },
];

(async () => {
  const PORT_PROD = Number(process.env.PJ_PROD_PORT || 38473);
  const PORT_DEV = Number(process.env.PJ_DEV_PORT || 38474);
  const DIR_PROD = path.join(BASE, 'tmp_m_prod');
  const DIR_DEV = path.join(BASE, 'tmp_m_dev');

  const prod = startServer('fnos', PORT_PROD, DIR_PROD);
  const dev = startServer('dev', PORT_DEV, DIR_DEV);

  const rp = await waitReady(PORT_PROD);
  const rd = await waitReady(PORT_DEV);
  if (!rp || !rd) {
    console.log('🔴 服务未就绪  prod=' + rp + ' dev=' + rd);
    console.log(prod.log().slice(-2000));
    console.log(dev.log().slice(-2000));
    prod.child.kill(); dev.child.kill();
    process.exit(1);
  }

  console.log('=== N1：生产模式（APP_MODE=fnos）——敏感错误被脱敏 ===');
  for (const p of SENSITIVE_PROBES) {
    const r = await req(PORT_PROD, p.method, p.path, p.body);
    const msg = (r.json && r.json.message) || r.raw;
    const leaked = /sqlite|no such (table|column)|constraint failed|SQL logic error|malformed|[A-Za-z]:[\\/]|database is locked/i.test(msg);
    ok(!leaked, `【关键】${p.name} → 不泄露内部细节`, msg);
    ok(/操作失败，请稍后重试/.test(msg) || msg === 'success', `${p.name} → 返回通用文案`, msg);
  }

  console.log('=== N2：开发模式（APP_MODE=dev）——原文放行（反例对照）===');
  let devLeakedCount = 0;
  for (const p of SENSITIVE_PROBES) {
    const r = await req(PORT_DEV, p.method, p.path, p.body);
    const msg = (r.json && r.json.message) || r.raw;
    const leaked = /constraint failed|no such (table|column)|sqlite/i.test(msg);
    if (leaked) devLeakedCount++;
    console.log(`     · ${p.name} → dev 原文: ${String(msg).slice(0, 90)}`);
  }
  ok(devLeakedCount > 0, '【反例】dev 模式确实会输出原始 SQL 报错（证明脱敏中间件真的在起作用）', devLeakedCount);

  console.log('=== N2b：从 server.js 源码取出真实正则，逐条验证覆盖面（路径/系统码分支）===');
  {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf-8');
    const m = src.match(/const SENSITIVE_MSG_RE = (\/.*?\/i);/);
    ok(!!m, '能从源码中提取到 SENSITIVE_MSG_RE');
    const re = eval(m[1]);
    const mustMatch = [
      'FOREIGN KEY constraint failed',
      'no such column: foo',
      'SQL logic error',
      'malformed database file',
      'unable to open database file',
      'database is locked',
      'ENOENT: no such file or directory, open \'D:\\pregnancy-journal\\x.db\'',
      'EACCES: permission denied',
      'EPERM: operation not permitted',
      'ENOTDIR: not a directory',
      'EMFILE: too many open files',
      'open \'/vol1/@appdata/pregnancyjournal/data/pj.db\'',
      'open \'/usr/local/app/x\'',
      'the file is at /tmp/x',
      // 盘符这一支加了 \b 之后仍必须命中：前面是空白、中文、引号、行首都要覆盖到
      'cannot write to D:\\appdata\\pregnancyjournal\\data\\pj.db',
      '打开 C:/temp/a.txt 失败',
      'C:\\x',
      '"E:/data/pj.db"',
    ];
    for (const s of mustMatch) ok(re.test(s), `命中: ${s.slice(0, 48)}`);
    const mustNotMatch = [
      '缺少必要参数pregnancy_id或date',
      '记录不存在',
      '请上传文件',
      '没有匹配的食谱',
      '照片不存在',
      '会话不存在',
      '无效的action，支持: start/end/manual',
      '请输入搜索关键词',
      '未找到该分类',
      '更新成功',
      // ⚠️ 回归护栏：`[A-Za-z]:[\\/]` 没有 `\b` 时会连 http(s) 一起命中（"p:/"、"s:/"），
      //    把带网址的业务提示整句换成通用文案。这几条就是那次修复的护栏。
      '请检查推送地址 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
      '详情见 http://192.168.1.10:8080/help',
      '开源地址 https://github.com/xiaoke799',
      '飞书机器人地址形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
    ];
    for (const s of mustNotMatch) ok(!re.test(s), `不误伤: ${s}`);
  }

  console.log('=== N3：正常业务文案不被误伤（两个模式都必须保留原文）===');
  for (const p of BUSINESS_PROBES) {
    const a = await req(PORT_PROD, p.method, p.path, p.body);
    const msgA = (a.json && a.json.message) || a.raw;
    const bad = /操作失败，请稍后重试/.test(msgA);
    ok(!bad, `${p.name} → 生产模式保留业务文案`, msgA);
  }

  console.log('=== N4：/api/health 在 fnos 模式下可免鉴权访问（白名单路径没错位）===');
  const h = await req(PORT_PROD, 'GET', '/api/health', null, { 'X-Trim-Userid': '' });
  ok(h.status === 200, '/api/health 无需鉴权 Header 也能 200', h.status + ' ' + String(h.raw).slice(0, 120));
  ok(h.json && typeof h.json.status === 'string', '健康检查返回 status 字段', h.json && h.json.status);
  ok(h.json && h.json.status === 'ok', '空库启动 → status=ok', h.json && h.json.status);

  console.log('=== N5：无鉴权 Header 打业务接口 → 401（生产模式）===');
  const noauth = await req(PORT_PROD, 'GET', '/api/v1/habit-checkins?pregnancy_id=x', null, { 'X-Trim-Userid': '' });
  ok(noauth.status === 401, '缺少网关 Header → 401', noauth.status);

  prod.child.kill();
  dev.child.kill();
  await new Promise(r => setTimeout(r, 600));

  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
