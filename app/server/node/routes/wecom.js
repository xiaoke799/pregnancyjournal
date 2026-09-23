const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const dayjs = require('dayjs');
const config = require('../config');
const log = require('../logger');

// 配置文件路径：放到持久化数据目录（此前写在应用安装目录，升级会丢失配置）
const CONFIG_FILE = path.join(config.DATA_DIR, 'wecom.json');

// ========== 时间工具 ==========
// 统一使用「本地时间」字符串（YYYY-MM-DD HH:mm:ss）。
// 此前混用 toISOString()（UTC）导致：东八区 08:00 前日期算成前一天、
// 推送记录时间显示比实际早 8 小时。家用 NAS 场景按 NAS 本地时间更直观。
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

// ========== 配置读写 ==========
const DEFAULT_CONFIG = {
  webhook_url: '',
  configured: false,
  enabled: true,
  push_checkup: true,
  push_daily: true,
  push_reminder: true,
  push_time: '08:00',
};

function ensureConfigDir() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 读取配置（与默认值合并，老配置文件缺字段也不会出现 undefined 行为）
function readConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (raw && typeof raw === 'object') return { ...DEFAULT_CONFIG, ...raw };
    }
  } catch (e) {
    log.warn('企业微信', `读取配置失败，使用默认配置: ${e.message}`);
  }
  return { ...DEFAULT_CONFIG };
}

// 写入配置
function writeConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

// 是否至少勾选了一类推送内容（三项全关 = 不再推送）
function hasAnyContent(cfg) {
  return cfg.push_daily !== false || cfg.push_checkup !== false || cfg.push_reminder !== false;
}

// ========== 企业微信 Webhook 发送 ==========

// 企业微信 text 消息内容上限 2048 字节（UTF-8）。超限会直接被接口拒绝，
// 此前没做任何保护 → 待办很多的用户会「推送失败」。
const WECOM_TEXT_MAX_BYTES = 2000;

// 可重试的错误码：系统繁忙 / 频率超限 / 凭证临时失效
const RETRYABLE_WECOM_CODES = new Set([-1, 45009, 45033, 40014, 42001]);
// 重试间隔（第一次失败后等 1s，再 3s，再 8s）→ 共 4 次尝试
const RETRY_DELAYS_MS = [1000, 3000, 8000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把企业微信返回的错误码翻译成人能看懂的中文 */
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

/** 网络层错误翻译成中文（NAS 完全没网 / DNS 有问题时最容易出现） */
function friendlyNetworkError(err) {
  const c = err && err.code;
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return '无法解析企业微信域名（qyapi.weixin.qq.com），请检查 NAS 的网络和 DNS 设置';
  if (c === 'ECONNREFUSED') return '连接被拒绝，请检查 NAS 的网络或防火墙设置';
  if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEDOUT') return '连接企业微信超时，请检查 NAS 的外网连接';
  if (c === 'ECONNRESET' || c === 'EPIPE') return '连接被重置（网络不稳定），稍后会自动重试';
  if (c && String(c).includes('CERT')) return 'HTTPS 证书校验失败，请检查 NAS 的系统时间与证书设置';
  return `网络请求失败：${(err && err.message) || String(err)}`;
}

/**
 * 按字节数安全截断消息（企业微信 text 上限 2048 字节，超了会整条拒收）。
 * 优先按整行保留，最后补一句截断说明。
 */
function truncateForWecom(text, maxBytes = WECOM_TEXT_MAX_BYTES) {
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
function sendWebhookOnce(webhookUrl, textContent) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(webhookUrl);
    } catch {
      const e = new Error('Webhook 地址格式不正确，请重新复制');
      e.permanent = true;
      return reject(e);
    }

    const transport = url.protocol === 'https:' ? https : http;
    const data = JSON.stringify({ msgtype: 'text', text: { content: textContent } });

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
          // 1) HTTP 状态码必须是 2xx。此前完全不看状态码，把错误页当成成功。
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const e = new Error(`企业微信接口返回 HTTP ${res.statusCode}${body ? `：${body.slice(0, 120)}` : ''}`);
            // 404 / 400 一般代表地址错误，重试无意义
            if (res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 404) e.permanent = true;
            return fail(e);
          }
          // 2) 必须能解析出 JSON。此前解析失败会 resolve → 记录成「成功」但用户根本没收到。
          let json = null;
          try { json = JSON.parse(body); } catch { /* 交给下面处理 */ }
          if (!json || typeof json !== 'object') {
            const e = new Error(`企业微信返回了无法识别的内容，可能网络被拦截或地址不正确${body ? `：${body.slice(0, 80)}` : ''}`);
            e.permanent = true;
            return fail(e);
          }
          // 3) errcode 必须为 0
          if (Number(json.errcode) === 0) return ok({ errcode: 0, errmsg: json.errmsg || 'ok' });
          const code = Number(json.errcode);
          const e = new Error(friendlyWecomError(code, json.errmsg));
          e.errcode = code;
          if (!RETRYABLE_WECOM_CODES.has(code)) e.permanent = true;
          return fail(e);
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
    // 超时：15 秒（原 10 秒，弱网 NAS 上 TLS 握手偶发超时）
    req.setTimeout(15000, () => {
      fail(new Error('连接企业微信超时（15 秒），请检查 NAS 的外网连接'));
      try { req.destroy(); } catch { /* ignore */ }
    });
    req.write(data);
    req.end();
  });
}

