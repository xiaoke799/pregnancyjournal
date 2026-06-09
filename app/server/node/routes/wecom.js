const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');

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
    enabled: true,           // 总开关
    push_checkup: true,      // 产检提醒
    push_daily: true,        // 每日看板
    push_reminder: true,     // 提醒事项
  };
}

// 写入配置
function writeConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 发送企业微信群机器人消息
 * @param {string} webhookUrl - Webhook地址
 * @param {object} msg - 消息对象 { msgtype: 'text'|'markdown', text/markdown: {...} }
 */
async function sendWebhookMessage(webhookUrl, msg) {
  const https = require('https');
  const url = new URL(webhookUrl);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(msg);
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
    req.write(data);
    req.end();
  });
}

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
    // URL脱敏：只显示前20和后10字符
    let maskedUrl = '';
    if (config.webhook_url) {
      const url = config.webhook_url;
      if (url.length > 40) {
        maskedUrl = url.substring(0, 20) + '****' + url.substring(url.length - 10);
      } else {
        maskedUrl = url.substring(0, 10) + '****';
      }
    }
    res.json({
      code: 0,
      data: {
        configured: !!config.webhook_url,
        webhook_url_masked: maskedUrl,
        enabled: config.enabled !== false,         // 新增
        push_checkup: config.push_checkup !== false, // 新增
        push_daily: config.push_daily !== false,     // 新增
        push_reminder: config.push_reminder !== false, // 新增
      },
    });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 保存配置（自动测试发送）或仅更新推送偏好 */
