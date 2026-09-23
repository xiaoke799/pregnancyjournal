/**
 * 企业微信推送路由
 *
 * 发送/重试/调度等逻辑已统一到 services/push-engine.js（同时服务企业微信与飞书），
 * 本文件只保留企业微信专属的路由路径（/wecom/*），并保持与旧版本完全兼容：
 *   GET  /wecom/status             配置状态
 *   GET  /wecom/config             当前配置（URL 脱敏）
 *   POST /wecom/config             保存配置或仅更新偏好
 *   POST /wecom/send-test          发送测试消息
 *   POST /wecom/daily-push         手动推送本渠道
 *   GET  /wecom/push-logs          本渠道推送记录
 *   POST /wecom/retry/:id          重试某条记录
 *   POST /wecom/send-checkup-reminder  手动发一条产检提醒
 */
const { createChannelRouter } = require('./push-channel-router');

module.exports = createChannelRouter('wecom');
