/**
 * 飞书推送 端到端集成测试（隔离环境 + 模拟飞书服务端）
 * 覆盖：报文格式 / 加签算法 / 响应解析（code 而非 errcode）/ 错误翻译 /
 *       非 JSON 不假成功 / 重试策略 / 长度限制 / 双渠道并存互不影响
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const APP = require('../_env').SERVER_DIR;
const NM = path.join(APP, 'node_modules');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-feishu-test-'));
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

// ---- 模拟飞书服务端 ----
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
    if (req.url === '/feishu/ok') return json({ StatusCode: 0, StatusMessage: 'success', code: 0, data: {}, msg: 'success' });
    if (req.url === '/feishu/signfail') return json({ code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' });
    if (req.url === '/feishu/keyword') return json({ code: 19024, msg: 'Key Words Not Found' });
    if (req.url === '/feishu/ip') return json({ code: 19022, msg: 'Ip Not Allowed' });
    if (req.url === '/feishu/busy') return json({ code: 11232, msg: 'rate limit' });
    if (req.url === '/feishu/badjson') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>502 Bad Gateway</html>'); }
    if (req.url === '/feishu/http500') { res.writeHead(500); return res.end('boom'); }
    if (req.url === '/wecom/ok') return json({ errcode: 0, errmsg: 'ok' });
    res.writeHead(404); res.end('not found');
  });
});

const PORT = 39140;
const BASE = `http://127.0.0.1:${PORT}`;

function writeConfig(file, extra) {
  fs.writeFileSync(path.join(STORAGE, file), JSON.stringify({
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
  app.use('/api/v1', require(path.join(APP, 'routes', 'feishu.js')));
  app.use('/api/v1', require(path.join(APP, 'routes', 'wecom.js')));
  app.use('/api/v1', require(path.join(APP, 'routes', 'push.js')));
  const api = app.listen(39141, '127.0.0.1');
  const API = 'http://127.0.0.1:39141/api/v1';

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
  const P1 = 'preg-feishu-1';
  db.run('INSERT INTO pregnancy (id, last_period_date, due_date, is_active) VALUES (?,?,?,1)', [P1, '2026-01-01', '2026-10-08']);
  const tomorrow = new Date(Date.now() + 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  const tomorrowStr = `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}`;
  db.run('INSERT INTO schedule_dates (pregnancy_id, schedule_id, checkup_date) VALUES (?,?,?)', [P1, 'cs_003', tomorrowStr]);
  db.run('INSERT INTO reminder (id, pregnancy_id, title, trigger_date, is_completed) VALUES (?,?,?,?,0)',
    ['rm-f1', P1, '记得吃叶酸', tomorrowStr + ' 09:00:00']);

  // ========== 1. 飞书报文格式 ==========
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/ok' });
  hits.byPath['/feishu/ok'] = 0;
  let r = await call('POST', '/feishu/daily-push', { pregnancy_id: P1 });
  check('飞书推送成功', r.code === 0, JSON.stringify(r));
  check('使用 msg_type=text + content.text 结构',
    hits.lastBody && hits.lastBody.msg_type === 'text' && hits.lastBody.content && typeof hits.lastBody.content.text === 'string',
    JSON.stringify(hits.lastBody).slice(0, 120));
  check('未配置密钥时不带 timestamp/sign',
    hits.lastBody && hits.lastBody.timestamp === undefined && hits.lastBody.sign === undefined);
  check('Content-Type 为 application/json',
    String(hits.lastHeaders['content-type']).includes('application/json'), hits.lastHeaders['content-type']);
  check('消息内容与企微看板一致（含产检与提醒）',
    hits.lastBody.content.text.includes('产检') && hits.lastBody.content.text.includes('叶酸'), '');
  let row = db.queryOne("SELECT * FROM push_log WHERE push_type='daily' ORDER BY created_at DESC LIMIT 1");
  check('推送记录 channel = feishu', row && row.channel === 'feishu', row && row.channel);
  check('日志标记为 success', row && row.status === 'success', row && row.status);

  // ========== 2. 加签（官方算法）==========
  const SECRET = 'demo-secret-abc';
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/ok', secret: SECRET });
  hits.byPath['/feishu/ok'] = 0;
  r = await call('POST', '/feishu/daily-push', { pregnancy_id: P1 });
  const body = hits.lastBody;
  const ts = body && body.timestamp;
  const expectSign = crypto.createHmac('sha256', `${ts}\n${SECRET}`).update('').digest('base64');
  check('开启密钥后带上 timestamp 与 sign', !!ts && !!body.sign, JSON.stringify({ ts, sign: body && body.sign }));
  check('sign 与官方算法一致（key=时间戳\\n密钥，内容为空，Base64）', body && body.sign === expectSign,
    `期望=${expectSign} 实际=${body && body.sign}`);
  check('timestamp 为秒级（10位）', /^\d{10}$/.test(String(ts)), String(ts));
  check('timestamp 在 1 小时内', Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) < 3600, String(ts));
  check('加签推送成功', r.code === 0, JSON.stringify(r));

  // ========== 3. 错误码翻译 ==========
  for (const [path_, keyword, label] of [
    ['/feishu/signfail', '加签密钥', '签名校验失败'],
    ['/feishu/keyword', '关键词', '未命中自定义关键词'],
    ['/feishu/ip', 'IP', 'IP 白名单'],
  ]) {
    writeConfig('feishu.json', { webhook_url: BASE + path_ });
    hits.byPath[path_] = 0;
    r = await call('POST', '/feishu/send-test');
    check(`${label} → 中文提示且只请求 1 次`, r.code === 1002 && String(r.message).includes(keyword) && hits.byPath[path_] === 1,
      `code=${r.code} msg=${r.message} 请求=${hits.byPath[path_]}`);
  }

  // ========== 4. 限流会重试 ==========
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/busy' });
  hits.byPath['/feishu/busy'] = 0;
  r = await call('POST', '/feishu/send-test');
  check('限流(11232)会重试 4 次后失败', r.code === 1002 && hits.byPath['/feishu/busy'] === 4,
    `code=${r.code} 请求=${hits.byPath['/feishu/busy']}`);

  // ========== 5. 非 JSON / HTTP 500 不假成功 ==========
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/badjson' });
  r = await call('POST', '/feishu/send-test');
  check('返回 HTML 判为失败（不假成功）', r.code === 1002, JSON.stringify(r));
  const badRow = db.queryOne("SELECT * FROM push_log WHERE push_type='test' ORDER BY created_at DESC LIMIT 1");
  check('失败记录 channel 与状态正确', badRow && badRow.channel === 'feishu' && badRow.status === 'failed',
    JSON.stringify(badRow && { c: badRow.channel, s: badRow.status }));

  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/http500' });
  hits.byPath['/feishu/http500'] = 0;
  r = await call('POST', '/feishu/send-test');
  check('HTTP 500 会重试后失败', r.code === 1002 && hits.byPath['/feishu/http500'] === 4,
    `code=${r.code} 请求=${hits.byPath['/feishu/http500']}`);

  // ========== 6. 长度限制（飞书 20KB 请求体，预算 19000 字节）==========
  for (let i = 0; i < 200; i++) {
    db.run('INSERT INTO reminder (id, pregnancy_id, title, trigger_date, is_completed) VALUES (?,?,?,?,0)',
      ['rm-bulk-f' + i, P1, `第${i}条提醒——这是一条比较长的提醒标题用来把消息撑得足够长以便触发截断逻辑`, tomorrowStr + ' 10:00:00']);
  }
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/ok' });
  r = await call('POST', '/feishu/daily-push', { pregnancy_id: P1 });
  const sentBytes = Buffer.byteLength(JSON.stringify(hits.lastBody), 'utf8');
  const textBytes = Buffer.byteLength(hits.lastBody.content.text, 'utf8');
  check('超长消息仍然推送成功', r.code === 0, JSON.stringify(r));
  check('文本被截断到 19000 字节以内', textBytes <= 19000, `实际=${textBytes}`);
  check('整个请求体在飞书 20KB 上限内', sentBytes <= 20480, `实际=${sentBytes}`);
  check('截断时带说明', hits.lastBody.content.text.includes('截断'), '');

  // ========== 7. 双渠道并存 ==========
  writeConfig('wecom.json', { webhook_url: BASE + '/wecom/ok' });
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/ok' });
  hits.byPath['/wecom/ok'] = 0; hits.byPath['/feishu/ok'] = 0;
  r = await call('POST', '/push/daily-push', { pregnancy_id: P1 });
  check('一键推送同时发到企业微信与飞书',
    r.code === 0 && hits.byPath['/wecom/ok'] === 1 && hits.byPath['/feishu/ok'] === 1,
    `wecom=${hits.byPath['/wecom/ok']} feishu=${hits.byPath['/feishu/ok']}`);
  check('返回信息列出两个渠道', r.data && r.data.results && r.data.results.length === 2 && r.data.partial_failed === false,
    JSON.stringify(r.data));

  const chanRows = db.queryAll("SELECT DISTINCT channel FROM push_log ORDER BY channel");
  check('推送记录里两个渠道都有', chanRows.length === 2 && chanRows[0].channel === 'feishu' && chanRows[1].channel === 'wecom',
    JSON.stringify(chanRows));

  // ========== 8. 记录按渠道过滤 ==========
  let logs = await call('GET', '/push/logs?filter=all&channel=feishu');
  check('按飞书过滤只返回飞书记录', logs.code === 0 && logs.data.length > 0 && logs.data.every(x => x.channel === 'feishu'),
    '条数=' + (logs.data && logs.data.length));
  logs = await call('GET', '/wecom/push-logs?filter=all');
  check('企业微信专属接口只返回企业微信记录', logs.code === 0 && logs.data.every(x => x.channel === 'wecom'),
    '条数=' + (logs.data && logs.data.length));

  // ========== 9. 渠道列表 ==========
  const chans = await call('GET', '/push/channels');
  // 2026-09-29 起渠道扩为 4 个（wecom/feishu/dingtalk/bark），断言改为「至少包含飞书与企微且属性正确」
  check('渠道列表返回全部渠道且飞书/企微属性正确',
    chans.code === 0 && chans.data.length === 4
    && chans.data.some(c => c.channel === 'feishu' && c.needs_secret === true && c.status)
    && chans.data.some(c => c.channel === 'wecom' && c.needs_secret === false)
    && chans.data.some(c => c.channel === 'dingtalk' && c.needs_secret === true)
    && chans.data.some(c => c.channel === 'bark' && c.needs_secret === false),
    JSON.stringify((chans.data || []).map(c => ({ c: c.channel, s: c.needs_secret }))));

  // ========== 10. 一边失败不影响另一边 ==========
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/signfail' });
  writeConfig('wecom.json', { webhook_url: BASE + '/wecom/ok' });
  hits.byPath['/wecom/ok'] = 0;
  r = await call('POST', '/push/daily-push', { pregnancy_id: P1 });
  check('单渠道失败时另一渠道照样送达（部分成功）',
    r.code === 0 && r.data && r.data.partial_failed === true && hits.byPath['/wecom/ok'] === 1,
    JSON.stringify(r.message));
  check('部分成功时提示里含失败渠道与原因', String(r.message).includes('飞书') && String(r.message).includes('加签'),
    r.message);

  // ========== 11. 未配置任何渠道时给明确提示 ==========
  fs.unlinkSync(path.join(STORAGE, 'wecom.json'));
  fs.unlinkSync(path.join(STORAGE, 'feishu.json'));
  r = await call('POST', '/push/daily-push', { pregnancy_id: P1 });
  check('未配置渠道时明确提示去设置', r.code === 1001 && String(r.message).includes('设置页'), JSON.stringify(r));

  // ========== 12. 保存飞书配置（真实接口/真实错误翻译）==========
  r = await call('POST', '/feishu/config', {
    webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000',
    secret: 'my-secret',
  });
  const saved = JSON.parse(fs.readFileSync(path.join(STORAGE, 'feishu.json'), 'utf-8'));
  check('无效 token 时配置仍保存且带上密钥', r.code === 0 && saved.webhook_url.includes('00000000-0000') && saved.secret === 'my-secret',
    JSON.stringify({ code: r.code, secret: saved.secret }));
  check('保存接口告知测试发送失败（真实飞书接口）', r.data && r.data.test_failed === true, JSON.stringify(r.data));
  check('飞书真实错误被翻译成中文', String(r.message).includes('飞书') || String(r.message).includes('Webhook'), r.message);

  const cfgGet = await call('GET', '/feishu/config');
  check('配置读取回显 secret_set 但不回显密钥明文',
    cfgGet.data.secret_set === true && JSON.stringify(cfgGet.data).indexOf('my-secret') === -1,
    JSON.stringify(cfgGet.data));

  // ========== 13. 地址格式校验 ==========
  r = await call('POST', '/feishu/config', { webhook_url: 'https://example.com/foo' });
  check('非飞书域名被拒', r.code === 1001 && String(r.message).includes('域名'), JSON.stringify(r));
  r = await call('POST', '/feishu/config', { webhook_url: 'http://open.feishu.cn/open-apis/bot/v2/hook/x' });
  check('非 https 被拒', r.code === 1001 && String(r.message).includes('https'), JSON.stringify(r));
  r = await call('POST', '/feishu/config', { webhook_url: 'https://open.feishu.cn/other/path' });
  check('缺少 /bot/v2/hook/ 路径被拒', r.code === 1001 && String(r.message).includes('不完整'), JSON.stringify(r));

  // ========== 14. 飞书配置不应该污染企业微信配置 ==========
  await call('POST', '/wecom/config', { webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc' });
  const wecomSaved = JSON.parse(fs.readFileSync(path.join(STORAGE, 'wecom.json'), 'utf-8'));
  check('企业微信配置里不会出现 secret 字段（即使传了）',
    wecomSaved.secret === undefined, JSON.stringify(Object.keys(wecomSaved)));
  await call('POST', '/wecom/config', { webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', secret: 'oops' });
  const wecomSaved2 = JSON.parse(fs.readFileSync(path.join(STORAGE, 'wecom.json'), 'utf-8'));
  check('即使显式传 secret 也不写入企业微信配置', wecomSaved2.secret === undefined, JSON.stringify(Object.keys(wecomSaved2)));

  // ========== 15. 「清除配置」真的清掉（旧版本界面以为清了、其实还在）==========
  writeConfig('feishu.json', { webhook_url: BASE + '/feishu/ok', secret: 'to-be-cleared' });
  r = await call('POST', '/feishu/config', { webhook_url: '' });
  const afterClear = JSON.parse(fs.readFileSync(path.join(STORAGE, 'feishu.json'), 'utf-8'));
  check('清除配置真的清掉 webhook 与密钥',
    r.code === 0 && !afterClear.webhook_url && !afterClear.secret,
    JSON.stringify({ code: r.code, url: afterClear.webhook_url, secret: afterClear.secret }));
  const listAfterClear = await call('GET', '/push/channels');
  const fc = (listAfterClear.data || []).find(c => c.channel === 'feishu');
  check('清除后渠道列表显示未配置', fc && fc.configured === false, JSON.stringify(fc && fc.configured));
  r = await call('POST', '/feishu/daily-push', { pregnancy_id: P1 });
  check('清除后推送会被拦住并提示去配置', r.code === 1001 && String(r.message).includes('配置'), JSON.stringify(r));

  // ========== 16. 再存一次地址不会把内容勾选重置回全选 ==========
  // 注意：配置保存接口会校验地址格式（必须是 open.feishu.cn/bot/v2/hook/），
  // 所以这里用「格式合法但 token 无效」的真实地址 —— 测试发送会失败，但配置一定会落盘。
  const REAL_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000';
  const readCfg = () => JSON.parse(fs.readFileSync(path.join(STORAGE, 'feishu.json'), 'utf-8'));

  r = await call('POST', '/feishu/config', { webhook_url: REAL_URL, push_reminder: false, push_checkup: true, push_daily: true });
  check('保存配置成功（格式合法）', r.code === 0, JSON.stringify(r));
  const before = readCfg();
  await call('POST', '/feishu/config', { webhook_url: REAL_URL }); // 只更新地址
  const after = readCfg();
  check('再次保存地址不会把内容勾选重置回全选',
    before.push_reminder === false && after.push_reminder === false,
    JSON.stringify({ 之前: before.push_reminder, 之后: after.push_reminder }));

  // ========== 17. 只改偏好不动地址 ==========
  r = await call('POST', '/feishu/config', { push_time: '20:30' });
  const afterPrefs = readCfg();
  check('只改时间：地址保留、时间生效',
    r.code === 0 && afterPrefs.push_time === '20:30' && String(afterPrefs.webhook_url).includes('open.feishu.cn'),
    JSON.stringify({ code: r.code, time: afterPrefs.push_time, url: !!afterPrefs.webhook_url }));
  check('只改时间不触发测试发送（不会打扰群）', !String(r.message).includes('测试'), r.message);
  check('只改时间不会丢掉已取消的勾选', afterPrefs.push_reminder === false, JSON.stringify(afterPrefs.push_reminder));

  api.close();
  mock.close();

  console.log('\n============ 飞书推送集成测试 ============');
  console.log(results.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(2); });
