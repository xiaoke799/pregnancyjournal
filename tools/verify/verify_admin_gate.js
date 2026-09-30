// B2 上架前加固回归：管理操作（整体性/破坏性）只限管理员。
//
// 覆盖范围：
//   · middleware/auth.js 的 requireAdmin 是否被路由真正挂上（源码 + 运行期双重断言）
//   · 三类路由在「网关普通用户 / 网关管理员 / dev 模式」三种身份下的真实响应
//       - 整体性/破坏性操作（GET/DELETE /logs、/export/full、/backup、/restore、整库导入、
//         目录浏览与下载、改授权目录、改推送配置……）→ 普通用户必须 403，管理员/dev 不能 403
//       - 日常操作（单份 csv/日记pdf/相册pdf 导出、推送查询/测试）→ 普通用户也不能 403
//
// ⚠️ 反例自检（iron rule #11）：本套件**同时**断言「普通用户 403」与「管理员不 403」落在同一组路由上。
//    若 requireAdmin 没真正挂上（普通用户也会放行）→ 普通用户那条直接红；若 requireAdmin 写成恒 403
//    （管理员也被拦）→ 管理员那条红。两条必须同时绿，门禁才可信，杜绝「假绿」。
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_admin');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

process.env.STORAGE_DIR = TMP;
process.env.DATA_DIR = TMP;
process.env.PHOTOS_DIR = path.join(TMP, 'photos');
process.env.MEDIA_DIR = path.join(TMP, 'media');
process.env.DATABASE_PATH = path.join(TMP, 'pj.db');

const express = require('express');
const config = require(path.join(SERVER_DIR, 'config.js'));
const auth = require(path.join(SERVER_DIR, 'middleware', 'auth.js'));
const logsRouter = require(path.join(SERVER_DIR, 'routes', 'logs.js'));
const exportRouter = require(path.join(SERVER_DIR, 'routes', 'export.js'));
const { createChannelRouter } = require(path.join(SERVER_DIR, 'routes', 'push-channel-router.js'));

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + label); }
  else { FAIL++; console.log('  🔴 ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'); }

function call(port, method, p, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, raw: d, json: j }); });
    });
    r.on('error', e => resolve({ status: 0, raw: 'ERR ' + e.message, json: null }));
    r.end();
  });
}

// 伪造「网关来源」身份（模拟请求经 fnOS 统一网关进来，无真实 IP）
function fakeGateway(identity, ip) {
  return (req, res, next) => {
    Object.defineProperty(req, 'ip', { value: ip !== undefined ? ip : undefined, configurable: true });
    if (identity) {
      req.state = {
        user_id: identity.uid || '',
        username: identity.uid ? 'u' + identity.uid : '',
        is_admin: identity.isAdmin ? 'true' : 'false',
        auth_source: identity.uid ? 'gateway' : 'none',
      };
    }
    next();
  };
}

// 把全部被测路由挂到同一个 app（每个身份各建一个独立 app，避免 config.APP_MODE 互相污染）
function mountAll(app) {
  app.use(express.json());
  app.use('/api/v1', logsRouter);
  app.use('/api/v1', exportRouter);
  for (const k of ['wecom', 'feishu', 'dingtalk', 'bark']) app.use('/api/v1', createChannelRouter(k));
}
async function mkApp(mw) {
  const a = express();
  a.use(mw);
  mountAll(a);
  const s = a.listen(0, '127.0.0.1');
  await new Promise(r => s.once('listening', r));
  return { s, p: s.address().port };
}

// 整体性/破坏性操作（普通用户必须 403）
const DESTRUCTIVE = [
  ['GET', '/api/v1/logs?lines=10'],
  ['DELETE', '/api/v1/logs'],
  ['GET', '/api/v1/logs/stats'],
  ['POST', '/api/v1/export/full'],
  ['POST', '/api/v1/export/with-photos'],
  ['GET', '/api/v1/export/download-dir?sub=app'],
  ['POST', '/api/v1/export/import-json'],
  ['POST', '/api/v1/export/import-dir'],
  ['POST', '/api/v1/export/category'],
  ['POST', '/api/v1/export/backup-db'],
  ['POST', '/api/v1/export/restore-db'],
  ['GET', '/api/v1/export/backups'],
  ['POST', '/api/v1/backup'],
  ['POST', '/api/v1/restore'],
  ['POST', '/api/v1/trust-dir'],
  ['GET', '/api/v1/browse-dir?root=app'],
  ['POST', '/api/v1/restore-latest'],
  ['POST', '/api/v1/wecom/config'],
  ['POST', '/api/v1/feishu/config'],
  ['POST', '/api/v1/dingtalk/config'],
  ['POST', '/api/v1/bark/config'],
];
// 日常操作（任何已登录用户都不该被 403）
const DAILY = [
  ['GET', '/api/v1/export/csv?pregnancy_id=x'],
  ['GET', '/api/v1/export/diary-pdf?pregnancy_id=x'],
  ['GET', '/api/v1/export/album-pdf?pregnancy_id=x'],
  ['GET', '/api/v1/wecom/status'],
  ['GET', '/api/v1/wecom/config'],
  ['POST', '/api/v1/wecom/send-test'],
  ['GET', '/api/v1/feishu/status'],
  ['GET', '/api/v1/bark/config'],
];

