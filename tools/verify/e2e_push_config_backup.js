/**
 * 「用户填写的推送 API 配置」备份往返测试
 *
 * 防的是什么：
 *   用户在设置页填写的 Webhook 地址 / 加签密钥，存在 DATA_DIR 下的 json 文件里
 *   （wecom.json / feishu.json），**不是数据库表**。备份要把这些文件打包进去、
 *   恢复时还要送回 DATA_DIR（而不是 ASSETS_DIR 安装目录，那里随升级被覆盖）。
 *   飞书渠道两处都漏了登记 ⇒ 用户「备份过、升级后恢复，飞书配置没了」。
 *
 * 做法：写飞书/企微配置 → 备份 → 删掉源文件 → 恢复 → 核对内容原样回到 DATA_DIR。
 * 用法：node e2e_push_config_backup.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-pushcfg-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38493);
const AUTH_DIR = path.join(T, 'authorized');

// 安装目录类比：ASSETS_DIR 默认 = config.js 同级的 data/（未被环境变量覆盖）。
// 恢复时若把用户配置错写到这里，就是「升级后被冲掉」的现场。
const ASSETS_DIR = path.join(NODE_DIR, 'data');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

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
  TRIM_DATA_ACCESSIBLE_PATHS: AUTH_DIR,
};

function req(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, json: null, raw: data }); } });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  [OK]   ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${extra ? '  ← ' + extra : ''}`); }
}

const FEISHU_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/e2e-1234-5678';
const WECOM_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=e2e-abcdef';

(async () => {
  const srvLog = [];
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env });
  child.stdout.on('data', (d) => srvLog.push(String(d)));
  child.stderr.on('data', (d) => srvLog.push(String(d)));

  for (let i = 0; i < 60; i++) {
    try { const h = await req('GET', '/api/health'); if (h.json && h.json.status === 'ok') break; } catch {}
    await sleep(500);
  }

  try {
    // 前置：确保「安装目录」里本来没有这两个文件，后面的「没落到 ASSETS_DIR」断言才可信
    const assetsBefore = ['feishu.json', 'wecom.json'].filter((f) => fs.existsSync(path.join(ASSETS_DIR, f)));
    check('前置：安装目录（ASSETS_DIR）内原本没有渠道配置文件',
      assetsBefore.length === 0, assetsBefore.join(', '));

    console.log('\n########## 1. 用户在设置页填写推送配置 ##########');
    const f = await req('POST', '/api/v1/feishu/config', {
      webhook_url: FEISHU_URL, secret: 'sec-e2e-8888',
      push_time: '09:30', push_checkup: true, push_daily: false, push_reminder: true, enabled: true,
    });
    // 保存时会顺带发一条测试消息；本机无外网 → test_failed=true 属正常，配置本身已落盘。
    check('飞书配置接口返回成功（code=0）', f.json && f.json.code === 0,
      JSON.stringify(f.json && f.json.message));

    const wc = await req('POST', '/api/v1/wecom/config', {
      webhook_url: WECOM_URL,
      push_time: '08:15', push_checkup: false, push_daily: true, push_reminder: true, enabled: true,
    });
    check('企业微信配置接口返回成功（code=0）', wc.json && wc.json.code === 0,
      JSON.stringify(wc.json && wc.json.message));

    const feishuPath = path.join(T, 'feishu.json');
    const wecomPath = path.join(T, 'wecom.json');
    check('飞书配置已写入 DATA_DIR', fs.existsSync(feishuPath), feishuPath);
    check('企业微信配置已写入 DATA_DIR', fs.existsSync(wecomPath), wecomPath);

    const feishuCfg = JSON.parse(fs.readFileSync(feishuPath, 'utf-8'));
    const wecomCfg = JSON.parse(fs.readFileSync(wecomPath, 'utf-8'));
    check('飞书文件内容正确（地址/密钥/时间/开关）',
      feishuCfg.webhook_url === FEISHU_URL && feishuCfg.secret === 'sec-e2e-8888'
      && feishuCfg.push_time === '09:30' && feishuCfg.push_daily === false && feishuCfg.push_checkup === true,
      JSON.stringify(feishuCfg));
    check('企业微信文件内容正确（地址/时间/开关）',
      wecomCfg.webhook_url === WECOM_URL && wecomCfg.push_time === '08:15' && wecomCfg.push_checkup === false,
      JSON.stringify(wecomCfg));

    console.log('\n########## 2. 备份 ##########');
    const bk = await req('POST', '/api/v1/backup', { dir: AUTH_DIR });
    check('备份成功', bk.json && bk.json.code === 0, JSON.stringify(bk.json && bk.json.message));
    const bkDir = bk.json && bk.json.data && bk.json.data.dir;
    const cfgDir = path.join(bkDir || '', 'files', 'config');
    const packed = fs.existsSync(cfgDir) ? fs.readdirSync(cfgDir) : [];
    check('备份里打包了 feishu.json  ← 本次修复点', packed.includes('feishu.json'), packed.join(', '));
    check('备份里打包了 wecom.json（对照组，本来就有的）', packed.includes('wecom.json'), packed.join(', '));

    const packedFeishu = path.join(cfgDir, 'feishu.json');
    if (fs.existsSync(packedFeishu)) {
      const pc = JSON.parse(fs.readFileSync(packedFeishu, 'utf-8'));
      check('备份里的飞书内容与源一致', pc.webhook_url === FEISHU_URL && pc.secret === 'sec-e2e-8888');
    }

    console.log('\n########## 3. 删掉源配置（模拟「升级/换机后配置没了」）##########');
    fs.rmSync(feishuPath, { force: true });
    fs.rmSync(wecomPath, { force: true });
    check('源配置已删除（恢复前确实是空的）',
      !fs.existsSync(feishuPath) && !fs.existsSync(wecomPath));

    console.log('\n########## 4. 恢复备份 ##########');
    const rl = await req('POST', '/api/v1/restore-latest', {});
    check('恢复成功', rl.json && rl.json.code === 0, JSON.stringify(rl.json && rl.json.message));

    console.log('\n########## 5. 核对恢复结果 ##########');
    check('飞书配置回到了 DATA_DIR  ← 本次修复点', fs.existsSync(feishuPath), feishuPath);
    check('企业微信配置回到了 DATA_DIR（对照组）', fs.existsSync(wecomPath), wecomPath);
    check('飞书配置**没有**被错写到安装目录（ASSETS_DIR）',
      !fs.existsSync(path.join(ASSETS_DIR, 'feishu.json')), path.join(ASSETS_DIR, 'feishu.json'));
    check('企业微信配置**没有**被错写到安装目录（ASSETS_DIR）',
      !fs.existsSync(path.join(ASSETS_DIR, 'wecom.json')));

    if (fs.existsSync(feishuPath)) {
      const back = JSON.parse(fs.readFileSync(feishuPath, 'utf-8'));
      check('恢复后飞书地址一致', back.webhook_url === FEISHU_URL, JSON.stringify(back.webhook_url));
      check('恢复后飞书加签密钥一致  ← 漏了它等于推送发不出去', back.secret === 'sec-e2e-8888');
      check('恢复后飞书推送时间一致', back.push_time === '09:30', JSON.stringify(back.push_time));
      check('恢复后飞书开关一致（每日关、产检开）',
        back.push_daily === false && back.push_checkup === true,
        JSON.stringify({ daily: back.push_daily, checkup: back.push_checkup }));
    }
    if (fs.existsSync(wecomPath)) {
      const back = JSON.parse(fs.readFileSync(wecomPath, 'utf-8'));
      check('恢复后企业微信地址一致', back.webhook_url === WECOM_URL);
      check('恢复后企业微信开关一致（产检关）', back.push_checkup === false);
    }

    // 最关键的一条：应用自己读回来要是「已配置」，而不是只文件在那儿
    const st = await req('GET', '/api/v1/feishu/config');
    const cfg = (st.json && st.json.data) || {};
    check('应用读回飞书配置：configured=true', cfg.configured === true, JSON.stringify(cfg).slice(0, 160));
    check('应用读回飞书配置：secret_set=true', cfg.secret_set === true, JSON.stringify(cfg).slice(0, 160));
    const st2 = await req('GET', '/api/v1/wecom/config');
    check('应用读回企业微信配置：configured=true',
      ((st2.json && st2.json.data) || {}).configured === true,
      JSON.stringify(st2.json && st2.json.data).slice(0, 160));

    console.log('\n########## 6. 静态护栏：两份清单必须口径一致 ##########');
    // 不变式：**凡是从 DATA_DIR（用户数据区）打包进备份的配置，恢复侧必须都认得**，
    // 否则会被当成「内置只读资源」写到安装目录 → 升级即丢。飞书就是这么漏的。
    // 反过来，ASSETS_DIR 来的内置知识库**不该**出现在可写清单里（它们只补写不覆盖）。
    const src = fs.readFileSync(path.join(NODE_DIR, 'routes', 'export.js'), 'utf-8');
    const m1 = src.match(/const WRITABLE_CONFIG_FILES = new Set\(\[([\s\S]*?)\]\)/);
    const m2 = src.match(/const configSources = \[([\s\S]*?)\];/);
    const m3 = src.match(/const BUILTIN_RESOURCE_FILES = new Set\(\[([\s\S]*?)\]\)/);
    const names = (block) => new Set((block || '').match(/'([^']+)'/g) || []);
    const writable = names(m1 && m1[1]);
    const builtin = names(m3 && m3[1]);

    const entries = ((m2 && m2[1]) || '').match(/\{\s*name:\s*'[^']+',\s*srcPath:[^}]+\}/g) || [];
    check('静态检查：解析到备份配置清单条目', entries.length > 0, `共 ${entries.length} 条`);
    const fromData = [], fromAssets = [];
    for (const e of entries) {
      const n = (e.match(/name:\s*'([^']+)'/) || [])[1];
      const fromDataDir = /config\.DATA_DIR/.test(e);
      const fromAssetsDir = /config\.ASSETS_DIR/.test(e);
      if (fromDataDir) fromData.push(n);
      else if (fromAssetsDir) fromAssets.push(n);
    }
    const missing = fromData.filter((n) => !writable.has(`'${n}'`));
    check('DATA_DIR 来的配置项全部登记在恢复侧可写清单',
      missing.length === 0, missing.length ? '漏登记: ' + missing.join(', ') : `已登记 ${fromData.length} 项: ${fromData.join(', ')}`);
    const misplaced = fromAssets.filter((n) => writable.has(`'${n}'`));
    check('ASSETS_DIR 来的内置知识库没有混进可写清单',
      misplaced.length === 0, misplaced.join(', '));
    check('恢复侧分流清单含 feishu.json（静态复核）', writable.has("'feishu.json'"));
    check('内置知识库清单含三份只读资源（未被误删）',
      builtin.has("'recipes.json'") && builtin.has("'checkup_schedule.json'") && builtin.has("'food_safety_v3.json'"));
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.join('').slice(-1500));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();
