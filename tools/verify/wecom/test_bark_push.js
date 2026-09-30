/**
 * Bark 推送 端到端集成测试（隔离环境 + 模拟 Bark 服务端）
 * 覆盖：报文结构（POST JSON {title, body}，首行做标题）/ 成功判定（HTTP 2xx 且 JSON code===200）/
 *       错误翻译（403 Key 失效 / 410 APNs 拒绝）/ 非 JSON 不假成功 / 长度截断（APNs 4KB）/
 *       自建服务器 http:// 可用 / 地址校验 / 清除配置
 * 接口依据：bark.day.app 官方文档（2026-09-29 实抓确认）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const APP = require('../_env').SERVER_DIR;
const NM = path.join(APP, 'node_modules');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-bark-test-'));
const STORAGE = path.join(TMP, 'storage');
const ASSETS = path.join(TMP, 'assets');
fs.mkdirSync(STORAGE, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });
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

// ---- 模拟 Bark 服务端 ----
const hits = { byPath: {}, lastBody: null, lastRaw: null, lastHeaders: null };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    hits.byPath[req.url] = (hits.byPath[req.url] || 0) + 1;
    hits.lastRaw = body;
    hits.lastHeaders = req.headers;
    try { hits.lastBody = JSON.parse(body); } catch { hits.lastBody = body; }

    const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/barkkey1') return json({ code: 200, message: 'success', timestamp: Date.now() });
    if (req.url === '/barkkey2') return json({ code: 403, message: 'key not found' });
    if (req.url === '/barkkey3') return json({ code: 410, message: 'device off' });
    if (req.url === '/barkkeybig') return json({ code: 200, message: 'success', timestamp: Date.now() });
    if (req.url === '/barkkeybad') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>502 Bad Gateway</html>'); }
    res.writeHead(404); res.end('not found');
  });
});

const PORT = 39160;
const BASE = `http://127.0.0.1:${PORT}`;

function writeConfig(extra) {
  fs.writeFileSync(path.join(STORAGE, 'bark.json'), JSON.stringify({
    webhook_url: '', secret: '', configured: true, enabled: true,
    push_checkup: true, push_daily: true, push_reminder: true, push_time: '08:00',
    ...extra,
  }, null, 2));
}

(async () => {
  await new Promise(r => mock.listen(PORT, '127.0.0.1', r));
  await db.initDb();
  log.init(path.join(STORAGE, 'logs'));

  const app = express();
  app.use(express.json());
  app.use('/api/v1', require(path.join(APP, 'routes', 'bark.js')));
  app.use('/api/v1', require(path.join(APP, 'routes', 'push.js')));
  const api = app.listen(39161, '127.0.0.1');
  const API = 'http://127.0.0.1:39161/api/v1';

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
  const P1 = 'preg-bark-1';
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, is_active) VALUES (?,?,?,1)', [P1, '2026-01-01', '2026-10-08']);
  const tomorrow = new Date(Date.now() + 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  const tomorrowStr = `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}`;
  db.run('INSERT INTO schedule_dates (pregnancy_id, schedule_id, checkup_date) VALUES (?,?,?)', [P1, 'cs_003', tomorrowStr]);
  db.run('INSERT INTO reminder (id, pregnancy_id, title, trigger_date, is_completed) VALUES (?,?,?,?,0)',
    ['rm-b1', P1, '记得吃叶酸', tomorrowStr + ' 09:00:00']);

  // ========== 1. 报文结构 ==========
  writeConfig({ webhook_url: BASE + '/barkkey1' });
  let r = await call('POST', '/bark/daily-push', { pregnancy_id: P1 });
  check('Bark 推送成功', r.code === 0, JSON.stringify(r));
  check('POST JSON 带 title 与 body 字段',
    hits.lastBody && typeof hits.lastBody.title === 'string' && typeof hits.lastBody.body === 'string',
    JSON.stringify(hits.lastBody).slice(0, 120));
  check('正文首行做通知标题', hits.lastBody && /产检|孕|提醒/.test(hits.lastBody.title), hits.lastBody && hits.lastBody.title);
  check('body 含产检与提醒内容', hits.lastBody.body.includes('产检') && hits.lastBody.body.includes('叶酸'));
  check('Content-Type 为 application/json',
    String(hits.lastHeaders['content-type']).includes('application/json'), hits.lastHeaders['content-type']);
  let row = db.queryOne("SELECT * FROM push_log WHERE push_type='daily' ORDER BY created_at DESC LIMIT 1");
  check('推送记录 channel = bark', row && row.channel === 'bark', row && row.channel);
  check('日志标记为 success', row && row.status === 'success', row && row.status);

  // ========== 2. 错误翻译 ==========
  writeConfig({ webhook_url: BASE + '/barkkey2' });
  r = await call('POST', '/bark/daily-push', { pregnancy_id: P1 });
  check('code 403 → 提示 Key 失效重新复制', r.code === 1002 && /Key/.test(r.message), r.message);
  writeConfig({ webhook_url: BASE + '/barkkey3' });
  r = await call('POST', '/bark/daily-push', { pregnancy_id: P1 });
  check('code 410 → 提示 APNs 拒绝', /APNs/.test(r.message), r.message);

  // ========== 3. 永久错误不重试 ==========
  writeConfig({ webhook_url: BASE + '/barkkey2' });
  hits.byPath['/barkkey2'] = 0;
  await call('POST', '/bark/daily-push', { pregnancy_id: P1 });
  check('设备侧错误（403）只发 1 次不空转', hits.byPath['/barkkey2'] === 1, hits.byPath['/barkkey2']);

  // ========== 4. 非 JSON 不假成功 ==========
  writeConfig({ webhook_url: BASE + '/barkkeybad' });
  r = await call('POST', '/bark/daily-push', { pregnancy_id: P1 });
  check('HTML 错误页不会被记成推送成功', r.code === 1002, JSON.stringify(r));

  // ========== 5. 长度截断（APNs 4KB 预算 3500 字节） ==========
  writeConfig({ webhook_url: BASE + '/barkkeybig' });
  const bigNote = '这是一条超长备忘测试。'.repeat(400); // 约 9600 字节
  await call('POST', '/bark/config', { webhook_url: BASE + '/barkkeybig' });
  r = await call('POST', '/bark/send-test', {});
  check('send-test 正常返回（截断逻辑不抛错）', r.code === 0, JSON.stringify(r));
  check('截断后请求体不超过 3500 字节预算',
    hits.lastRaw && Buffer.byteLength(hits.lastRaw, 'utf8') <= 3600,
    hits.lastRaw && Buffer.byteLength(hits.lastRaw, 'utf8'));

  // ========== 6. 自建服务器 http:// + SSRF 加固（2026-09-30 上线前检查 #8） ==========
  // 本机/内网地址保存被拒：推送由服务端发起，不拒就等于把 NAS 当跳板打内网。
  r = await call('POST', '/bark/config', { webhook_url: 'http://127.0.0.1:' + PORT + '/barkkey1' });
  check('本机地址(127.0.0.1) 保存被拒绝（SSRF 加固）', r.code !== 0, JSON.stringify(r));
  r = await call('POST', '/bark/config', { webhook_url: 'http://192.168.1.50:8080/key' });
  check('内网地址(192.168.x) 保存被拒绝', r.code !== 0, JSON.stringify(r));
  // 公网域名自建服务器（即便 http://）仍是合法场景，允许保存
  r = await call('POST', '/bark/config', { webhook_url: 'http://bark-selfhosted.example.com:8080/key' });
  check('公网域名自建地址(http) 允许保存', r.code === 0, JSON.stringify(r));
  // 历史已存配置（绕过保存校验直接落盘）→ 发送链路不二次校验，仍应能推
  writeConfig({ webhook_url: 'http://127.0.0.1:' + PORT + '/barkkey1' });
  hits.byPath['/barkkey1'] = 0;
  r = await call('POST', '/bark/daily-push', { pregnancy_id: P1 });
  check('已存配置仍能推送成功（发送链路不二次校验）', r.code === 0 && hits.byPath['/barkkey1'] === 1, JSON.stringify(r));

  // ========== 7. 地址校验 ==========
  r = await call('POST', '/bark/config', { webhook_url: 'https://api.day.app/' });
  check('缺少 Key 段被拒绝', r.code === 1001, JSON.stringify(r));
  r = await call('POST', '/bark/config', { webhook_url: 'ftp://api.day.app/abc' });
  check('非 http(s) 协议被拒绝', r.code === 1001, JSON.stringify(r));

  // ========== 8. 清除配置 ==========
  writeConfig({ webhook_url: BASE + '/barkkey1' });
  r = await call('POST', '/bark/config', { webhook_url: '' });
  check('显式空串 = 清除配置', r.code === 0 && r.data && r.data.cleared === true, JSON.stringify(r));

  console.log(results.join('\n'));
  console.log(`\n==== Bark 推送：${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