(async () => {
  // ---------- 静态断言：requireAdmin 真被挂上 ----------
  console.log('=== S1：middleware/auth.js 导出 requireAdmin / isDirectLocal ===');
  ok(typeof auth.requireAdmin === 'function', 'auth.js 具名导出 requireAdmin');
  ok(typeof auth.isDirectLocal === 'function', 'auth.js 具名导出 isDirectLocal');

  console.log('=== S2：logs.js 已抽离本地判定、三路由全挂 requireAdmin ===');
  const lgSrc = stripComments(fs.readFileSync(path.join(SERVER_DIR, 'routes', 'logs.js'), 'utf-8'));
  ok(!/if \(!req\.ip \|\| req\.ip === 'unknown'\) return true;/.test(lgSrc), '删除了 `!req.ip` 旁路（线上恒真形同虚设）');
  ok(!/function checkAdmin/.test(lgSrc), 'logs.js 不再自写 checkAdmin（统一走 middleware）');
  ok(!/_isDirectLocal/.test(lgSrc), 'logs.js 不再自写 _isDirectLocal（唯一出处在 middleware）');
  ok(/const \{ requireAdmin \} = require\('\.\.\/middleware\/auth'\)/.test(lgSrc), 'logs.js 从 middleware 引入 requireAdmin');
  ok((lgSrc.match(/requireAdmin,/g) || []).length === 3, 'logs.js 三条路由（GET/DELETE /logs、/logs/stats）均挂 requireAdmin', (lgSrc.match(/requireAdmin,/g) || []).length);

  console.log('=== S3：export.js 14 条破坏性路由挂 requireAdmin；3 条日常导出走 verifyAuth ===');
  const exSrc = stripComments(fs.readFileSync(path.join(SERVER_DIR, 'routes', 'export.js'), 'utf-8'));
  ok((exSrc.match(/requireAdmin,/g) || []).length === 14, 'export.js 共 14 处 requireAdmin（与路由清单一致）', (exSrc.match(/requireAdmin,/g) || []).length);
  for (const r of ['/export/csv', '/export/diary-pdf', '/export/album-pdf']) {
    ok(new RegExp("router\\.(get|post)\\('" + r.replace(/\//g, '\\/') + "', verifyAuth").test(exSrc), `${r} 走 verifyAuth（不误锁日常导出）`);
  }
  ok(!/router\.(get|post)\('\/export\/csv'[^)]*requireAdmin/.test(exSrc), '/export/csv 未被误挂 requireAdmin');

  console.log('=== S4：push-channel-router.js 只锁 POST /config 写入，读/测试不锁 ===');
  const pcSrc = stripComments(fs.readFileSync(path.join(SERVER_DIR, 'routes', 'push-channel-router.js'), 'utf-8'));
  ok(/router\.post\(\`\$\{base\}\/config\`, requireAdmin/.test(pcSrc), 'POST ${base}/config 挂 requireAdmin（写共用密钥）');
  ok(!/router\.get\(\`\$\{base\}\/config\`, requireAdmin/.test(pcSrc), 'GET ${base}/config（只读脱敏）不锁');
  ok(!/router\.get\(\`\$\{base\}\/status\`, requireAdmin/.test(pcSrc), 'GET ${base}/status 不锁');
  ok(!/router\.post\(\`\$\{base\}\/send-test\`, requireAdmin/.test(pcSrc), 'POST ${base}/send-test 不锁');

  // ---------- 直接单元测试 requireAdmin（两端分支都逼出来）----------
  console.log('=== U1：requireAdmin 行为——dev 放行 / 网关管理员放行 / 网关普通 403 / 直连本机放行 / 其余 403 ===');
  function fakeRR(identity, ip) {
    const req = { headers: {} };
    if (identity) {
      req.state = { user_id: identity.uid || '', is_admin: identity.isAdmin ? 'true' : 'false', username: '', auth_source: identity.uid ? 'gateway' : 'none' };
    } else {
      req.state = { auth_source: 'none', user_id: '', is_admin: 'false', username: '' };
    }
    if (ip !== undefined) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    let statusCode = null, nextCalled = false;
    const res = { status(c) { statusCode = c; return this; }, json() { return this; } };
    return { req, res, next: () => { nextCalled = true; }, get: () => ({ statusCode, nextCalled }) };
  }
  // dev 模式：一律放行
  config.APP_MODE = 'dev';
  {
    const t = fakeRR({ uid: '9', isAdmin: false });
    auth.requireAdmin(t.req, t.res, t.next);
    const r = t.get();
    ok(r.nextCalled && r.statusCode === null, 'dev 模式：普通用户也放行（next 调用、不置状态码）', r);
  }
  // fnos + 管理员
  config.APP_MODE = 'fnos';
  {
    const t = fakeRR({ uid: '1', isAdmin: true });
    auth.requireAdmin(t.req, t.res, t.next);
    const r = t.get();
    ok(r.nextCalled && r.statusCode === null, '网关管理员：放行', r);
  }
  // fnos + 普通用户
  {
    const t = fakeRR({ uid: '1000', isAdmin: false });
    auth.requireAdmin(t.req, t.res, t.next);
    const r = t.get();
    ok(!r.nextCalled && r.statusCode === 403, '网关普通用户：403 且不调用 next', r);
  }
  // fnos + 直连本机/内网（无网关身份，但 IP 可信）
  {
    const t = fakeRR(null, '192.168.1.20');
    auth.requireAdmin(t.req, t.res, t.next);
    const r = t.get();
    ok(r.nextCalled && r.statusCode === null, '直连内网 192.168.x：放行（可信来源）', r);
  }
  // fnos + 既非管理员又非直连（外部非网关来源）→ 403
  {
    const t = fakeRR(null, '203.0.113.5');
    auth.requireAdmin(t.req, t.res, t.next);
    const r = t.get();
    ok(!r.nextCalled && r.statusCode === 403, '外部非可信来源：403', r);
  }

  // ---------- 运行期功能验证 ----------
  config.APP_MODE = 'fnos';

  console.log('=== F1：网关普通用户 —— 整体性/破坏性操作一律 403 ===');
  {
    const { s, p } = await mkApp(fakeGateway({ uid: '1000', isAdmin: false }, undefined));
    for (const [m, u] of DESTRUCTIVE) {
      const r = await call(p, m, u);
      ok(r.status === 403, `普通用户 ${m} ${u} → 403`, r.status + ' ' + String(r.raw).slice(0, 60));
    }
    s.close();
  }

  console.log('=== F2：网关管理员 —— 同组操作不被 403（闸门放行，handler 内部成败不影响门禁判定）===');
  {
    const { s, p } = await mkApp(fakeGateway({ uid: '1', isAdmin: true }, undefined));
    for (const [m, u] of DESTRUCTIVE) {
      const r = await call(p, m, u);
      ok(r.status !== 403, `管理员 ${m} ${u} → 不 403（实际 ${r.status}）`, r.status + ' ' + String(r.raw).slice(0, 60));
    }
    s.close();
  }

  console.log('=== F3：日常操作 —— 普通用户也不该被 403 ===');
  {
    const { s, p } = await mkApp(fakeGateway({ uid: '1000', isAdmin: false }, undefined));
    for (const [m, u] of DAILY) {
      const r = await call(p, m, u);
      ok(r.status !== 403, `普通用户 ${m} ${u} → 不 403（实际 ${r.status}）`, r.status + ' ' + String(r.raw).slice(0, 60));
    }
    s.close();
  }

  console.log('=== F4：dev 模式 —— 破坏性操作仍放行（保留本地调试）===');
  {
    config.APP_MODE = 'dev';
    const { s, p } = await mkApp(fakeGateway(null, undefined));
    for (const [m, u] of DESTRUCTIVE) {
      const r = await call(p, m, u);
      ok(r.status !== 403, `dev ${m} ${u} → 不 403（实际 ${r.status}）`, r.status + ' ' + String(r.raw).slice(0, 60));
    }
    config.APP_MODE = 'fnos';
    s.close();
  }

  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
