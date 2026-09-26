/**
 * 推送引擎（渠道无关）
 *
 * 设计要点：
 * - **一个调度器**：同时管理多个渠道（企业微信 / 飞书），每个渠道有自己的时间与开关。
 * - **一份内容**：每日看板只构建一次，发给所有到点且启用的渠道。
 * - **失败必留痕**：严格校验响应 + 自动重试 + 只在成功时才标记「今天已推」。
 *
 * 各渠道差异（Webhook 协议完全不同，必须分开处理）：
 * | 项 | 企业微信 | 飞书 |
 * | --- | --- | --- |
 * | 地址 | qyapi.weixin.qq.com/cgi-bin/webhook/send?key= | open.feishu.cn/open-apis/bot/v2/hook/ |
 * | 文本字段 | `{msgtype:'text', text:{content}}` | `{msg_type:'text', content:{text}}` |
 * | 成功判定 | `errcode === 0` | `code === 0` |
 * | 内容上限 | 2048 字节 | 请求体 ≤ 20KB（取 19KB 文本预算） |
 * | 加签 | 无 | 可选：HmacSHA256(key = timestamp+"\n"+secret, msg = 空) → Base64 |
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const dayjs = require('dayjs');
const config = require('../config');
const log = require('../logger');

// ========== 时间工具 ==========
// 统一使用「本地时间」字符串（YYYY-MM-DD HH:mm:ss）。
// 不要用 toISOString()：东八区 08:00 前日期会算成前一天，推送记录也会显示差 8 小时。
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localStamp(d = new Date()) {
  return `${localDateStr(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
function timeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ========== 渠道定义 ==========
const CHANNELS = {
  wecom: {
    key: 'wecom',
    name: '企业微信',
    configFile: 'wecom.json',
    needsSecret: false,
    urlPlaceholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx',
    textLimitBytes: 2000, // 官方上限 2048，留余量
    urlError(url) {
      if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=.+/.test(url)) {
        return '企业微信 Webhook 地址格式不正确（应以 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key= 开头）';
      }
      return null;
    },
    buildBody(text) {
      return JSON.stringify({ msgtype: 'text', text: { content: text } });
    },
    parseResponse(json) {
      const code = Number(json.errcode);
      if (code === 0) return { ok: true };
      return { ok: false, code, message: friendlyWecomError(code, json.errmsg) };
    },
    retryableCodes: new Set([-1, 45009, 45033, 40014, 42001]),
  },

  feishu: {
    key: 'feishu',
    name: '飞书',
    configFile: 'feishu.json',
    needsSecret: true,
    urlPlaceholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx',
    textLimitBytes: 19000, // 请求体整体 ≤ 20KB
    urlError(url) {
      let u;
      try { u = new URL(url); } catch { return '飞书 Webhook 地址格式不正确'; }
      if (u.protocol !== 'https:') return '飞书 Webhook 地址必须以 https 开头';
      const okHost = /(^|\.)feishu\.cn$/.test(u.hostname) || /(^|\.)larksuite\.com$/.test(u.hostname);
      if (!okHost) return '飞书 Webhook 地址域名不正确（应为 open.feishu.cn）';
      if (!u.pathname.includes('/bot/v2/hook/')) return '飞书 Webhook 地址不完整，请重新复制（应包含 /bot/v2/hook/）';
      return null;
    },
    // 飞书「签名校验」模式：string_to_sign 当密钥，对空内容做 HmacSHA256 再 Base64
    signBody(text, cfg) {
      const body = { msg_type: 'text', content: { text } };
      const secret = (cfg.secret || '').trim();
      if (secret) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        body.timestamp = timestamp;
        body.sign = crypto.createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
      }
      return JSON.stringify(body);
    },
    buildBody(text, cfg) {
      // 无密钥时走这里（有密钥时 sendChannelOnce 会优先用 signBody）
      return JSON.stringify({ msg_type: 'text', content: { text } });
    },
    parseResponse(json) {
      // 兼容冗余字段 StatusCode（老版本），但以 code/msg 为准
      const code = Number(json.code !== undefined ? json.code : json.StatusCode);
      if (code === 0) return { ok: true };
      return { ok: false, code, message: friendlyFeishuError(code, json.msg || json.StatusMessage) };
    },
    retryableCodes: new Set([11232]), // 限流（整点/半点高峰）
  },
};

function channelList() {
  return Object.values(CHANNELS);
}
function getChannel(key) {
  return CHANNELS[key] || null;
}

// ========== 错误翻译（让用户看得懂该去改什么）==========
function friendlyWecomError(code, msg) {
  const map = {
    93000: 'Webhook 地址无效或机器人已被删除，请在群里重新复制地址',
    93001: 'Webhook 地址不完整，请重新复制完整的地址',
    93002: 'Webhook 地址已失效，请重新复制',
    45009: '推送过于频繁（企业微信限制每个机器人每分钟 20 条），稍后会自动重试',
    40001: '企业微信鉴权失败，请重新复制 Webhook 地址',
    40014: '企业微信凭证已失效，请重新复制 Webhook 地址',
    41001: '缺少必要参数，Webhook 地址可能不完整',
    40058: '消息内容格式不正确',
    40056: '消息内容过长',
  };
  const base = map[code] || (msg || '企业微信返回错误');
  return `${base}（errcode ${code}）`;
}

function friendlyFeishuError(code, msg) {
  const map = {
    9499: '消息格式不正确或内容过长，请稍后重试',
    19001: 'Webhook 地址无效，请在群里重新复制机器人地址',
    19021: '签名校验失败：请检查「加签密钥」是否填对，并确认 NAS 系统时间准确',
    19022: 'IP 不在白名单内：请在飞书机器人安全设置里关闭 IP 白名单或加入 NAS 的出口 IP',
    19024: '机器人开启了「自定义关键词」，消息里必须包含该关键词（建议把关键词设为：孕程记）',
    11232: '推送触发限流（飞书在整点/半点较繁忙），稍后会自动重试',
  };
  const base = map[code] || (msg || '飞书返回错误');
  return `${base}（code ${code}）`;
}

function friendlyNetworkError(err) {
  const c = err && err.code;
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return '无法解析推送服务器域名，请检查 NAS 的网络和 DNS 设置';
  if (c === 'ECONNREFUSED') return '连接被拒绝，请检查 NAS 的网络或防火墙设置';
  if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEDOUT') return '连接推送服务器超时，请检查 NAS 的外网连接';
  if (c === 'ECONNRESET' || c === 'EPIPE') return '连接被重置（网络不稳定），稍后会自动重试';
  if (c && String(c).includes('CERT')) return 'HTTPS 证书校验失败，请检查 NAS 的系统时间与证书设置';
  return `网络请求失败：${(err && err.message) || String(err)}`;
}

// ========== 配置读写 ==========
const DEFAULT_CONFIG = {
  webhook_url: '',
  secret: '',            // 仅飞书用（加签密钥，可留空）
  configured: false,
  enabled: true,
  push_checkup: true,
  push_daily: true,
  push_reminder: true,
  push_time: '08:00',
};

function channelConfigPath(channel) {
  return path.join(config.DATA_DIR, channel.configFile);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readChannelConfig(channelKey) {
  const channel = getChannel(channelKey);
  if (!channel) return { ...DEFAULT_CONFIG };
  const file = channelConfigPath(channel);
  ensureDir(file);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (raw && typeof raw === 'object') return { ...DEFAULT_CONFIG, ...raw };
    }
  } catch (e) {
    log.warn('推送', `读取 ${channel.name} 配置失败，使用默认配置: ${e.message}`);
  }
  return { ...DEFAULT_CONFIG };
}

function writeChannelConfig(channelKey, cfg) {
  const channel = getChannel(channelKey);
  if (!channel) return;
  const file = channelConfigPath(channel);
  ensureDir(file);
  const out = { ...DEFAULT_CONFIG, ...cfg };
  // 加签密钥不属于企业微信，避免脏字段写进配置
  if (!channel.needsSecret) delete out.secret;
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf-8');
}

/** 是否至少勾选了一类推送内容（三项全关 = 不推送） */
function hasAnyContent(cfg) {
  return cfg.push_daily !== false || cfg.push_checkup !== false || cfg.push_reminder !== false;
}

