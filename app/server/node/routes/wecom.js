const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const dayjs = require('dayjs');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'wecom.json');

// 确保配置目录存在
function ensureConfigDir() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 读取配置
function readConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {
    webhook_url: '',
    configured: false,
    enabled: true,
    push_checkup: true,
    push_daily: true,
    push_reminder: true,
    push_time: '08:00',
  };
}

// 写入配置
function writeConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 发送企业微信群机器人消息（纯文本格式，兼容微信端）
 */
async function sendWebhookMessage(webhookUrl, textContent) {
  const https = require('https');
  const url = new URL(webhookUrl);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      msgtype: 'text',
      text: { content: textContent },
    });
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.errcode === 0) resolve(json);
          else reject(new Error(json.errmsg || '发送失败'));
        } catch { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('webhook请求超时(10s)')); });
    req.write(data);
    req.end();
  });
}

/**
 * 记录推送日志到 push_log 表
 */
function recordPushLog(pushType, content, status, errorMsg) {
  try {
    const id = uuidv4();
    db.run(
      'INSERT INTO push_log (id, push_type, push_content, status, error_message, pushed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, pushType, content || '', status, errorMsg || null, new Date().toISOString()]
    );
    return id;
  } catch (e) { return null; }
}

// ========== 定时推送引擎 ==========

let lastPushDate = null; // 格式 YYYY-MM-DD，记录今日是否已推送过每日看板
let schedulerStarted = false;

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // 启动时检查今天是否已成功推送过每日看板（防止重启后重复推送）
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayPush = db.queryOne(
      "SELECT id FROM push_log WHERE push_type='daily' AND status='success' AND pushed_at LIKE ? LIMIT 1",
      [today + '%']
    );
    if (todayPush) lastPushDate = today;
  } catch (e) { console.error('[推送调度器] 启动检查失败:', e.message); }

  setInterval(async () => {
    try {
      const config = readConfig();
      if (!config.enabled || !config.webhook_url || !config.push_time || config.push_daily === false) return;

      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 检查是否到了推送时间（精确到分钟）
      if (currentTime === config.push_time && lastPushDate !== today) {
        lastPushDate = today;

        // 获取当前活跃孕期
        const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
        if (!pregnancy) return;

        await executeDailyPush(pregnancy.id, config, 'scheduled');
      }

      // 补推：如果当前时间已超过设定时间且今天还没推过（比如服务重启后错过）
      if (currentTime > config.push_time && lastPushDate !== today) {
        // 只在超过设定时间1小时内补推
        const [pushH, pushM] = config.push_time.split(':').map(Number);
        const pushMinutes = pushH * 60 + pushM;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (nowMinutes - pushMinutes <= 60) {
          lastPushDate = today;
          const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
          if (pregnancy) {
            await executeDailyPush(pregnancy.id, config, 'catchup');
          }
        }
      }
    } catch (e) {
      console.error('[推送调度器] 错误:', e.message);
    }
  }, 60000); // 每分钟检查一次
}

/**
 * 执行每日看板推送（供手动调用和定时调度共用）
 * @param {string} pregnancyId
 * @param {object} config
 * @param {string} sourceType - 'scheduled' | 'catchup' | 'manual' | 'retry'
 * @param {string|null} existingLogId - 重试时复用已有日志ID，避免创建重复记录
 */
