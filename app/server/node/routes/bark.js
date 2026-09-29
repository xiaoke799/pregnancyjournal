/**
 * Bark 推送路由（iOS）
 *
 * 发送/重试/调度等逻辑已统一到 services/push-engine.js（同时服务企业微信/飞书/钉钉/Bark），
 * 本文件只保留 Bark 专属的路由路径（/bark/*），与 wecom.js/feishu.js 完全同构：
 *   GET  /bark/status             配置状态
 *   GET  /bark/config             当前配置（URL 脱敏）
 *   POST /bark/config             保存配置或仅更新偏好
 *   POST /bark/send-test          发送测试消息
 *   POST /bark/daily-push         手动推送本渠道
 *   GET  /bark/push-logs          本渠道推送记录
 *   POST /bark/retry/:id          重试某条记录
 *   POST /bark/send-checkup-reminder  手动发一条产检提醒
 */
const { createChannelRouter } = require('./push-channel-router');

module.exports = createChannelRouter('bark');