// ========== 发送 ==========

// 重试间隔（第一次失败后等 1s，再 3s，再 8s）→ 共 4 次尝试
const RETRY_DELAYS_MS = [1000, 3000, 8000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 按字节数安全截断（优先保留整行），避免超过渠道的内容上限被整条拒收 */
function truncateForChannel(text, maxBytes) {
  const src = String(text == null ? '' : text);
  if (Buffer.byteLength(src, 'utf8') <= maxBytes) return src;

  const notice = '\n…（内容过长已截断，请打开孕程记查看完整内容）';
  const budget = maxBytes - Buffer.byteLength(notice, 'utf8');
  const kept = [];
  let used = 0;
  for (const line of src.split('\n')) {
    const cost = Buffer.byteLength(line, 'utf8') + 1; // +1 = 换行符
    if (used + cost > budget) break;
    kept.push(line);
    used += cost;
  }
  return kept.join('\n') + notice;
}

/** 单次发送（不重试）。失败时抛出的 Error 会带 permanent 标记 */
function sendChannelOnce(channel, cfg, textContent) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(cfg.webhook_url);
    } catch {
      const e = new Error('Webhook 地址格式不正确，请重新复制');
      e.permanent = true;
      return reject(e);
    }

    const transport = url.protocol === 'https:' ? https : http;
    // 飞书有密钥时需要带 timestamp/sign
    const data = (channel.signBody && (cfg.secret || '').trim())
      ? channel.signBody(textContent, cfg)
      : channel.buildBody(textContent, cfg);

    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const ok = (v) => { if (!settled) { settled = true; resolve(v); } };

    let req;
    try {
      req = transport.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': `pregnancy-journal/${config.APP_VERSION || '0'}`,
        },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          // 1) HTTP 状态码必须 2xx（此前完全不看，错误页会被当成成功）
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const e = new Error(`${channel.name}接口返回 HTTP ${res.statusCode}${body ? `：${body.slice(0, 120)}` : ''}`);
            if (res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 404) e.permanent = true;
            return fail(e);
          }
          // 2) 必须能解析出 JSON（网关会返回 HTML 错误页）
          let json = null;
          try { json = JSON.parse(body); } catch { /* 交给下面 */ }
          if (!json || typeof json !== 'object') {
            const e = new Error(`${channel.name}返回了无法识别的内容，可能网络被拦截或地址不正确${body ? `：${body.slice(0, 80)}` : ''}`);
            e.permanent = true;
            return fail(e);
          }
          // 3) 业务错误码必须为 0
          const verdict = channel.parseResponse(json);
          if (verdict.ok) return ok({ attempts: 1 });
          const e = new Error(verdict.message);
          e.errcode = verdict.code;
          if (!channel.retryableCodes.has(verdict.code)) e.permanent = true;
          fail(e);
        });
      });
    } catch (err) {
      return fail(err);
    }

    req.on('error', (err) => {
      const e = new Error(friendlyNetworkError(err));
      e.networkCode = err && err.code;
      fail(e);
    });
    req.setTimeout(15000, () => {
      fail(new Error('连接推送服务器超时（15 秒），请检查 NAS 的外网连接'));
      try { req.destroy(); } catch { /* ignore */ }
    });
    req.write(data);
    req.end();
  });
}

