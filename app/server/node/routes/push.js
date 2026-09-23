/**
 * 推送通用路由（跨渠道）
 *
 * 各渠道自己的配置接口在 /wecom/* 与 /feishu/*；这里放「不区分渠道」的操作：
 *   GET  /push/channels            所有渠道的配置摘要 + 状态
 *   GET  /push/logs?filter=&channel=  推送记录（可跨渠道，也可按渠道过滤）
 *   POST /push/retry/:id           重试某条记录（渠道由记录自身决定）
 *   POST /push/test/:channel       指定渠道发测试消息
 *   POST /push/daily-push          手动推送到所有已启用渠道（首页按钮）
 */
const express = require('express');
const router = express.Router();
const engine = require('../services/push-engine');

/** 所有渠道的配置与状态 */
router.get('/push/channels', (req, res) => {
  try {
    const data = engine.channelList().map((ch) => {
      const summary = engine.channelConfigSummary(ch.key);
      const { status } = engine.channelStatus(ch.key);
      return { ...summary, status };
    });
    res.json({ code: 0, data });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 推送记录 */
router.get('/push/logs', (req, res) => {
  try {
    const rows = engine.queryPushLogs(req.query.filter || 'all', req.query.channel || '');
    res.json({ code: 0, data: rows, message: 'success' });
  } catch (e) {
    res.json({ code: 1001, data: null, message: e.message });
  }
});

/** 重试某条推送记录 */
router.post('/push/retry/:id', async (req, res) => {
  try {
    const r = await engine.retryLog(req.params.id);
    res.json({ code: 0, data: null, message: r.message });
  } catch (e) {
    res.json({ code: e.code || 1002, data: null, message: e.message });
  }
});

/** 指定渠道发送测试消息 */
router.post('/push/test/:channel', async (req, res) => {
  try {
    const r = await engine.sendTestMessage(req.params.channel);
    res.json({ code: 0, data: null, message: r.message });
  } catch (e) {
    res.json({ code: 1002, data: null, message: e.message });
  }
});

/** 手动推送到所有已启用渠道 */
router.post('/push/daily-push', async (req, res) => {
  try {
    const pregnancyId = req.body && req.body.pregnancy_id;
    if (!pregnancyId) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id' });
    }
    const results = await engine.pushToAllChannels(pregnancyId, 'manual');
    const failed = results.filter(r => !r.success);
    const okNames = results.filter(r => r.success).map(r => r.name).join('、');

    if (failed.length === 0) {
      return res.json({ code: 0, data: { results, partial_failed: false }, message: `已推送到 ${okNames}` });
    }
    // 部分渠道失败：整体仍算成功（有渠道收到了），但把失败原因带给用户
    res.json({
      code: 0,
      data: { results, partial_failed: true },
      message: `已推送到 ${okNames}；${failed.map(f => `${f.name}失败：${f.message}`).join('；')}`,
    });
  } catch (e) {
    res.json({ code: e.noChannel ? 1001 : 1002, data: null, message: e.message });
  }
});

module.exports = router;