/**
 * 发送企业微信群机器人消息（纯文本格式，兼容微信端）
 * 带自动重试：网络抖动 / 超时 / 频率超限最多重试 3 次（1s、3s、8s）
 * @param {string} webhookUrl
 * @param {string} textContent
 * @param {{retries?: number}} [opts] retries = 额外重试次数，默认 3
 * @returns {Promise<{attempts:number, truncated:boolean}>}
 */
async function sendWebhookMessage(webhookUrl, textContent, opts = {}) {
  const text = truncateForWecom(textContent);
  const truncated = text !== textContent;
  const maxAttempts = (opts.retries === undefined ? RETRY_DELAYS_MS.length : opts.retries) + 1;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendWebhookOnce(webhookUrl, text);
      if (attempt > 1) log.info('企业微信', `第 ${attempt} 次尝试推送成功`);
      return { attempts: attempt, truncated };
    } catch (e) {
      lastErr = e;
      if (e.permanent || attempt >= maxAttempts) break;
      const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      log.warn('企业微信', `第 ${attempt} 次推送失败（${e.message}），${wait}ms 后重试`);
      await sleep(wait);
    }
  }
  throw lastErr || new Error('推送失败');
}

// ========== 推送日志 ==========

/**
 * 记录推送日志到 push_log 表
 * @param {string} pushType
 * @param {string} content 展示用标题（列表里显示）
 * @param {string} status
 * @param {string|null} errorMsg
 * @param {string|null} payload 完整消息正文（重试时原样重发，避免重试发出的是标题）
 */
async function recordPushLog(pushType, content, status, errorMsg, payload) {
  const now = localStamp();
  try {
    const id = uuidv4();
    await db.run(
      "INSERT INTO push_log (id, push_type, push_content, status, error_message, pushed_at, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, pushType, content || '', status, errorMsg || null, null, now, payload || null]
    );
    return id;
  } catch (e) {
    // 老库未迁移出 payload 列时退化为不带 payload 的插入（不能因此丢日志）
    try {
      const id = uuidv4();
      await db.run(
        "INSERT INTO push_log (id, push_type, push_content, status, error_message, pushed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, pushType, content || '', status, errorMsg || null, null, now]
      );
      return id;
    } catch (e2) {
      log.warn('企业微信', `写推送日志失败: ${e2.message}`);
      return null;
    }
  }
}

