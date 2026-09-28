/**
 * 企业微信推送 端到端集成测试（隔离环境：临时目录 + 真库 + 真 HTTP + 模拟企业微信服务端）
 * 覆盖：自动重试 / 不再误报成功 / 永久错误不重试 / 超长截断 / 内容勾选 / 本地时间戳
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const APP = require('../_env').SERVER_DIR;
const NM = path.join(APP, 'node_modules');

// ---- 隔离环境 ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-wecom-test-'));
const STORAGE = path.join(TMP, 'storage');
const ASSETS = path.join(TMP, 'assets');
fs.mkdirSync(STORAGE, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });
// 内置静态产检时间表（ASSETS_DIR）
fs.copyFileSync(path.join(APP, 'data', 'checkup_schedule.json'), path.join(ASSETS, 'checkup_schedule.json'));

process.env.STORAGE_DIR = STORAGE;
process.env.DATA_DIR = STORAGE;
process.env.ASSETS_DIR = ASSETS;
process.env.DATABASE_PATH = path.join(STORAGE, 'pregnancy-journal.db');
process.env.APP_MODE = 'dev';

const express = require(path.join(NM, 'express'));
const db = require(path.join(APP, 'db.js'));
const log = require(path.join(APP, 'logger.js'));

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { pass++; results.push(`  ✔ ${name}`); }
  else { fail++; results.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

// ---- 模拟企业微信服务端 ----
const hits = { total: 0, byPath: {}, lastBody: null };
let fail500Remaining = 0;

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    hits.total++;
    hits.byPath[req.url] = (hits.byPath[req.url] || 0) + 1;
    try { hits.lastBody = JSON.parse(body).text.content; } catch { hits.lastBody = body; }

    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
    }
    if (req.url === '/flaky') {
      if (fail500Remaining > 0) {
        fail500Remaining--;
        res.writeHead(500); return res.end('server error');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
    }
    if (req.url === '/badjson') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body>502 Bad Gateway</body></html>');
    }
    if (req.url === '/perm') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errcode: 93000, errmsg: 'invalid webhook url' }));
    }
    if (req.url === '/busy') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ errcode: 45009, errmsg: 'api freq out of limit' }));
    }
    res.writeHead(404); res.end('not found');
  });
});

const PORT = 39123;
const BASE = `http://127.0.0.1:${PORT}`;

function writeWecomConfig(extra) {
  fs.writeFileSync(path.join(STORAGE, 'wecom.json'), JSON.stringify({
    webhook_url: BASE + '/ok', configured: true, enabled: true,
    push_checkup: true, push_daily: true, push_reminder: true, push_time: '08:00',
    ...extra,
  }, null, 2));
}

function localStampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

(async () => {
  await new Promise(r => mock.listen(PORT, '127.0.0.1', r));
  await db.initDb();
  log.init(path.join(STORAGE, 'logs'));

  const app = express();
  app.use(express.json());
  app.use('/api/v1', require(path.join(APP, 'routes', 'wecom.js')));
  const api = app.listen(39124, '127.0.0.1');
  const API = 'http://127.0.0.1:39124/api/v1';

  async function call(method, url, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request(API + url, {
        method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      }, (res) => {
        let b = ''; res.setEncoding('utf8');
        res.on('data', c => b += c);
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({ raw: b }); } });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // ---- 造数据 ----
  const P1 = 'preg-test-1';
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, is_active) VALUES (?,?,?,1)',
    [P1, '2026-01-01', '2026-10-08']);
  const tomorrow = new Date(Date.now() + 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  const tomorrowStr = `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}`;
  // 注意：schedule_dates 主键是 (pregnancy_id, schedule_id)，没有 id 列
  db.run('INSERT INTO schedule_dates (pregnancy_id, schedule_id, checkup_date) VALUES (?,?,?)',
    [P1, 'cs_003', tomorrowStr]);
  db.run('INSERT INTO reminder (id, pregnancy_id, title, trigger_date, is_completed) VALUES (?,?,?,?,0)',
    ['rm-1', P1, '记得吃叶酸', tomorrowStr + ' 09:00:00']);

  // ========== 1. 正常推送 ==========
  writeWecomConfig();
  let r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('正常推送返回成功', r.code === 0, JSON.stringify(r));
  let row = db.queryOne("SELECT * FROM push_log WHERE push_type='daily' ORDER BY created_at DESC LIMIT 1");
  check('日志标记为 success', row && row.status === 'success', row && row.status);
  check('消息包含产检条目（cs_003）', hits.lastBody && hits.lastBody.includes('产检'), '');
  check('消息包含提醒事项', hits.lastBody && hits.lastBody.includes('记得吃叶酸'), '');
  check('消息包含孕期概览（孕X周）', hits.lastBody && /孕\d+周/.test(hits.lastBody), '');
  check('日志 payload 存了完整正文', row && row.payload && row.payload.includes('孕程记'), '');

  // ========== 2. 时间戳为本地时间 ==========
  const expectPrefix = localStampNow().slice(0, 13);   // YYYY-MM-DD HH
  check('pushed_at 使用本地时间（不再差8小时）',
    row && String(row.pushed_at).startsWith(expectPrefix),
    `pushed_at=${row && row.pushed_at} 期望前缀=${expectPrefix}`);

  // ========== 3. 自动重试：前两次 500，第三次成功 ==========
  hits.byPath['/flaky'] = 0;
  fail500Remaining = 2;
  writeWecomConfig({ webhook_url: BASE + '/flaky' });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('临时故障(500×2)后自动重试成功', r.code === 0, JSON.stringify(r));
  check('确实发出了 3 次请求', hits.byPath['/flaky'] === 3, '实际=' + hits.byPath['/flaky']);

  // ========== 4. 非 JSON 响应不再被误判为成功（原来的静默假成功） ==========
  const beforeBad = hits.byPath['/badjson'] || 0;
  writeWecomConfig({ webhook_url: BASE + '/badjson' });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('HTML 响应被判为失败（不再假成功）', r.code === 1002, JSON.stringify(r));
  check('错误提示可读', typeof r.message === 'string' && r.message.length > 4, r.message);
  const badRow = db.queryOne("SELECT * FROM push_log WHERE push_type='daily' ORDER BY created_at DESC LIMIT 1");
  check('日志标记为 failed', badRow && badRow.status === 'failed', badRow && badRow.status);

  // ========== 5. 永久错误不重试（93000 地址无效） ==========
  hits.byPath['/perm'] = 0;
  writeWecomConfig({ webhook_url: BASE + '/perm' });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('永久错误被判为失败', r.code === 1002, JSON.stringify(r));
  check('永久错误提示翻译成中文', r.message && r.message.includes('Webhook'), r.message);
  check('永久错误只请求 1 次（不做无谓重试）', hits.byPath['/perm'] === 1, '实际=' + hits.byPath['/perm']);

  // ========== 6. 频率超限(45009) 应重试 ==========
  hits.byPath['/busy'] = 0;
  writeWecomConfig({ webhook_url: BASE + '/busy' });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('频率超限(45009)会重试后失败', r.code === 1002 && hits.byPath['/busy'] === 4,
    `code=${r.code} 请求数=${hits.byPath['/busy']}`);

  // ========== 7. 超长内容自动截断（不超过 2048 字节） ==========
  for (let i = 0; i < 60; i++) {
    db.run('INSERT INTO reminder (id, pregnancy_id, title, trigger_date, is_completed) VALUES (?,?,?,?,0)',
      ['rm-bulk-' + i, P1, `第${i}条提醒事项——这是一条比较长的提醒标题用来把消息撑长`, tomorrowStr + ' 10:00:00']);
  }
  writeWecomConfig();
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  const bytes = hits.lastBody ? Buffer.byteLength(hits.lastBody, 'utf8') : 0;
  check('超长消息仍然推送成功', r.code === 0, JSON.stringify(r));
  check('消息被截断到 2048 字节以内', bytes > 0 && bytes <= 2048, `实际=${bytes} 字节`);
  check('截断时带说明', hits.lastBody && hits.lastBody.includes('截断'), '');

  // ========== 8. 内容勾选生效 ==========
  writeWecomConfig({ push_checkup: false, push_reminder: false, push_daily: true });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('仅勾孕期概览时推送成功', r.code === 0, JSON.stringify(r));
  check('未勾产检 → 消息里没有产检内容', hits.lastBody && !hits.lastBody.includes('产检'), '');
  check('未勾提醒 → 消息里没有提醒内容', hits.lastBody && !hits.lastBody.includes('叶酸'), '');

  writeWecomConfig({ push_daily: false, push_checkup: true, push_reminder: true });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('只勾产检/提醒时也能推送（不再整条不发）', r.code === 0, JSON.stringify(r));
  check('未勾概览 → 消息里没有孕周行', hits.lastBody && !/孕\d+周/.test(hits.lastBody), '');

  writeWecomConfig({ push_daily: false, push_checkup: false, push_reminder: false });
  r = await call('POST', '/wecom/daily-push', { pregnancy_id: P1 });
  check('三项全不勾 → 明确提示且不发送', r.code === 1001 && /未勾选/.test(r.message || ''), JSON.stringify(r));

  // ========== 9. 重试用的是原正文（不是标题） ==========
  writeWecomConfig();
  await call('POST', '/wecom/send-test');
  const testRow = db.queryOne("SELECT * FROM push_log WHERE push_type='test' ORDER BY created_at DESC LIMIT 1");
  check('测试消息日志存了正文 payload', testRow && testRow.payload && testRow.payload.includes('测试消息'), '');

  // ========== 10. 推送记录「今天」筛选按本地时间 ==========
  r = await call('GET', '/wecom/push-logs?filter=today');
  check('今天筛选能查到刚推送的记录', r.code === 0 && r.data && r.data.length > 0, `条数=${r.data && r.data.length}`);

  // ========== 11. 状态接口反映真实开关 ==========
  writeWecomConfig({ enabled: false });
  r = await call('GET', '/wecom/status');
  check('关闭推送时状态提示已关闭', r.data && r.data.status && r.data.status.success === false
    && String(r.data.status.message).includes('关闭'), JSON.stringify(r.data && r.data.status));

  writeWecomConfig();
  r = await call('GET', '/wecom/status');
  check('正常时状态显示推送时间与最近成功时间',
    r.data && r.data.status && r.data.status.success === true && String(r.data.status.message).includes('08:00'),
    JSON.stringify(r.data && r.data.status));

  // ========== 12. 保存配置：测试发送失败也要把配置存下来 ==========
  fs.unlinkSync(path.join(STORAGE, 'wecom.json'));
  r = await call('POST', '/wecom/config', { webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-invalid-key' });
  const saved = JSON.parse(fs.readFileSync(path.join(STORAGE, 'wecom.json'), 'utf-8'));
  check('格式非法(key无效)时配置仍然保存', r.code === 0 && saved.webhook_url.includes('test-invalid-key'), JSON.stringify(r));
  check('保存接口明确告知测试发送失败', r.data && r.data.test_failed === true, JSON.stringify(r.data));

  api.close();
  mock.close();

  console.log('\n================ 企业微信推送集成测试 ================');
  console.log(results.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);

  // 清理临时目录
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('测试脚本异常:', e);
  process.exit(2);
});