async function executeDailyPush(pregnancyId, config, sourceType, existingLogId) {
  const logId = existingLogId || recordPushLog('daily', `每日看板推送(${sourceType})`, 'pending', null);

  try {
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const weekLater = dayjs().add(7, 'day').format('YYYY-MM-DD');

    const pregnancy = db.queryOne(
      'SELECT lmp, edd, current_week FROM pregnancy WHERE id = ?',
      [pregnancyId]
    );
    if (!pregnancy) throw new Error('未找到孕期记录');

    let gestationalWeek = pregnancy.current_week || '?';
    let daysUntilDue = '?';
    if (pregnancy.lmp) {
      const lmpDay = dayjs(pregnancy.lmp);
      gestationalWeek = Math.floor(dayjs().diff(lmpDay, 'day') / 7);
      if (pregnancy.edd) daysUntilDue = dayjs(pregnancy.edd).diff(dayjs(), 'day');
    }

    let dueText = typeof daysUntilDue === 'number'
      ? (daysUntilDue > 0 ? `距预产期${daysUntilDue}天` : daysUntilDue === 0 ? '今天预产期！' : `已过预产期${Math.abs(daysUntilDue)}天`)
      : '';

    // 构建纯文本消息（不用markdown格式）
    let lines = [];
    lines.push(`【孕程记 · 每日看板】`);
    lines.push(`📅 ${today}  |  孕${gestationalWeek}周  |  ${dueText}`);
    lines.push('');

    // --- 明日待办 ---
    lines.push(`>>> 明日待办 (${tomorrow}) <<<`);

    const tomorrowCheckups = db.queryAll(
      `SELECT cs.id, cs.name, cs.week_range, sd.checkup_date
       FROM schedule_dates sd
       LEFT JOIN (SELECT id, name, week_range FROM prenatal_checkup WHERE pregnancy_id = ?) cs ON sd.schedule_id = cs.id
       WHERE sd.checkup_date = ?`,
      [pregnancyId, tomorrow]
    );
    for (const c of tomorrowCheckups) lines.push(`⚠️ 【产检】${c.name || c.id} ${c.week_range || ''}`);

    const tomorrowCustoms = db.queryAll(
      "SELECT name FROM custom_checkup WHERE pregnancy_id = ? AND checkup_date = ? AND is_completed = 0",
      [pregnancyId, tomorrow]
    );
    for (const c of tomorrowCustoms) lines.push(`⚠️ 【自定义产检】${c.name}`);

    const tomorrowReminders = db.queryAll(
      "SELECT title FROM reminder WHERE pregnancy_id = ? AND trigger_date LIKE ? AND is_completed = 0",
      [pregnancyId, tomorrow + '%']
    );
    for (const r of tomorrowReminders) lines.push(`⚠️ 【提醒】${r.title}`);

    if (tomorrowCheckups.length === 0 && tomorrowCustoms.length === 0 && tomorrowReminders.length === 0) {
      lines.push('✅ 明日暂无安排，好好休息~');
    }
    lines.push('');

    // --- 近7天 ---
    lines.push(`>>> 近7天安排 <<<`);

    const upcomingCheckups = db.queryAll(
      `SELECT cs.name, cs.week_range, sd.checkup_date
       FROM schedule_dates sd
       LEFT JOIN (SELECT id, name, week_range FROM prenatal_checkup WHERE pregnancy_id = ?) cs ON sd.schedule_id = cs.id
       WHERE sd.checkup_date > ? AND sd.checkup_date <= ? ORDER BY sd.checkup_date`,
      [pregnancyId, today, weekLater]
    );
    for (const c of upcomingCheckups) {
      const diff = dayjs(c.checkup_date).diff(dayjs(), 'day');
      const label = diff === 0 ? '(今天)' : diff === 1 ? '(明天)' : `(${diff}天后)`;
      lines.push(`🩺 ${c.name || c.id} ${c.week_range || ''} - ${c.checkup_date} ${label}`);
    }

    const upcomingCustoms = db.queryAll(
      "SELECT name, checkup_date FROM custom_checkup WHERE pregnancy_id = ? AND checkup_date > ? AND checkup_date <= ? AND is_completed = 0 ORDER BY checkup_date",
      [pregnancyId, today, weekLater]
    );
    for (const c of upcomingCustoms) {
      const diff = dayjs(c.checkup_date).diff(dayjs(), 'day');
      lines.push(`🩺 ${c.name} - ${c.checkup_date} (${diff === 0 ? '今天' : diff + '天后'})`);
    }

    const upcomingReminders = db.queryAll(
      "SELECT title, trigger_date FROM reminder WHERE pregnancy_id = ? AND trigger_date > ? AND trigger_date <= ? AND is_completed = 0 ORDER BY trigger_date",
      [pregnancyId, today, weekLater]
    );
    for (const r of upcomingReminders) {
      const diff = dayjs(r.trigger_date).diff(dayjs(), 'day');
      lines.push(`📌 ${r.title} - ${r.trigger_date} (${diff === 0 ? '今天' : diff + '天后'})`);
    }

    if (upcomingCheckups.length === 0 && upcomingCustoms.length === 0 && upcomingReminders.length === 0) {
      lines.push('✅ 近7天暂无其他安排');
    }

    lines.push('');
    lines.push('--- 孕程记自动推送 ---');

    const messageText = lines.join('\n');
    await sendWebhookMessage(config.webhook_url, messageText);

    // 更新日志为成功
    if (logId) db.run("UPDATE push_log SET status='success', pushed_at=? WHERE id=?", [new Date().toISOString(), logId]);
    return { success: true };
  } catch (e) {
    if (logId) db.run("UPDATE push_log SET status='failed', error_message=? WHERE id=?", [e.message, logId]);
    throw e;
  }
}

