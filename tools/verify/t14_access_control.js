// 测试 #11（verifyAuth 空操作）+ #12（logs 访问控制被 !req.ip 旁路）
const path = require('path');
const http = require('http');
const fs = require('fs');

const SERVER_DIR = require('./_env').SERVER_DIR;
const TMP = path.join(require('./_env').TMP, 'tmp_n');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

process.env.STORAGE_DIR = TMP;
process.env.DATA_DIR = TMP;
process.env.PHOTOS_DIR = path.join(TMP, 'photos');
process.env.MEDIA_DIR = path.join(TMP, 'media');
process.env.DATABASE_PATH = path.join(TMP, 'pj.db');
process.env.APP_MODE = 'fnos';

const express = require('express');
const config = require(path.join(SERVER_DIR, 'config.js'));
const logsRouter = require(path.join(SERVER_DIR, 'routes', 'logs.js'));
const exportRouter = require(path.join(SERVER_DIR, 'routes', 'export.js'));

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

// 伪造「网关来源」的 req.state / 让 req.ip 拿不到（模拟 Unix Socket）
function fakeGateway(opts = {}) {
  return (req, res, next) => {
    Object.defineProperty(req, 'ip', { value: opts.ip !== undefined ? opts.ip : undefined, configurable: true });
    if (opts.identity) {
      req.state = {
        user_id: opts.identity.uid || '',
        username: opts.identity.uid ? 'u' + opts.identity.uid : '',
        is_admin: opts.identity.isAdmin ? 'true' : 'false',
        auth_source: opts.identity.uid ? 'gateway' : 'none',
      };
    }
    next();
  };
}

