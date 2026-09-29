/**
 * 钉钉推送 端到端集成测试（隔离环境 + 模拟钉钉服务端）
 * 覆盖：报文格式 / 官方加签算法（key=secret，msg=毫秒timestamp+"\n"+secret，拼 URL）/
 *       错误码翻译（310000 按 errmsg 细分）/ 永久错误不重试 / 限流重试 / 非 JSON 不假成功
 * 算法依据：open.dingtalk.com「自定义机器人安全设置」（2026-09-29 实抓确认）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const APP = require('../_env').SERVER_DIR;
const NM = path.join(APP, 'node_modules');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-dingtalk-test-'));
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

// ---- 模拟钉钉服务端 ----
const hits = { byPath: {}, lastBody: null, lastHeaders: null, lastQuery: null };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const qIdx = req.url.indexOf('?');
    const pathOnly = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
    hits.byPath[pathOnly] = (hits.byPath[pathOnly] || 0) + 1;
    hits.lastRaw = body;
    hits.lastHeaders = req.headers;
    hits.lastQuery = qIdx === -1 ? {} : Object.fromEntries(new URL('http://x' + req.url).searchParams);
    try { hits.lastBody = JSON.parse(body); } catch { hits.lastBody = body; }

    const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (pathOnly === '/dingtalk/ok') return json({ errcode: 0, errmsg: 'ok' });
    if (pathOnly === '/dingtalk/signfail') return json({ errcode: 310000, errmsg: 'sign not match' });
    if (pathOnly === '/dingtalk/keyword') return json({ errcode: 310000, errmsg: 'keywords not in content' });
    if (pathOnly === '/dingtalk/ratelimit') return json({ errcode: 410100, errmsg: 'too fast' });
    if (pathOnly === '/dingtalk/badtok') return json({ errcode: 400101, errmsg: 'access_token不存在' });
    if (pathOnly === '/dingtalk/badjson') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>502 Bad Gateway</html>'); }
    res.writeHead(404); res.end('not found');
  });
});

const PORT = 39150;
const BASE = `http://127.0.0.1:${PORT}`;

function writeConfig(extra) {
  fs.writeFileSync(path.join(STORAGE, 'dingtalk.json'), JSON.stringify({
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
  app.use('/api/v1', require(path.join(APP, 'routes', 'dingtalk.js')));
  app.use('/api/v1', require(path.join(APP, 'routes', 'push.js')));
  const api = app.listen(39151, '127.0.0.1');
  const API = 'http://127.0.0.1:39151/api/v1';

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
  const P1 = 'preg-ding-1';
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, is_active) VALUES (?,?,?,1)', [P1, '2026-01-01', '2026-10-08']);
  const tomorrow = new Date(Date.now() + 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  const tomorrowStr = `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}`;
  db.run('INSERT INTO schedule_dates (pregnancy_id, schedule_id, checkup_date) VALUES (?,?,?)', [P1, 'cs_003', tomorrowStr]);
  db.run('INSERT INTO reminder (id, pregnancy_id, title, trigger_date, is_completed) VALUES (?,?,?,?,0)',
    ['rm-d1', P1, '记得吃叶酸', tomorrowStr + ' 09:00:00']);

  // ========== 1. 报文格式 ==========
  writeConfig({ webhook_url: BASE + '/dingtalk/ok?access_token=tok123' });
  let r = await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('钉钉推送成功', r.code === 0, JSON.stringify(r));
  check('使用 msgtype=text + text.content 结构（与企微相同、与飞书不同）',
    hits.lastBody && hits.lastBody.msgtype === 'text' && hits.lastBody.text && typeof hits.lastBody.text.content === 'string',
    JSON.stringify(hits.lastBody).slice(0, 120));
  check('消息内容含产检与提醒', hits.lastBody.text.content.includes('产检') && hits.lastBody.text.content.includes('叶酸'));
  let row = db.queryOne("SELECT * FROM push_log WHERE push_type='daily' ORDER BY created_at DESC LIMIT 1");
  check('推送记录 channel = dingtalk', row && row.channel === 'dingtalk', row && row.channel);
  check('日志标记为 success', row && row.status === 'success', row && row.status);

  // ========== 2. 无密钥：URL 不带签名 ==========
  check('未配置密钥时 URL 不带 timestamp/sign',
    hits.lastQuery.timestamp === undefined && hits.lastQuery.sign === undefined,
    JSON.stringify(hits.lastQuery));

  // ========== 3. 官方加签算法 ==========
  const SECRET = 'SEC demo-secret-abc';
  writeConfig({ webhook_url: BASE + '/dingtalk/ok?access_token=tok123', secret: SECRET });
  hits.byPath['/dingtalk/ok'] = 0;
  r = await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  const q = hits.lastQuery;
  check('开启密钥后 URL 带 timestamp 与 sign', !!(q && q.timestamp && q.sign), JSON.stringify(q));
  check('timestamp 为毫秒级（13 位）', /^\d{13}$/.test(String(q && q.timestamp)), String(q && q.timestamp));
  check('timestamp 在 1 小时内', Math.abs(Date.now() - Number(q && q.timestamp)) < 3600000, String(q && q.timestamp));
  // 官方算法：key=secret，对 `timestamp+"\n"+secret` 做 HmacSHA256 → Base64（再 URL 编码，searchParams 已自动处理）
  const expectSign = crypto.createHmac('sha256', SECRET).update(`${q.timestamp}\n${SECRET}`, 'utf8').digest('base64');
  check('sign 与官方算法一致（key=secret，msg=timestamp\\n+secret）', q && q.sign === expectSign,
    `期望=${expectSign} 实际=${q && q.sign}`);
  check('access_token 保留在 URL 上', q && q.access_token === 'tok123', JSON.stringify(q));
  check('加签推送成功', r.code === 0, JSON.stringify(r));

  // ========== 4. 错误码翻译（310000 按 errmsg 细分） ==========
  writeConfig({ webhook_url: BASE + '/dingtalk/signfail?access_token=tok123', secret: SECRET });
  r = await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('sign not match → 提示检查加签密钥', r.code === 1002 && /加签密钥/.test(r.message), r.message);
  writeConfig({ webhook_url: BASE + '/dingtalk/keyword?access_token=tok123', secret: SECRET });
  r = await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('keywords not in content → 提示自定义关键词', /关键词/.test(r.message), r.message);
  writeConfig({ webhook_url: BASE + '/dingtalk/badtok?access_token=tok123', secret: SECRET });
  r = await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('400101 → 提示重新复制地址', /重新复制/.test(r.message), r.message);

  // ========== 5. 永久错误不重试 / 限流会重试 ==========
  writeConfig({ webhook_url: BASE + '/dingtalk/signfail?access_token=tok123', secret: SECRET });
  hits.byPath['/dingtalk/signfail'] = 0;
  await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('永久错误（310000 sign）只发 1 次不空转', hits.byPath['/dingtalk/signfail'] === 1, hits.byPath['/dingtalk/signfail']);
  writeConfig({ webhook_url: BASE + '/dingtalk/ratelimit?access_token=tok123', secret: SECRET });
  await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('限流（410100）会自动重试（>1 次）', hits.byPath['/dingtalk/ratelimit'] > 1, hits.byPath['/dingtalk/ratelimit']);

  // ========== 6. 非 JSON 不假成功 ==========
  writeConfig({ webhook_url: BASE + '/dingtalk/badjson' });
  r = await call('POST', '/dingtalk/daily-push', { pregnancy_id: P1 });
  check('HTML 错误页不会被记成推送成功', r.code === 1002, JSON.stringify(r));

  // ========== 7. 保存地址校验 ==========
  r = await call('POST', '/dingtalk/config', { webhook_url: 'https://evil.example.com/robot/send?access_token=x' });
  check('非钉钉域名被拒绝', r.code === 1001, JSON.stringify(r));
  r = await call('POST', '/dingtalk/config', { webhook_url: 'https://oapi.dingtalk.com/robot/send' });
  check('缺 access_token 被拒绝', r.code === 1001, JSON.stringify(r));

  // ========== 8. 清除配置 ==========
  writeConfig({ webhook_url: BASE + '/dingtalk/ok?access_token=tok123' });
  r = await call('POST', '/dingtalk/config', { webhook_url: '' });
  check('显式空串 = 清除配置', r.code === 0 && r.data && r.data.cleared === true, JSON.stringify(r));

  console.log(results.join('\n'));
  console.log(`\n==== 钉钉推送：${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