/**
 * 发送消息到指定渠道（带自动重试）
 * @returns {Promise<{attempts:number, truncated:boolean}>}
 */
async function sendChannelMessage(channelKey, cfg, textContent, opts = {}) {
  const channel = getChannel(channelKey);
  if (!channel) throw new Error(`未知推送渠道: ${channelKey}`);

  const text = truncateForChannel(textContent, channel.textLimitBytes);
  const truncated = text !== textContent;
  const maxAttempts = (opts.retries === undefined ? RETRY_DELAYS_MS.length : opts.retries) + 1;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendChannelOnce(channel, cfg, text);
      if (attempt > 1) log.info('推送', `[${channel.name}] 第 ${attempt} 次尝试推送成功`);
      return { attempts: attempt, truncated };
    } catch (e) {
      lastErr = e;
      if (e.permanent || attempt >= maxAttempts) break;
      const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      log.warn('推送', `[${channel.name}] 第 ${attempt} 次推送失败（${e.message}），${wait}ms 后重试`);
      await sleep(wait);
    }
  }
  throw lastErr || new Error('推送失败');
}

// ========== 推送日志 ==========
async function recordPushLog(pushType, content, status, errorMsg, payload, channelKey) {
  const now = localStamp();
  const channel = channelKey || 'wecom';
  try {
    const id = uuidv4();
    await db.run(
      'INSERT INTO push_log (id, push_type, push_content, status, error_message, pushed_at, created_at, payload, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, pushType, content || '', status, errorMsg || null, null, now, payload || null, channel]
    );
    return id;
  } catch (e) {
    // 老库未迁移出新列时逐级降级（不能因此丢日志）
    for (const sql of [
      'INSERT INTO push_log (id, push_type, push_content, status, error_message, pushed_at, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      'INSERT INTO push_log (id, push_type, push_content, status, error_message, pushed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ]) {
      try {
        const id = uuidv4();
        const params = sql.includes('payload')
          ? [id, pushType, content || '', status, errorMsg || null, null, now, payload || null]
          : [id, pushType, content || '', status, errorMsg || null, null, now];
        await db.run(sql, params);
        return id;
      } catch { /* 继续降级 */ }
    }
    log.warn('推送', `写推送日志失败: ${e.message}`);
    return null;
  }
}

async function finishPushLog(logId, status, errorMsg, payload) {
  if (!logId) return;
  try {
    if (status === 'success') {
      await db.run("UPDATE push_log SET status='success', error_message=NULL, pushed_at=?, payload=COALESCE(?, payload) WHERE id=?", [localStamp(), payload || null, logId]);
    } else {
      await db.run('UPDATE push_log SET status=?, error_message=? WHERE id=?', [status, errorMsg || null, logId]);
    }
  } catch (e) {
    try {
      await db.run('UPDATE push_log SET status=?, error_message=? WHERE id=?', [status, errorMsg || null, logId]);
    } catch { /* ignore */ }
  }
}

// ========== 静态产检时间表 ==========
// schedule_dates.schedule_id 指向内置 checkup_schedule.json 的 id（该表不在数据库里）。
let _scheduleMapCache = null;
let _scheduleMapMtime = -1;
function getScheduleMap() {
  const jsonPath = path.join(config.ASSETS_DIR, 'checkup_schedule.json');
  try {
    const mtime = fs.existsSync(jsonPath) ? fs.statSync(jsonPath).mtimeMs : 0;
    if (_scheduleMapCache && _scheduleMapMtime === mtime) return _scheduleMapCache;
    const map = {};
    if (mtime) {
      const list = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (Array.isArray(list)) {
        for (const it of list) {
          if (it && it.id) map[it.id] = { name: it.name, week_range: it.week_range };
        }
      }
    }
    _scheduleMapCache = map;
    _scheduleMapMtime = mtime;
    return map;
  } catch {
    return _scheduleMapCache || {};
  }
}

// ========== 每日看板内容 ==========
/**
 * 勾选项含义（与设置页三个勾选框对应）：
 *   push_daily    → 孕期概览（孕周 / 距预产期）
 *   push_checkup  → 产检安排（内置排期 + 自定义产检）
 *   push_reminder → 提醒事项
 * 三项全关时不推送（由调度器判断）。
 */
function buildDailyBoardText(pregnancyId, cfg) {
  const includeSummary = cfg.push_daily !== false;
  const includeCheckup = cfg.push_checkup !== false;
  const includeReminder = cfg.push_reminder !== false;

  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const weekLater = dayjs().add(7, 'day').format('YYYY-MM-DD');

  const pregnancy = db.queryOne(
    'SELECT last_period_date, due_date FROM pregnancy WHERE id = ?',
    [pregnancyId]
  );
  if (!pregnancy) throw new Error('未找到孕期记录');

  const lines = [];
  lines.push('【孕程记 · 每日看板】');

  if (includeSummary) {
    let gestationalWeek = '?';
    let daysUntilDue = '?';
    if (pregnancy.last_period_date) {
      const lmpDay = dayjs(pregnancy.last_period_date);
      gestationalWeek = Math.floor(dayjs().diff(lmpDay, 'day') / 7);
      if (pregnancy.due_date) daysUntilDue = dayjs(pregnancy.due_date).diff(dayjs(), 'day');
    }
    const dueText = typeof daysUntilDue === 'number'
      ? (daysUntilDue > 0 ? `距预产期${daysUntilDue}天` : daysUntilDue === 0 ? '今天预产期！' : `已过预产期${Math.abs(daysUntilDue)}天`)
      : '';
    lines.push(`📅 ${today}  |  孕${gestationalWeek}周  |  ${dueText}`);
  } else {
    lines.push(`📅 ${today}`);
  }
  lines.push('');

  if (includeCheckup || includeReminder) {
    // --- 明日待办 ---
    lines.push(`>>> 明日待办 (${tomorrow}) <<<`);
    const tomorrowLines = [];

    if (includeCheckup) {
      const scheduleMap = getScheduleMap();
      const tomorrowCheckups = db.queryAll(
        'SELECT schedule_id, checkup_date FROM schedule_dates WHERE pregnancy_id = ? AND checkup_date = ?',
        [pregnancyId, tomorrow]
      ).map(r => ({ ...r, ...(scheduleMap[r.schedule_id] || {}) }));
      for (const c of tomorrowCheckups) tomorrowLines.push(`⚠️ 【产检】${c.name || c.schedule_id} ${c.week_range || ''}`);

      const tomorrowCustoms = db.queryAll(
        'SELECT name FROM custom_checkup WHERE pregnancy_id = ? AND checkup_date = ? AND is_completed = 0',
        [pregnancyId, tomorrow]
      );
      for (const c of tomorrowCustoms) tomorrowLines.push(`⚠️ 【自定义产检】${c.name}`);
    }

    if (includeReminder) {
      const tomorrowReminders = db.queryAll(
        "SELECT title FROM reminder WHERE pregnancy_id = ? AND trigger_date LIKE ? AND is_completed = 0",
        [pregnancyId, tomorrow + '%']
      );
      for (const r of tomorrowReminders) tomorrowLines.push(`⚠️ 【提醒】${r.title}`);
    }

    if (tomorrowLines.length === 0) lines.push('✅ 明日暂无安排，好好休息~');
    else lines.push(...tomorrowLines);
    lines.push('');

    // --- 近7天 ---
    lines.push('>>> 近7天安排 <<<');
    const upcomingLines = [];

    if (includeCheckup) {
      const scheduleMap = getScheduleMap();
      const upcomingCheckups = db.queryAll(
        'SELECT schedule_id, checkup_date FROM schedule_dates WHERE pregnancy_id = ? AND checkup_date > ? AND checkup_date <= ? ORDER BY checkup_date',
        [pregnancyId, today, weekLater]
      ).map(r => ({ ...r, ...(scheduleMap[r.schedule_id] || {}) }));
      for (const c of upcomingCheckups) {
        const diff = dayjs(c.checkup_date).diff(dayjs(), 'day');
        const label = diff === 0 ? '(今天)' : diff === 1 ? '(明天)' : `(${diff}天后)`;
        upcomingLines.push(`🩺 ${c.name || c.schedule_id} ${c.week_range || ''} - ${c.checkup_date} ${label}`);
      }

      const upcomingCustoms = db.queryAll(
        'SELECT name, checkup_date FROM custom_checkup WHERE pregnancy_id = ? AND checkup_date > ? AND checkup_date <= ? AND is_completed = 0 ORDER BY checkup_date',
        [pregnancyId, today, weekLater]
      );
      for (const c of upcomingCustoms) {
        const diff = dayjs(c.checkup_date).diff(dayjs(), 'day');
        upcomingLines.push(`🩺 ${c.name} - ${c.checkup_date} (${diff === 0 ? '今天' : diff + '天后'})`);
      }
    }

    if (includeReminder) {
      const upcomingReminders = db.queryAll(
        'SELECT title, trigger_date FROM reminder WHERE pregnancy_id = ? AND trigger_date > ? AND trigger_date <= ? AND is_completed = 0 ORDER BY trigger_date',
        [pregnancyId, today, weekLater]
      );
      for (const r of upcomingReminders) {
        const diff = dayjs(r.trigger_date).diff(dayjs(), 'day');
        upcomingLines.push(`📌 ${r.title} - ${r.trigger_date} (${diff === 0 ? '今天' : diff + '天后'})`);
      }
    }

    if (upcomingLines.length === 0) lines.push('✅ 近7天暂无其他安排');
    else lines.push(...upcomingLines);
    lines.push('');
  }

  lines.push('--- 孕程记自动推送 ---');
  return lines.join('\n');
}

// ========== 推送执行 ==========
/**
 * 向单个渠道推送一次每日看板
 * @param {string} channelKey 'wecom' | 'feishu'
 * @param {string} sourceType 'scheduled' | 'catchup' | 'manual' | 'retry'
 */
async function executeChannelPush(pregnancyId, channelKey, cfg, sourceType, existingLogId) {
  const channel = getChannel(channelKey);
  if (!channel) throw new Error(`未知推送渠道: ${channelKey}`);

  const logId = existingLogId || await recordPushLog('daily', `每日看板推送(${sourceType})`, 'pending', null, null, channelKey);

  try {
    const messageText = buildDailyBoardText(pregnancyId, cfg);
    const result = await sendChannelMessage(channelKey, cfg, messageText);
    await finishPushLog(logId, 'success', null, messageText);
    if (result.truncated) log.warn('推送', `[${channel.name}] 推送内容超过 ${channel.textLimitBytes} 字节，已自动截断`);
    return { success: true, attempts: result.attempts, truncated: result.truncated };
  } catch (e) {
    await finishPushLog(logId, 'failed', e.message);
    throw e;
  }
}

/** 本次推送应该覆盖哪些渠道（已配置 + 开关打开 + 至少勾了一类内容） */
function activeChannels() {
  const out = [];
  for (const channel of channelList()) {
    const cfg = readChannelConfig(channel.key);
    if (!cfg.webhook_url) continue;
    if (cfg.enabled === false) continue;
    if (!hasAnyContent(cfg)) continue;
    out.push({ channel, cfg });
  }
  return out;
}

/** 手动推送到所有启用的渠道（首页按钮用） */
async function pushToAllChannels(pregnancyId, sourceType = 'manual') {
  const targets = activeChannels();
  if (targets.length === 0) {
    const err = new Error('还没有可用的推送渠道，请先在设置页配置企业微信或飞书推送');
    err.noChannel = true;
    throw err;
  }
  const results = [];
  for (const t of targets) {
    try {
      await executeChannelPush(pregnancyId, t.channel.key, t.cfg, sourceType);
      results.push({ channel: t.channel.key, name: t.channel.name, success: true });
    } catch (e) {
      results.push({ channel: t.channel.key, name: t.channel.name, success: false, message: e.message });
    }
  }
  const failed = results.filter(r => !r.success);
  if (failed.length === results.length) {
    const err = new Error(failed.map(f => `${f.name}：${f.message}`).join('；'));
    err.allFailed = true;
    throw err;
  }
  return results;
}

// ========== 对外能力（被路由层调用）==========

function httpError(message, code = 1001) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** 渠道状态（给设置页显示用） */
function channelStatus(channelKey) {
  const channel = getChannel(channelKey);
  const cfg = readChannelConfig(channelKey);
  let status;
  if (!cfg.webhook_url) {
    status = { success: false, message: '未配置' };
  } else if (cfg.enabled === false) {
    status = { success: false, message: '已配置，但推送开关已关闭' };
  } else if (!hasAnyContent(cfg)) {
    status = { success: false, message: '已配置，但推送内容全部未勾选' };
  } else {
    let lastText = '';
    try {
      const last = db.queryOne(
        "SELECT pushed_at FROM push_log WHERE push_type='daily' AND status='success' AND (channel = ? OR (channel IS NULL AND ? = 'wecom')) ORDER BY pushed_at DESC LIMIT 1",
        [channelKey, channelKey]
      );
      if (last && last.pushed_at) lastText = ` · 最近成功：${String(last.pushed_at).slice(5, 16)}`;
    } catch { /* ignore */ }
    status = { success: true, message: `已配置，可正常推送（每日 ${cfg.push_time}）${lastText}` };
  }
  return { channel, cfg, status };
}

/** 渠道配置摘要（给 GET /xxx/config 返回，URL 脱敏） */
function channelConfigSummary(channelKey) {
  const channel = getChannel(channelKey);
  const cfg = readChannelConfig(channelKey);
  let maskedUrl = '';
  if (cfg.webhook_url) {
    const url = cfg.webhook_url;
    maskedUrl = url.length > 40 ? url.substring(0, 20) + '****' + url.substring(url.length - 10) : url.substring(0, 10) + '****';
  }
  const out = {
    channel: channelKey,
    name: channel.name,
    needs_secret: !!channel.needsSecret,
    url_placeholder: channel.urlPlaceholder,
    configured: !!cfg.webhook_url,
    webhook_url_masked: maskedUrl,
    enabled: cfg.enabled !== false,
    push_checkup: cfg.push_checkup !== false,
    push_daily: cfg.push_daily !== false,
    push_reminder: cfg.push_reminder !== false,
    push_time: cfg.push_time || '08:00',
  };
  if (channel.needsSecret) out.secret_set = !!String(cfg.secret || '').trim();
  return out;
}

/** 保存配置（先保存再测试；仅传偏好时不校验地址） */
async function saveChannelConfig(channelKey, body) {
  const channel = getChannel(channelKey);
  if (!channel) throw httpError(`未知推送渠道: ${channelKey}`);

  const { webhook_url, secret, enabled, push_checkup, push_daily, push_reminder, push_time } = body || {};
  const existing = readChannelConfig(channelKey);
  const hasPrefs = enabled !== undefined || push_checkup !== undefined || push_daily !== undefined
    || push_reminder !== undefined || push_time !== undefined || secret !== undefined;

  // 显式传空字符串 = 清除配置（前端「清除」按钮）。
  // 之前传空串会走「地址不能为空」的报错分支 → 界面看着清了、实际配置还在，刷新就复活。
  if (webhook_url !== undefined && !String(webhook_url).trim()) {
    const cleared = {
      ...existing,
      webhook_url: '',
      secret: '',
      configured: false,
    };
    writeChannelConfig(channelKey, cleared);
    return { cleared: true, test_failed: false, message: `已清除${channel.name}配置` };
  }

  // 模式1：仅更新偏好（没传地址）
  if (hasPrefs && webhook_url === undefined) {
    if (!existing.webhook_url) throw httpError('请先配置 Webhook 地址');
    const next = { ...existing };
    // 只覆盖「显式传了的」字段，未传的保持原值
    if (enabled !== undefined) next.enabled = enabled !== false;
    if (push_checkup !== undefined) next.push_checkup = push_checkup !== false;
    if (push_daily !== undefined) next.push_daily = push_daily !== false;
    if (push_reminder !== undefined) next.push_reminder = push_reminder !== false;
    if (push_time) next.push_time = push_time;
    if (!next.push_time) next.push_time = '08:00';
    if (channel.needsSecret && secret !== undefined) next.secret = String(secret || '').trim();
    writeChannelConfig(channelKey, next);
    return { test_failed: false, message: '推送偏好已更新' };
  }

  // 模式2：完整保存
  if (!webhook_url || !webhook_url.trim()) throw httpError('Webhook地址不能为空');
  const url = webhook_url.trim();
  const urlErr = channel.urlError(url);
  if (urlErr) throw httpError(urlErr);

  // ⚠️ 只覆盖「显式传了的」开关，未传的保留原值。
  // 之前写成 `push_reminder !== false`（未传 → undefined → 视为 true），
  // 结果用户取消勾选后再点一次「保存」地址，三个勾选框会被悄悄重置回全选。
  const next = {
    webhook_url: url,
    configured: true,
    enabled: enabled !== undefined ? enabled !== false : existing.enabled !== false,
    push_checkup: push_checkup !== undefined ? push_checkup !== false : existing.push_checkup !== false,
    push_daily: push_daily !== undefined ? push_daily !== false : existing.push_daily !== false,
    push_reminder: push_reminder !== undefined ? push_reminder !== false : existing.push_reminder !== false,
    push_time: push_time || existing.push_time || '08:00',
  };
  if (channel.needsSecret) {
    next.secret = String(secret !== undefined ? secret : (existing.secret || '')).trim();
  }
  // 先保存，再测试：网络抖一下不该让用户白填一次
  writeChannelConfig(channelKey, next);

  const testText = `🤰 孕程记 - ${channel.name}推送已连接成功！\n您将收到每日产检提醒和计划通知。`;
  const logId = await recordPushLog('test', '配置保存测试', 'pending', null, null, channelKey);
  try {
    await sendChannelMessage(channelKey, next, testText);
    await finishPushLog(logId, 'success', null, testText);
    return { test_failed: false, message: '配置已保存，测试消息已发送' };
  } catch (e) {
    await finishPushLog(logId, 'failed', e.message, testText);
    return { test_failed: true, message: `配置已保存，但测试发送失败：${e.message}（可稍后点「测试发送」重试）` };
  }
}

/** 发送测试消息 */
async function sendTestMessage(channelKey) {
  const channel = getChannel(channelKey);
  if (!channel) throw httpError(`未知推送渠道: ${channelKey}`);
  const cfg = readChannelConfig(channelKey);
  if (!cfg.webhook_url) throw httpError(`请先配置${channel.name} Webhook 地址`);

  const text = '🤰 孕程记 测试消息\n\n这是一条测试消息，如果您收到说明推送功能正常！';
  const logId = await recordPushLog('test', '测试消息', 'pending', null, null, channelKey);
  try {
    const r = await sendChannelMessage(channelKey, cfg, text);
    await finishPushLog(logId, 'success', null, text);
    return { attempts: r.attempts, message: r.attempts > 1 ? `测试消息已发送（第 ${r.attempts} 次尝试成功）` : '测试消息已发送' };
  } catch (e) {
    await finishPushLog(logId, 'failed', e.message, text);
    throw e;
  }
}

/** 手动推送单个渠道 */
async function manualPushChannel(channelKey, pregnancyId) {
  const channel = getChannel(channelKey);
  if (!channel) throw httpError(`未知推送渠道: ${channelKey}`);
  const cfg = readChannelConfig(channelKey);
  if (cfg.enabled === false) return { skipped: true, message: '推送已关闭' };
  if (!cfg.webhook_url) throw httpError(`请先配置${channel.name} Webhook 地址`);
  if (!hasAnyContent(cfg)) throw httpError('推送内容全部未勾选，请先在设置页勾选至少一项');
  if (!pregnancyId) throw httpError('缺少pregnancy_id');
  await executeChannelPush(pregnancyId, channelKey, cfg, 'manual');
  return { message: `${channel.name}每日看板已推送` };
}

/** 重试某条推送记录（渠道由记录自身决定） */
async function retryLog(logId) {
  const row = db.queryOne('SELECT * FROM push_log WHERE id = ?', [logId]);
  if (!row) throw httpError('推送记录不存在');
  if (row.status === 'success') throw httpError('该推送已成功，无需重试');

  const channelKey = row.channel || 'wecom';
  const channel = getChannel(channelKey);
  if (!channel) throw httpError('该记录来自已下线的推送渠道，无法重试');
  const cfg = readChannelConfig(channelKey);
  if (!cfg.webhook_url) throw httpError(`请先配置${channel.name} Webhook 地址`);

  await db.run("UPDATE push_log SET status='pending', error_message=NULL, pushed_at=NULL WHERE id=?", [logId]);

  try {
    if (row.push_type === 'daily') {
      const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
      if (!pregnancy) throw new Error('未找到孕期记录，无法重试');
      await executeChannelPush(pregnancy.id, channelKey, cfg, 'retry', logId);
    } else {
      // 非每日看板：原样重发当时的正文（老记录没有 payload 时按类型兜底）
      let text = row.payload;
      if (!text) {
        if (row.push_type === 'test') text = '🤰 孕程记 测试消息\n\n这是一条测试消息，如果您收到说明推送功能正常！';
        else if (row.push_type === 'checkup') text = `📋 产检提醒\n${row.push_content || ''}`;
        else text = row.push_content || '(重试)';
      }
      await sendChannelMessage(channelKey, cfg, text);
      await finishPushLog(logId, 'success', null, text);
    }
    return { channel: channelKey, message: '重试成功' };
  } catch (e) {
    try {
      await db.run("UPDATE push_log SET status='failed', error_message=? WHERE id=?", [e.message, logId]);
    } catch { /* ignore */ }
    throw e;
  }
}

/** 推送记录列表（支持按渠道过滤） */
/**
 * 查询推送记录（默认**限量**返回）。
 *
 * ⚠️ 为什么必须限量：应用是每天定时推送的，「全部」若不限量会把这辈子所有记录
 * 一次性查出来并返回 —— 前端再全部渲染成 DOM，设置页会越来越卡、越滚越长。
 * 默认最多返回最近 300 条（按时间倒序）。`limit <= 0` 表示不限量，仅供内部使用。
 */
function queryPushLogs(filter = 'all', channelKey = '', limit = 300) {
  let sql = 'SELECT * FROM push_log';
  const where = [];
  const params = [];

  if (filter === 'today') {
    where.push('created_at >= ?');
    params.push(localDateStr() + ' 00:00:00');
  } else if (filter === 'week7') {
    const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    where.push('created_at >= ?');
    params.push(localDateStr(from) + ' 00:00:00');
  }
  if (channelKey && getChannel(channelKey)) {
    // 老记录没有 channel 列 → 归为企业微信
    where.push("(channel = ? OR (channel IS NULL AND ? = 'wecom'))");
    params.push(channelKey, channelKey);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const n = Number(limit);
  if (Number.isFinite(n) && n > 0) {
    sql += ' LIMIT ?';
    params.push(n);
  }
  return db.queryAll(sql, params);
}

// ========== 定时调度（一个调度器管理所有渠道）==========
let schedulerStarted = false;
let lastPruneDate = '';   // 每天只清理一次推送记录

/** 推送记录保留天数：**只记录最近一个月**（更早的没人看，也没必要一直占地方） */
const PUSH_LOG_RETENTION_DAYS = 30;

/**
 * 清理超出保留期的推送记录（默认 30 天）。
 *
 * 应用是每天定时推送的，记录会无限增长；一个月前的推送结果没有查看价值，
 * 留着只会让表越来越大、列表越来越长（另外查询侧还有 300 条的显示上限兜底）。
 * 幂等、随时可重复调用；任何失败都不影响推送业务。
 */
function pruneOldPushLogs(retentionDays = PUSH_LOG_RETENTION_DAYS) {
  try {
    const days = Number(retentionDays) > 0 ? Number(retentionDays) : PUSH_LOG_RETENTION_DAYS;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoff = localStamp(cutoffDate);   // 与 created_at 同格式（本地时间）
    // db.run() 不返回影响行数，所以先数再删
    const row = db.queryOne('SELECT COUNT(*) AS n FROM push_log WHERE created_at < ?', [cutoff]);
    const n = (row && row.n) || 0;
    if (n > 0) {
      db.run('DELETE FROM push_log WHERE created_at < ?', [cutoff]);
      log.info('推送', `清理历史推送记录 ${n} 条（只保留最近 ${days} 天）`);
    }
    return n;
  } catch (e) {
    log.warn('推送', `清理历史推送记录失败: ${e.message}`);
    return 0;
  }
}

const CATCHUP_WINDOW_MIN = 180;      // 到达推送时间后 3 小时内仍会补推
const MAX_ATTEMPTS_PER_DAY = 6;      // 每个渠道每天最多尝试 6 次（含自动重试）
const RETRY_GAP_MS = 5 * 60 * 1000;  // 失败后间隔 5 分钟再试

// 每个渠道一份当天状态：{ wecom: {date, attempts, lastAttemptTs, done}, feishu: {...} }
const schedulerStates = {};

function stateFor(channelKey, today) {
  let s = schedulerStates[channelKey];
  if (!s || s.date !== today) {
    s = { date: today, attempts: 0, lastAttemptTs: 0, done: false };
    schedulerStates[channelKey] = s;
  }
  return s;
}

async function schedulerTick() {
  try {
    const now = new Date();
    const today = localDateStr(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // 每天清理一次超期推送记录（只记录最近一个月）；用日期守卫避免每分钟都删一遍
    if (lastPruneDate !== today) {
      lastPruneDate = today;
      pruneOldPushLogs();
    }

    for (const channel of channelList()) {
      try {
        const cfg = readChannelConfig(channel.key);
        if (!cfg.enabled || !cfg.webhook_url || !cfg.push_time) continue;
        if (!hasAnyContent(cfg)) continue;

        const st = stateFor(channel.key, today);
        if (st.done) continue;

        const pushMinutes = timeToMinutes(cfg.push_time);
        if (pushMinutes === null) continue;
        if (nowMinutes < pushMinutes) continue;                         // 还没到时间
        if (nowMinutes - pushMinutes > CATCHUP_WINDOW_MIN) continue;    // 已超出补推窗口
        if (st.attempts >= MAX_ATTEMPTS_PER_DAY) continue;             // 今天试够了
        if (st.attempts > 0 && Date.now() - st.lastAttemptTs < RETRY_GAP_MS) continue; // 重试冷却中

        const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
        if (!pregnancy) return;

        st.attempts++;
        st.lastAttemptTs = Date.now();

        const sourceType = st.attempts === 1
          ? (nowMinutes - pushMinutes > 1 ? 'catchup' : 'scheduled')
          : 'retry';

        try {
          await executeChannelPush(pregnancy.id, channel.key, cfg, sourceType);
          st.done = true;
          log.info('推送', `[${channel.name}] 每日看板推送成功（第 ${st.attempts} 次尝试）`);
        } catch (e) {
          // 关键：失败时【不】标记已完成 → 5 分钟后自动重试
          log.error('推送', `[${channel.name}] 每日看板推送失败（第 ${st.attempts} 次）：${e.message}`);
        }
      } catch (e) {
        log.error('推送', `[${channel.name}] 渠道调度异常: ${e.message}`);
      }
    }
  } catch (e) {
    log.error('推送', `调度器异常: ${e.message}`);
  }
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // 启动时检查各渠道今天是否已成功推送过（防止重启后重复推送）
  try {
    const today = localDateStr();
    for (const channel of channelList()) {
      const row = db.queryOne(
        "SELECT id FROM push_log WHERE push_type='daily' AND status='success' AND pushed_at LIKE ? AND (channel = ? OR (channel IS NULL AND ? = 'wecom')) LIMIT 1",
        [today + '%', channel.key, channel.key]
      );
      if (row) {
        const st = stateFor(channel.key, today);
        st.done = true;
      }
    }
  } catch (e) {
    log.warn('推送', `启动检查推送状态失败: ${e.message}`);
  }

  // 启动时清一次超期记录（应用可能几个月不重启，所以 tick 里还会每天再清一次）
  pruneOldPushLogs();

  setInterval(schedulerTick, 60000); // 每分钟检查一次
}

// 启动定时器
startScheduler();

module.exports = {
  CHANNELS,
  channelList,
  getChannel,
  DEFAULT_CONFIG,
  localDateStr,
  localStamp,
  timeToMinutes,
  hasAnyContent,
  readChannelConfig,
  writeChannelConfig,
  truncateForChannel,
  friendlyFeishuError,
  friendlyWecomError,
  sendChannelMessage,
  buildDailyBoardText,
  executeChannelPush,
  recordPushLog,
  finishPushLog,
  activeChannels,
  pushToAllChannels,
  startScheduler,
  schedulerTick,
  pruneOldPushLogs,
  PUSH_LOG_RETENTION_DAYS,
  // 对外能力（路由层用）
  channelStatus,
  channelConfigSummary,
  saveChannelConfig,
  sendTestMessage,
  manualPushChannel,
  retryLog,
  queryPushLogs,
};