// 启动定时器
startScheduler();

// ========== 路由 ==========

/** 获取配置状态 */
router.get('/wecom/status', async (req, res) => {
  try {
    const config = readConfig();
    let status = null;
    if (config.configured && config.webhook_url) {
      status = { success: true, message: '已配置，可正常推送' };
    } else {
      status = { success: false, message: '未配置' };
    }
    res.json({ code: 0, data: { configured: config.configured, status } });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 获取当前配置（URL脱敏） */
router.get('/wecom/config', async (req, res) => {
  try {
    const config = readConfig();
    let maskedUrl = '';
    if (config.webhook_url) {
      const url = config.webhook_url;
      maskedUrl = url.length > 40 ? url.substring(0, 20) + '****' + url.substring(url.length - 10) : url.substring(0, 10) + '****';
    }
    res.json({
      code: 0,
      data: {
        configured: !!config.webhook_url,
        webhook_url_masked: maskedUrl,
        enabled: config.enabled !== false,
        push_checkup: config.push_checkup !== false,
        push_daily: config.push_daily !== false,
        push_reminder: config.push_reminder !== false,
        push_time: config.push_time || '08:00',
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
    if (!webhook_url.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
      return res.json({ code: 1001, data: null, message: 'Webhook地址格式不正确' });
    }

    // 测试发送
    try {
      await sendWebhookMessage(webhook_url, '🤰 孕程记 - 企业微信推送已连接成功！\n您将收到每日产检提醒和计划通知。');
    } catch (sendErr) {
      return res.json({ code: 1002, data: null, message: `测试发送失败: ${sendErr.message}` });
    }

    writeConfig({
      webhook_url: webhook_url.trim(),
      configured: true,
      enabled: enabled !== false,
      push_checkup: push_checkup !== false,
      push_daily: push_daily !== false,
      push_reminder: push_reminder !== false,
      push_time: push_time || '08:00',
    });
    res.json({ code: 0, data: { configured: true }, message: '配置保存成功，测试消息已发送' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 发送测试消息 */
router.post('/wecom/send-test', async (req, res) => {
  try {
    const config = readConfig();
    if (!config.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }
    const logId = recordPushLog('test', '测试消息', 'pending', null);
    try {
      await sendWebhookMessage(config.webhook_url, '🤰 孕程记 测试消息\n\n这是一条测试消息，如果您收到说明推送功能正常！');
      if (logId) db.run("UPDATE push_log SET status='success', pushed_at=? WHERE id=?", [new Date().toISOString(), logId]);
      res.json({ code: 0, data: null, message: '测试消息已发送' });
    } catch (sendErr) {
      if (logId) db.run("UPDATE push_log SET status='failed', error_message=? WHERE id=?", [sendErr.message, logId]);
      res.json({ code: 1002, data: null, message: sendErr.message });
    }
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/** 手动发送产检提醒 */
router.post('/wecom/send-checkup-reminder', async (req, res) => {
  try {
    const config = readConfig();
    if (!config.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }
    const { checkup_name, gestational_week, checkup_date, items } = req.query;

    let content = `📋 产检提醒\n`;
    content += `${checkup_name || '产检'}\n`;
    if (gestational_week) content += `孕${gestational_week}周\n`;
    if (checkup_date) content += `计划日期: ${checkup_date}\n`;
    if (items) content += `检查项目: ${items}\n`;

    const logId = recordPushLog('checkup', `产检提醒: ${checkup_name}`, 'pending', null);
    try {
      await sendWebhookMessage(config.webhook_url, content);
      if (logId) db.run("UPDATE push_log SET status='success', pushed_at=? WHERE id=?", [new Date().toISOString(), logId]);
      res.json({ code: 0, data: null, message: '提醒已发送' });
    } catch (sendErr) {
      if (logId) db.run("UPDATE push_log SET status='failed', error_message=? WHERE id=?", [sendErr.message, logId]);
      res.json({ code: 1002, data: null, message: sendErr.message });
    }
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/** 手动触发每日看板推送（首页"推送微信"按钮调用） */
router.post('/wecom/daily-push', async (req, res) => {
  try {
    const config = readConfig();
    if (config.enabled === false) {
      return res.json({ code: 0, data: null, message: '推送已关闭' });
    }
    if (!config.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }

    const pregnancyId = req.body.pregnancy_id;
    if (!pregnancyId) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    }

    await executeDailyPush(pregnancyId, config, 'manual');
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
      sql = 'SELECT * FROM push_log WHERE created_at >= ? ORDER BY created_at DESC';
      params.push(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    } else if (filter === 'week7') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      sql = 'SELECT * FROM push_log WHERE created_at >= ? ORDER BY created_at DESC';
      params.push(weekAgo);
    }

    const rows = db.queryAll(sql, params);
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 重试失败的推送 */
router.post('/wecom/retry/:id', async (req, res) => {
  try {
    const logEntry = db.queryOne('SELECT * FROM push_log WHERE id = ?', [req.params.id]);
    if (!logEntry) {
      return res.json({ code: 1001, data: null, message: '推送记录不存在' });
    }
    if (logEntry.status === 'success') {
      return res.json({ code: 1001, data: null, message: '该推送已成功，无需重试' });
    }

    const config = readConfig();
    if (!config.webhook_url) {
      return res.json({ code: 1001, data: null, message: '请先配置Webhook地址' });
    }

    // 更新为 pending 重试
    db.run("UPDATE push_log SET status='pending', error_message=NULL, pushed_at=NULL WHERE id=?", [req.params.id]);

    // 根据类型重新执行
    if (logEntry.push_type === 'daily') {
      const pregnancy = db.queryOne('SELECT id FROM pregnancy ORDER BY created_at DESC LIMIT 1');
      if (pregnancy) {
        await executeDailyPush(pregnancy.id, config, 'retry', req.params.id);
      }
    } else {
      // 非daily类型的简单重试
      await sendWebhookMessage(config.webhook_url, logEntry.push_content || '(重试)');
      db.run("UPDATE push_log SET status='success', pushed_at=? WHERE id=?", [new Date().toISOString(), req.params.id]);
    }

    res.json({ code: 0, data: null, message: '重试成功' });
  } catch (e) {
    db.run("UPDATE push_log SET status='failed', error_message=? WHERE id=?", [e.message, req.params.id]);
    res.json({ code: 1002, data: null, message: e.message });
  }
});

module.exports = router;