/** 更新推送日志状态（成功时才写 pushed_at） */
async function finishPushLog(logId, status, errorMsg, payload) {
  if (!logId) return;
  try {
    if (status === 'success') {
      await db.run("UPDATE push_log SET status='success', error_message=NULL, pushed_at=?, payload=COALESCE(?, payload) WHERE id=?", [localStamp(), payload || null, logId]);
    } else {
      await db.run("UPDATE push_log SET status=?, error_message=? WHERE id=?", [status, errorMsg || null, logId]);
    }
  } catch (e) {
    try {
      await db.run("UPDATE push_log SET status=?, error_message=? WHERE id=?", [status, errorMsg || null, logId]);
    } catch (e2) { /* ignore */ }
  }
}

// ========== 静态产检时间表 ==========
// schedule_dates.schedule_id 指向内置 checkup_schedule.json 的 id（该表不在数据库里）。
// 此前错误地 JOIN 了 prenatal_checkup 的 name/week_range 列 → 推送报「no such column」。
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
  } catch (e) {
    return _scheduleMapCache || {};
  }
}

// ========== 每日看板内容构建 ==========

/**
 * 构建每日看板文本
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

/**
 * 执行每日看板推送（供手动调用和定时调度共用）
 * @param {string} pregnancyId
 * @param {object} cfg
 * @param {string} sourceType - 'scheduled' | 'catchup' | 'manual' | 'retry'
 * @param {string|null} existingLogId - 重试时复用已有日志ID，避免创建重复记录
 */
async function executeDailyPush(pregnancyId, cfg, sourceType, existingLogId) {
  const logId = existingLogId || await recordPushLog('daily', `每日看板推送(${sourceType})`, 'pending', null);

  try {
    const messageText = buildDailyBoardText(pregnancyId, cfg);
    const result = await sendWebhookMessage(cfg.webhook_url, messageText);
    await finishPushLog(logId, 'success', null, messageText);
    if (result.truncated) log.warn('企业微信', '推送内容超过 2048 字节，已自动截断');
    return { success: true, attempts: result.attempts, truncated: result.truncated };
  } catch (e) {
    await finishPushLog(logId, 'failed', e.message);
    throw e;
  }
}

// ========== 定时推送引擎 ==========
// 说明：server.js 里曾有一个硬编码 21:00 的重复调度器（且查询了不存在的
// pregnancy.status 列，永远抛错），已移除 —— 推送时间统一由设置页的
// 「每日推送时间」(push_time) 决定，只有一个调度器，避免重复推送。
let schedulerStarted = false;

const CATCHUP_WINDOW_MIN = 180;      // 到达推送时间后 3 小时内仍会补推
const MAX_ATTEMPTS_PER_DAY = 6;      // 每天最多尝试 6 次（含自动重试）
const RETRY_GAP_MS = 5 * 60 * 1000;  // 失败后间隔 5 分钟再试

const scheduler = {
  date: null,       // 当前统计的本地日期
  attempts: 0,      // 当天已尝试次数
  lastAttemptTs: 0, // 上次尝试时间戳
  done: false,      // 当天是否已推送成功
};

