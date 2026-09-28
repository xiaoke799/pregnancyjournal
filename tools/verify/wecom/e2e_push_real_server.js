/**
 * 端到端：真实运行中的 server.js（TCP 垫片）→ 真实 HTTP → 模拟企业微信 + 模拟飞书
 * 覆盖：建孕期 → 存 webhook → 双渠道一键推送 → 推送记录 → 旧接口兼容 → 网关前缀路径
 *
 * 前置：需先起真服务（隔离目录，端口 38471）：
 *   cd app/server/node && PJ_TCP_PORT=38471 STORAGE_DIR=<隔离目录> DATA_DIR=<隔离目录> \
 *     ASSETS_DIR=<隔离目录> DATABASE_PATH=<隔离目录>/pj.db APP_MODE=dev \
 *     node -r ../../tcp_shim.js server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const SRV = 'http://127.0.0.1:38471';
const SMOKE = path.join(require('../_env').TMP, 'smoke');
const MOCK_PORT = 39130;
const BASE = `http://127.0.0.1:${MOCK_PORT}`;

let pass = 0, fail = 0;
const out = [];
const check = (n, c, e) => { c ? (pass++, out.push(`  ✔ ${n}`)) : (fail++, out.push(`  ✘ ${n}${e ? '  ← ' + e : ''}`)); };

function req(url, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request(url, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({ raw: b }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const received = { wecom: [], feishu: [] };
const mock = http.createServer((rq, rs) => {
  let b = ''; rq.on('data', c => b += c);
  rq.on('end', () => {
    const isFeishu = rq.url.startsWith('/feishu');
    try {
      const parsed = JSON.parse(b);
      received[isFeishu ? 'feishu' : 'wecom'].push(isFeishu ? parsed.content.text : parsed.text.content);
    } catch { received[isFeishu ? 'feishu' : 'wecom'].push(b); }
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(isFeishu ? '{"code":0,"msg":"success","data":{}}' : '{"errcode":0,"errmsg":"ok"}');
  });
});

(async () => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));

  // 0. 服务健康 + 路由数量（本轮新增 feishu / push 两个路由模块 → 22）
  const health = await req(SRV + '/api/health');
  check('服务健康且 22 个路由全部加载', health.status === 'ok' && health.routes === 22, JSON.stringify(health));

  // 1. 建孕期
  const preg = await req(SRV + '/api/v1/pregnancies', 'POST', { last_period_date: '2026-01-01', baby_name: '测试宝宝' });
  check('创建孕期成功', preg.code === 0 && preg.data && preg.data.id, JSON.stringify(preg));
  const pid = preg.data && preg.data.id;

  // 2. 写入两个渠道的配置（模拟用户已在设置页填好）
  const stDir = path.join(SMOKE, 'storage');
  fs.writeFileSync(path.join(stDir, 'wecom.json'), JSON.stringify({
    webhook_url: BASE + '/wecom/hook', configured: true, enabled: true,
    push_checkup: true, push_daily: true, push_reminder: true, push_time: '08:00',
  }, null, 2));
  fs.writeFileSync(path.join(stDir, 'feishu.json'), JSON.stringify({
    webhook_url: BASE + '/feishu/hook', secret: 'e2e-secret', configured: true, enabled: true,
    push_checkup: true, push_daily: true, push_reminder: true, push_time: '08:00',
  }, null, 2));

  const st = await req(SRV + '/api/v1/wecom/status');
  check('企业微信状态识别到已配置', st.data && st.data.configured === true, JSON.stringify(st));

  const chans = await req(SRV + '/api/v1/push/channels');
  check('渠道列表返回企业微信 + 飞书两个渠道',
    chans.code === 0 && chans.data.length === 2 && chans.data.some(c => c.channel === 'feishu'),
    JSON.stringify((chans.data || []).map(c => c.channel)));

  // 3. 一键推送 → 两个渠道都收到
  const push = await req(SRV + '/api/v1/push/daily-push', 'POST', { pregnancy_id: pid });
  check('一键推送成功', push.code === 0, JSON.stringify(push));
  check('企业微信群机器人收到消息', received.wecom.length === 1, '收到=' + received.wecom.length);
  check('飞书群机器人也收到消息', received.feishu.length === 1, '收到=' + received.feishu.length);
  check('两条消息内容一致（同一份看板）', received.wecom[0] === received.feishu[0], '');
  check('消息里带孕周信息', /孕\d+周/.test(received.wecom[0] || ''), (received.wecom[0] || '').slice(0, 40));

  // 4. 推送记录：两条、渠道各一
  const logs = await req(SRV + '/api/v1/push/logs?filter=today');
  check('推送记录两条且都成功',
    logs.code === 0 && logs.data.length === 2 && logs.data.every(l => l.status === 'success'),
    JSON.stringify((logs.data || []).map(l => [l.channel, l.status])));
  check('记录里区分了两个渠道',
    new Set((logs.data || []).map(l => l.channel)).size === 2,
    JSON.stringify((logs.data || []).map(l => l.channel)));

  // 5. 按渠道过滤
  const onlyFeishu = await req(SRV + '/api/v1/push/logs?filter=today&channel=feishu');
  check('按飞书过滤只剩飞书记录',
    onlyFeishu.code === 0 && onlyFeishu.data.length === 1 && onlyFeishu.data[0].channel === 'feishu',
    JSON.stringify((onlyFeishu.data || []).map(l => l.channel)));

  // 6. 旧路径仍然可用（向后兼容）
  const legacy = await req(SRV + '/api/v1/wecom/push-logs?filter=today');
  check('旧的企业微信记录接口仍可用且只返回企业微信', legacy.code === 0 && legacy.data.every(l => l.channel === 'wecom'),
    JSON.stringify((legacy.data || []).map(l => l.channel)));

  // 7. 网关前缀路径同样可用（前端真实访问路径）
  const gw = await req(SRV + '/app/pregnancyjournal/api/v1/push/channels');
  check('带网关前缀的推送接口可访问', gw.code === 0 && gw.data.length === 2, JSON.stringify(gw).slice(0, 80));

  mock.close();
  console.log('\n========= 真实服务端 端到端推送测试（双渠道） =========');
  console.log(out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('异常:', e); process.exit(2); });