(async () => {
  // ---------- 静态断言 ----------
  console.log('=== O1：#11 export.js verifyAuth 源码断言 ===');
  const exSrc = stripComments(fs.readFileSync(path.join(SERVER_DIR, 'routes', 'export.js'), 'utf-8'));
  const fnBody = exSrc.slice(exSrc.indexOf('function verifyAuth'), exSrc.indexOf('const ALL_TABLES'));
  ok(/status\(401\)/.test(fnBody), 'verifyAuth 具备 401 拒绝分支');
  ok(/!st\.user_id|!req\.state\.user_id/.test(fnBody), 'verifyAuth 检查已认证身份是否为空');
  ok(fnBody.indexOf('status(401)') < fnBody.indexOf('next()'), 'verifyAuth 先判身份、后放行（401 分支在 next() 之前）');

  console.log('=== O2：#12 logs.js 源码断言 ===');
  const lgSrc = stripComments(fs.readFileSync(path.join(SERVER_DIR, 'routes', 'logs.js'), 'utf-8'));
  ok(!/if \(!req\.ip \|\| req\.ip === 'unknown'\) return true;/.test(lgSrc), '删除了 `if (!req.ip) return true` 的旁路');
  ok(/const \{ requireAdmin \} = require\('\.\.\/middleware\/auth'\)/.test(lgSrc), 'logs.js 从 middleware 引入 requireAdmin（判定已抽离共用）');
  ok(!/function checkAdmin/.test(lgSrc), 'logs.js 不再自写 checkAdmin（统一走 middleware）');
  ok(!/_isDirectLocal/.test(lgSrc), 'logs.js 不再自写 _isDirectLocal（唯一出处在 middleware）');
  ok((lgSrc.match(/requireAdmin,/g) || []).length === 3, 'logs.js 三条路由均挂 requireAdmin', (lgSrc.match(/requireAdmin,/g) || []).length);

  // ---------- 功能验证 ----------
  const app = express();
  app.use(express.json());
  // 用可控的假网关身份替代真实 authMiddleware（真实中间件已在 t13 里验证过）
  app.use(fakeGateway({ identity: null, ip: undefined })); // 默认：无身份、无 IP
  app.use('/api/v1', logsRouter);
  app.use('/api/v1', exportRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  // 由于需要按用例切换身份，这里改建三个独立 app
  async function mkApp(mw) {
    const a = express();
    a.use(express.json());
    a.use(mw);
    a.use('/api/v1', logsRouter);
    a.use('/api/v1', exportRouter);
    const s = a.listen(0, '127.0.0.1');
    await new Promise(r => s.once('listening', r));
    return { s, p: s.address().port };
  }

  console.log('=== O3：#12 关键——无身份且拿不到 IP（模拟 Unix Socket）应被拒绝 ===');
  {
    config.APP_MODE = 'fnos';
    const { s, p } = await mkApp(fakeGateway({ identity: null, ip: undefined }));
    const r = await call(p, 'GET', '/api/v1/logs?lines=10');
    ok(r.status === 403, '【关键】GET /logs → 403（旧代码在此条件下一律放行）', r.status + ' ' + String(r.raw).slice(0, 80));
    const d = await call(p, 'DELETE', '/api/v1/logs');
    ok(d.status === 403, '【关键】DELETE /logs → 403', d.status + ' ' + String(d.raw).slice(0, 80));
    s.close();
  }

  console.log('=== O4：#12 网关已鉴权 → 放行；普通用户不能清空日志 ===');
  {
    config.APP_MODE = 'fnos';
    const { s, p } = await mkApp(fakeGateway({ identity: { uid: '1000', isAdmin: false }, ip: undefined }));
    const r = await call(p, 'GET', '/api/v1/logs?lines=10');
    ok(r.status === 403, '【关键】普通用户 GET /logs → 403（日志属排查线索，破坏性操作需管理员）', r.status + ' ' + String(r.raw).slice(0, 80));
    const d = await call(p, 'DELETE', '/api/v1/logs');
    ok(d.status === 403, '【关键】普通用户 DELETE /logs → 403（需管理员）', d.status + ' ' + String(d.raw).slice(0, 80));
    s.close();
  }
  {
    config.APP_MODE = 'fnos';
    const { s, p } = await mkApp(fakeGateway({ identity: { uid: '1', isAdmin: true }, ip: undefined }));
    const d = await call(p, 'DELETE', '/api/v1/logs');
    ok(d.status === 200 && d.json && d.json.code === 0, '管理员 DELETE /logs → 200', d.status + ' ' + String(d.raw).slice(0, 80));
    s.close();
  }

  console.log('=== O5：#12 反例对照——dev 模式仍可本地调试 ===');
  {
    const prev = config.APP_MODE; config.APP_MODE = 'dev';
    const { s, p } = await mkApp(fakeGateway({ identity: null, ip: undefined }));
    const r = await call(p, 'GET', '/api/v1/logs?lines=10');
    ok(r.status === 200, 'dev 模式无身份也能读日志（保留本地调试）', r.status);
    const d = await call(p, 'DELETE', '/api/v1/logs');
    ok(d.status === 200, 'dev 模式可清空日志', d.status);
    config.APP_MODE = prev;
    s.close();
  }

  console.log('=== O6：#11 verifyAuth 真的会拦——直接挂载 export 路由（无 authMiddleware、无 req.state）===');
  {
    config.APP_MODE = 'fnos';
    const a = express();
    a.use(express.json());
    a.use('/api/v1', exportRouter); // 刻意不注入 req.state
    const s = a.listen(0, '127.0.0.1');
    await new Promise(r => s.once('listening', r));
    const r = await call(s.address().port, 'GET', '/api/v1/export/csv?pregnancy_id=x');
    ok(r.status === 401, '【关键】无已认证身份 → 401（旧实现会直接放行到业务层）', r.status + ' ' + String(r.raw).slice(0, 80));
    s.close();
  }
  {
    config.APP_MODE = 'fnos';
    const { s, p } = await mkApp(fakeGateway({ identity: { uid: '1000', isAdmin: false }, ip: undefined }));
    const r = await call(p, 'GET', '/api/v1/export/csv?pregnancy_id=x');
    ok(r.status !== 401, '有已认证身份 → 能通过 verifyAuth（不会误拦）', r.status);
    s.close();
  }

  server.close();
  console.log('');
  console.log(`==== 结果：${PASS} 通过 / ${FAIL} 失败 ====`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