async function schedulerTick() {
  try {
    const cfg = readConfig();
    if (!cfg.enabled || !cfg.webhook_url || !cfg.push_time) return;
    if (!hasAnyContent(cfg)) return;

    const now = new Date();
    const today = localDateStr(now);

    // 跨天重置
    if (scheduler.date !== today) {
      scheduler.date = today;
      scheduler.attempts = 0;
      scheduler.lastAttemptTs = 0;
      scheduler.done = false;
    }
    if (scheduler.done) return;

    const pushMinutes = timeToMinutes(cfg.push_time);
    if (pushMinutes === null) return;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < pushMinutes) return;                              // 还没到时间
    if (nowMinutes - pushMinutes > CATCHUP_WINDOW_MIN) return;         // 已超出补推窗口
    if (scheduler.attempts >= MAX_ATTEMPTS_PER_DAY) return;            // 今天试够了，明天再说
    if (scheduler.attempts > 0 && Date.now() - scheduler.lastAttemptTs < RETRY_GAP_MS) return; // 重试冷却中

    const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
    if (!pregnancy) return;

    scheduler.attempts++;
    scheduler.lastAttemptTs = Date.now();

    const sourceType = scheduler.attempts === 1
      ? (nowMinutes - pushMinutes > 1 ? 'catchup' : 'scheduled')
      : 'retry';

    try {
      await executeDailyPush(pregnancy.id, cfg, sourceType);
      scheduler.done = true;
      log.info('企业微信', `每日看板推送成功（第 ${scheduler.attempts} 次尝试）`);
    } catch (e) {
      // 关键：失败时【不】标记为已完成 → 5 分钟后自动重试，
      // 解决「某天推送没成功就再也没有了」的问题。
      log.error('企业微信', `每日看板推送失败（第 ${scheduler.attempts} 次）：${e.message}`);
    }
  } catch (e) {
    log.error('企业微信', `调度器异常: ${e.message}`);
  }
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // 启动时检查今天是否已成功推送过每日看板（防止重启后重复推送）
  try {
    const today = localDateStr();
    const todayPush = db.queryOne(
      "SELECT id FROM push_log WHERE push_type='daily' AND status='success' AND pushed_at LIKE ? LIMIT 1",
      [today + '%']
    );
    if (todayPush) {
      scheduler.date = today;
      scheduler.done = true;
    }
  } catch (e) {
    log.warn('企业微信', `启动检查推送状态失败: ${e.message}`);
  }

  setInterval(schedulerTick, 60000); // 每分钟检查一次
}

// 启动定时器
startScheduler();

// ========== 路由 ==========

