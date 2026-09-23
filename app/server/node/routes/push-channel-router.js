/**
 * 推送渠道路由工厂
 *
 * 企业微信与飞书的「配置/测试/状态/记录」路由结构完全一致，只是渠道不同，
 * 因此共用同一个工厂产出 /wecom/* 与 /feishu/* 两套路由。
 * 所有真正的逻辑都在 services/push-engine.js 里。
 */
const express = require('express');
const engine = require('../services/push-engine');

function createChannelRouter(channelKey) {
  const router = express.Router();
  const channel = engine.getChannel(channelKey);
  if (!channel) throw new Error(`未知推送渠道: ${channelKey}`);
  const base = `/${channelKey}`;

  /** 获取配置状态 */
  router.get(`${base}/status`, async (req, res) => {
    try {
      const { status } = engine.channelStatus(channelKey);
      res.json({ code: 0, data: { configured: !!engine.readChannelConfig(channelKey).webhook_url, status } });
    } catch (e) {
      res.json({ code: 1001, data: null, message: e.message });
    }
  });

  /** 获取当前配置（URL 脱敏） */
  router.get(`${base}/config`, async (req, res) => {
    try {
      res.json({ code: 0, data: engine.channelConfigSummary(channelKey) });
    } catch (e) {
      res.json({ code: 1001, data: null, message: e.message });
    }
  });

  /** 保存配置或仅更新偏好 */
  router.post(`${base}/config`, async (req, res) => {
    try {
      const r = await engine.saveChannelConfig(channelKey, req.body);
      if (r.cleared) {
        return res.json({ code: 0, data: { configured: false, cleared: true }, message: r.message });
      }
      res.json({ code: 0, data: { configured: true, test_failed: !!r.test_failed }, message: r.message });
    } catch (e) {
      res.json({ code: e.code || 1001, data: null, message: e.message });
    }
  });

  /** 发送测试消息 */
  router.post(`${base}/send-test`, async (req, res) => {
    try {
      const r = await engine.sendTestMessage(channelKey);
      res.json({ code: 0, data: null, message: r.message });
    } catch (e) {
      res.json({ code: 1002, data: null, message: e.message });
    }
  });

  /** 手动推送本渠道（首页按钮走 /push/daily-push 会推到全部渠道） */
  router.post(`${base}/daily-push`, async (req, res) => {
    try {
      const r = await engine.manualPushChannel(channelKey, req.body && req.body.pregnancy_id);
      if (r.skipped) return res.json({ code: 0, data: null, message: r.message });
      res.json({ code: 0, data: null, message: r.message });
    } catch (e) {
      res.json({ code: e.code || 1002, data: null, message: e.message });
    }
  });

  /** 本渠道的推送记录 */
  router.get(`${base}/push-logs`, async (req, res) => {
    try {
      const rows = engine.queryPushLogs(req.query.filter || 'all', channelKey);
      res.json({ code: 0, data: rows, message: 'success' });
    } catch (e) {
      res.json({ code: 1001, data: null, message: e.message });
    }
  });

  /** 重试（兼容旧路径，记录自带渠道信息） */
  router.post(`${base}/retry/:id`, async (req, res) => {
    try {
      const r = await engine.retryLog(req.params.id);
      res.json({ code: 0, data: null, message: r.message });
    } catch (e) {
      res.json({ code: e.code || 1002, data: null, message: e.message });
    }
  });

  /** 手动发送一条产检提醒（保留旧接口，目前前端未调用） */
  router.post(`${base}/send-checkup-reminder`, async (req, res) => {
    try {
      const cfg = engine.readChannelConfig(channelKey);
      if (!cfg.webhook_url) return res.json({ code: 1001, data: null, message: `请先配置${channel.name} Webhook 地址` });
      const { checkup_name, gestational_week, checkup_date, items } = req.query;

      let content = '📋 产检提醒\n';
      content += `${checkup_name || '产检'}\n`;
      if (gestational_week) content += `孕${gestational_week}周\n`;
      if (checkup_date) content += `计划日期: ${checkup_date}\n`;
      if (items) content += `检查项目: ${items}\n`;

      const logId = await engine.recordPushLog('checkup', `产检提醒: ${checkup_name}`, 'pending', null, null, channelKey);
      try {
        await engine.sendChannelMessage(channelKey, cfg, content);
        await engine.finishPushLog(logId, 'success', null, content);
        res.json({ code: 0, data: null, message: '提醒已发送' });
      } catch (sendErr) {
        await engine.finishPushLog(logId, 'failed', sendErr.message, content);
        res.json({ code: 1002, data: null, message: sendErr.message });
      }
    } catch (e) {
      res.json({ code: 1002, data: null, message: e.message });
    }
  });

  return router;
}

module.exports = { createChannelRouter };