router.post('/wecom/config', async (req, res) => {
  try {
    const { webhook_url, enabled, push_checkup, push_daily, push_reminder } = req.body || {};
    const hasPrefs = enabled !== undefined || push_checkup !== undefined || push_daily !== undefined || push_reminder !== undefined;

    // 模式1：仅更新推送偏好（不传 webhook_url 或传空字符串但带了偏好字段）
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
      });
      return res.json({ code: 0, data: { configured: true }, message: '推送偏好已更新' });
    }

    // 模式2：完整保存（含 webhook_url）
    if (!webhook_url || !webhook_url.trim()) {
      return res.json({ code: 1001, data: null, message: 'Webhook地址不能为空' });
    }

    // 验证URL格式
    if (!webhook_url.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
      return res.json({ code: 1001, data: null, message: 'Webhook地址格式不正确' });
    }

    // 测试发送
    try {
      await sendWebhookMessage(webhook_url, {
        msgtype: 'text',
        text: { content: '🤰 孕程记 - 企业微信推送已连接成功！\n您将收到每日产检提醒和计划通知。' },
      });
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
    await sendWebhookMessage(config.webhook_url, {
      msgtype: 'markdown',
      markdown: {
        content: '🤰 **孕程记 测试消息**\n\n> 这是一条测试消息，如果您收到说明推送功能正常！✅',
      },
    });
    res.json({ code: 0, data: null, message: '测试消息已发送' });
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

    let content = `📋 **产检提醒**\n\n`;
    content += `> **${checkup_name || '产检'}**\n`;
    if (gestational_week) content += `> 孕 **${gestational_week}** 周\n`;
    if (checkup_date) content += `> 计划日期: ${checkup_date}\n`;
    if (items) content += `\n> 检查项目: ${items}\n`;

    await sendWebhookMessage(config.webhook_url, {
      msgtype: 'markdown',
      markdown: { content },
    });
    res.json({ code: 0, data: null, message: '提醒已发送' });
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/**
 * 每日看板推送（核心功能）
 * 推送内容：
 *   - 当前孕周、距预产期天数
 *   - 明天的待办事项（重点高亮）
 *   - 未来7天内的产检/计划/提醒
 *
 * 用法: POST /api/v1/wecom/daily-push 或由定时任务调用
 */
router.post('/wecom/daily-push', async (req, res) => {
  try {
    const config = readConfig();
    // 检查总开关
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

    // 获取孕期信息
    const pregnancy = await db.queryOne(
      'SELECT lmp, edd, current_week FROM pregnancy WHERE id = ?',
      [pregnancyId]
    );
    if (!pregnancy) {
      return res.json({ code: 1001, data: null, message: '未找到孕期记录' });
    }

    const dayjs = require('dayjs');
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const weekLater = dayjs().add(7, 'day').format('YYYY-MM-DD');

    // 计算孕周和距预产期天数
    let gestationalWeek = pregnancy.current_week || '?';
    let daysUntilDue = '?';
    if (pregnancy.lmp) {
      const lmpDay = dayjs(pregnancy.lmp);
      const diffDays = dayjs().diff(lmpDay, 'day');
      gestationalWeek = Math.floor(diffDays / 7);
      if (pregnancy.edd) {
        daysUntilDue = dayjs(pregnancy.edd).diff(dayjs(), 'day');
      }
    }

    // 构建消息
    let lines = [];
    lines.push(`🤰 **孕程记 · 每日看板**`);
    lines.push(`> 📅 ${today}  |  孕 **${gestationalWeek}** 周  |  ${typeof daysUntilDue === 'number' ? (daysUntilDue > 0 ? `距预产期${daysUntilDue}天` : daysUntilDue === 0 ? '**今天预产期！**' : `已过预产期${Math.abs(daysUntilDue)}天`) : ''}`);

    // --- 明日待办（重点） ---
    lines.push(`\n---\n### 🔔 明日待办 (${tomorrow})`);

    // 1. 明日的产检（从schedule_dates表）
    const tomorrowCheckups = await db.queryAll(
      `SELECT cs.id, cs.name, cs.week_range, sd.checkup_date
       FROM schedule_dates sd
       LEFT JOIN (
         SELECT id, name, week_range FROM prenatal_checkup WHERE pregnancy_id = ?
       ) cs ON sd.schedule_id = cs.id
       WHERE sd.checkup_date = ?`,
      [pregnancyId, tomorrow]
    );
    if (tomorrowCheckups.length > 0) {
      for (const c of tomorrowCheckups) {
        lines.push(`> ⚠️ **【产检】${c.name || c.id}** ${c.week_range ? '(' + c.week_range + ')' : ''}`);
      }
    }

    // 2. 明日的自定义产检
    const tomorrowCustoms = await db.queryAll(
      "SELECT id, name, checkup_date FROM custom_checkup WHERE pregnancy_id = ? AND checkup_date = ? AND is_completed = 0",
      [pregnancyId, tomorrow]
    );
    for (const c of tomorrowCustoms) {
      lines.push(`> ⚠️ **【自定义产检】${c.name}**`);
    }

    // 3. 明日的提醒/计划
    const tomorrowReminders = await db.queryAll(
      "SELECT title, trigger_date FROM reminder WHERE pregnancy_id = ? AND trigger_date = ? AND is_completed = 0",
      [pregnancyId, tomorrow]
    );
    for (const r of tomorrowReminders) {
      lines.push(`> ⚠️ **【提醒】${r.title}**`);
    }

    // 4. 明日的计划
    const tomorrowPlans = await db.queryAll(
      "SELECT content, record_date FROM plan WHERE pregnancy_id = ? AND record_date = ?",
      [pregnancyId, tomorrow]
    );
    for (const p of tomorrowPlans) {
      lines.push(`> ⚠️ **【计划】${p.content}**`);
    }

    if (tomorrowCheckups.length === 0 && tomorrowCustoms.length === 0 && tomorrowReminders.length === 0 && tomorrowPlans.length === 0) {
      lines.push('> ✅ 明日暂无安排，好好休息~');
    }

    // --- 未来7天内 ---
    lines.push(`\n---\n### 📆 近7天安排`);

    // 未来7天内的产检
    const upcomingCheckups = await db.queryAll(
      `SELECT cs.name, cs.week_range, sd.checkup_date
       FROM schedule_dates sd
       LEFT JOIN (
         SELECT id, name, week_range FROM prenatal_checkup WHERE pregnancy_id = ?
       ) cs ON sd.schedule_id = cs.id
       WHERE sd.checkup_date > ? AND sd.checkup_date <= ?
       ORDER BY sd.checkup_date`,
      [pregnancyId, today, weekLater]
    );
    for (const c of upcomingCheckups) {
      const d = dayjs(c.checkup_date);
      const diff = d.diff(dayjs(), 'day');
      const label = diff === 0 ? '(今天)' : diff === 1 ? '(明天)' : `(${diff}天后)`;
      lines.push(`> 🩺 ${c.name || c.id} ${c.week_range || ''} - **${c.checkup_date}** ${label}`);
    }

    // 未来7天内的自定义产检
    const upcomingCustoms = await db.queryAll(
      "SELECT name, checkup_date FROM custom_checkup WHERE pregnancy_id = ? AND checkup_date > ? AND checkup_date <= ? AND is_completed = 0 ORDER BY checkup_date",
      [pregnancyId, today, weekLater]
    );
    for (const c of upcomingCustoms) {
      const d = dayjs(c.checkup_date);
      const diff = d.diff(dayjs(), 'day');
      lines.push(`> 🩺 ${c.name} - **${c.checkup_date}** (${diff === 0 ? '今天' : diff + '天后'})`);
    }

    // 未来7天内的提醒
    const upcomingReminders = await db.queryAll(
      "SELECT title, trigger_date FROM reminder WHERE pregnancy_id = ? AND trigger_date > ? AND trigger_date <= ? AND is_completed = 0 ORDER BY trigger_date",
      [pregnancyId, today, weekLater]
    );
    for (const r of upcomingReminders) {
      const d = dayjs(r.trigger_date);
      const diff = d.diff(dayjs(), 'day');
      lines.push(`> 📌 ${r.title} - **${r.trigger_date}** (${diff === 0 ? '今天' : diff + '天后'})`);
    }

    if (upcomingCheckups.length === 0 && upcomingCustoms.length === 0 && upcomingReminders.length === 0) {
      lines.push('> ✅ 近7天暂无其他安排');
    }

    lines.push(`\n---\n> 💡 孕程记 · 自动推送`);

    await sendWebhookMessage(config.webhook_url, {
      msgtype: 'markdown',
      markdown: { content: lines.join('\n') },
    });

    res.json({ code: 0, data: null, message: '每日看板已推送' });
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

module.exports = router;