/** 获取配置状态 */
router.get('/wecom/status', async (req, res) => {
  try {
    const cfg = readConfig();
    let status;
    if (!cfg.webhook_url) {
      status = { success: false, message: '未配置' };
    } else if (cfg.enabled === false) {
      status = { success: false, message: '已配置，但推送开关已关闭' };
    } else if (!hasAnyContent(cfg)) {
      status = { success: false, message: '已配置，但推送内容全部未勾选' };
    } else {
      // 带上最近一次成功推送时间，方便用户判断「到底有没有在推」
      let lastText = '';
      try {
        const last = db.queryOne("SELECT pushed_at FROM push_log WHERE push_type='daily' AND status='success' ORDER BY pushed_at DESC LIMIT 1");
        if (last && last.pushed_at) lastText = ` · 最近成功：${String(last.pushed_at).slice(5, 16)}`;
      } catch { /* ignore */ }
      status = { success: true, message: `已配置，可正常推送（每日 ${cfg.push_time}）${lastText}` };
    }
    res.json({ code: 0, data: { configured: !!cfg.webhook_url, enabled: cfg.enabled !== false, status } });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 获取当前配置（URL脱敏） */
router.get('/wecom/config', async (req, res) => {
  try {
    const cfg = readConfig();
    let maskedUrl = '';
    if (cfg.webhook_url) {
      const url = cfg.webhook_url;
      maskedUrl = url.length > 40 ? url.substring(0, 20) + '****' + url.substring(url.length - 10) : url.substring(0, 10) + '****';
    }
    res.json({
      code: 0,
      data: {
        configured: !!cfg.webhook_url,
        webhook_url_masked: maskedUrl,
        enabled: cfg.enabled !== false,
        push_checkup: cfg.push_checkup !== false,
        push_daily: cfg.push_daily !== false,
        push_reminder: cfg.push_reminder !== false,
        push_time: cfg.push_time || '08:00',
      },
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 保存配置或仅更新偏好 */
router.post('/wecom/config', async (req, res) => {
  try {
    const { webhook_url, enabled, push_checkup, push_daily, push_reminder, push_time } = req.body || {};
    const hasPrefs = enabled !== undefined || push_checkup !== undefined || push_daily !== undefined || push_reminder !== undefined || push_time !== undefined;

    // 模式1：仅更新偏好
    if (hasPrefs && (!webhook_url || !webhook_url.trim())) {
      const existing = readConfig();
      if (!existing.webhook_url) {
        return res.json({ code: 1001, data: null, message: '请先配置 Webhook 地址' });
      }
      writeConfig({
        ...existing,
        enabled: enabled !== false,
        push_checkup: push_checkup !== false,
        push_daily: push_daily !== false,
        push_reminder: push_reminder !== false,
        push_time: push_time || existing.push_time || '08:00',
      });
      return res.json({ code: 0, data: { configured: true }, message: '推送偏好已更新' });
    }

    // 模式2：完整保存
    if (!webhook_url || !webhook_url.trim()) {
      return res.json({ code: 1001, data: null, message: 'Webhook地址不能为空' });
    }
    const url = webhook_url.trim();
    if (!url.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
      return res.json({ code: 1001, data: null, message: 'Webhook地址格式不正确' });
    }

    // 先保存配置，再测试发送。
    // 此前是「先测试、失败就不保存」→ 网络抖一下用户就白填一次，体验很差。
    writeConfig({
      webhook_url: url,
      configured: true,
      enabled: enabled !== false,
      push_checkup: push_checkup !== false,
      push_daily: push_daily !== false,
      push_reminder: push_reminder !== false,
      push_time: push_time || '08:00',
    });

    const testText = '🤰 孕程记 - 企业微信推送已连接成功！\n您将收到每日产检提醒和计划通知。';
    const logId = await recordPushLog('test', '配置保存测试', 'pending', null);
    try {
      await sendWebhookMessage(url, testText);
      await finishPushLog(logId, 'success', null, testText);
      res.json({ code: 0, data: { configured: true, test_failed: false }, message: '配置已保存，测试消息已发送' });
    } catch (sendErr) {
      await finishPushLog(logId, 'failed', sendErr.message, testText);
      res.json({
        code: 0,
        data: { configured: true, test_failed: true },
        message: `配置已保存，但测试发送失败：${sendErr.message}（可稍后点「测试发送」重试）`,
      });
    }
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 发送测试消息 */
router.post('/wecom/send-test', async (req, res) => {
  try {
    const cfg = readConfig();
    if (!cfg.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }
    const text = '🤰 孕程记 测试消息\n\n这是一条测试消息，如果您收到说明推送功能正常！';
    const logId = await recordPushLog('test', '测试消息', 'pending', null);
    try {
      const r = await sendWebhookMessage(cfg.webhook_url, text);
      await finishPushLog(logId, 'success', null, text);
      res.json({ code: 0, data: null, message: r.attempts > 1 ? `测试消息已发送（第 ${r.attempts} 次尝试成功）` : '测试消息已发送' });
    } catch (sendErr) {
      await finishPushLog(logId, 'failed', sendErr.message, text);
      res.json({ code: 1002, data: null, message: sendErr.message });
    }
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/** 手动发送产检提醒 */
router.post('/wecom/send-checkup-reminder', async (req, res) => {
  try {
    const cfg = readConfig();
    if (!cfg.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }
    const { checkup_name, gestational_week, checkup_date, items } = req.query;

    let content = `📋 产检提醒\n`;
    content += `${checkup_name || '产检'}\n`;
    if (gestational_week) content += `孕${gestational_week}周\n`;
    if (checkup_date) content += `计划日期: ${checkup_date}\n`;
    if (items) content += `检查项目: ${items}\n`;

    const logId = await recordPushLog('checkup', `产检提醒: ${checkup_name}`, 'pending', null);
    try {
      await sendWebhookMessage(cfg.webhook_url, content);
      await finishPushLog(logId, 'success', null, content);
      res.json({ code: 0, data: null, message: '提醒已发送' });
    } catch (sendErr) {
      await finishPushLog(logId, 'failed', sendErr.message, content);
      res.json({ code: 1002, data: null, message: sendErr.message });
    }
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/** 手动触发每日看板推送（首页"推送微信"按钮调用） */
router.post('/wecom/daily-push', async (req, res) => {
  try {
    const cfg = readConfig();
    if (cfg.enabled === false) {
      return res.json({ code: 0, data: null, message: '推送已关闭' });
    }
    if (!cfg.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }
    if (!hasAnyContent(cfg)) {
      return res.json({ code: 1001, data: null, message: '推送内容全部未勾选，请先在设置页勾选至少一项' });
    }

    const pregnancyId = req.body && req.body.pregnancy_id;
    if (!pregnancyId) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    }

    await executeDailyPush(pregnancyId, cfg, 'manual');
    res.json({ code: 0, data: null, message: '每日看板已推送' });
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/** 查询推送记录列表 */
router.get('/wecom/push-logs', async (req, res) => {
  try {
    const filter = req.query.filter || 'all'; // today | week7 | all
    let sql = 'SELECT * FROM push_log ORDER BY created_at DESC';
    const params = [];

    if (filter === 'today') {
      // 按本地时间当天 00:00 起算（此前用 UTC 零点，东八区会错 8 小时）
      sql = 'SELECT * FROM push_log WHERE created_at >= ? ORDER BY created_at DESC';
      params.push(localDateStr() + ' 00:00:00');
    } else if (filter === 'week7') {
      const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      sql = 'SELECT * FROM push_log WHERE created_at >= ? ORDER BY created_at DESC';
      params.push(localDateStr(from) + ' 00:00:00');
    }

    const rows = db.queryAll(sql, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 重试失败的推送 */
router.post('/wecom/retry/:id', async (req, res) => {
  let logEntry = null;
  try {
    logEntry = db.queryOne('SELECT * FROM push_log WHERE id = ?', [req.params.id]);
    if (!logEntry) {
      return res.json({ code: 1001, data: null, message: '推送记录不存在' });
    }
    if (logEntry.status === 'success') {
      return res.json({ code: 1001, data: null, message: '该推送已成功，无需重试' });
    }

    const cfg = readConfig();
    if (!cfg.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }

    // 更新为 pending 重试
    await db.run("UPDATE push_log SET status='pending', error_message=NULL, pushed_at=NULL WHERE id=?", [req.params.id]);

    if (logEntry.push_type === 'daily') {
      // 每日看板：按当前数据重新生成
      const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
      if (!pregnancy) {
        throw new Error('未找到孕期记录，无法重试');
      }
      await executeDailyPush(pregnancy.id, cfg, 'retry', req.params.id);
    } else {
      // 其他类型：优先原样重发当时的正文（老记录没有 payload 时按类型兜底）
      let text = logEntry.payload;
      if (!text) {
        if (logEntry.push_type === 'test') {
          text = '🤰 孕程记 测试消息\n\n这是一条测试消息，如果您收到说明推送功能正常！';
        } else if (logEntry.push_type === 'checkup') {
          text = `📋 产检提醒\n${logEntry.push_content || ''}`;
        } else {
          text = logEntry.push_content || '(重试)';
        }
      }
      await sendWebhookMessage(cfg.webhook_url, text);
      await finishPushLog(req.params.id, 'success', null, text);
    }

    res.json({ code: 0, data: null, message: '重试成功' });
  } catch (e) {
    try {
      await db.run("UPDATE push_log SET status='failed', error_message=? WHERE id=?", [e.message, req.params.id]);
    } catch (e2) { /* ignore */ }
    res.json({ code: 1002, data: null, message: e.message });
  }
});

module.exports = router;
