/**
 * 钉钉推送路由
 *
 * 发送/重试/调度等逻辑已统一到 services/push-engine.js（同时服务企业微信/飞书/钉钉/Bark），
 * 本文件只保留钉钉专属的路由路径（/dingtalk/*），与 wecom.js/feishu.js 完全同构：
 *   GET  /dingtalk/status             配置状态
 *   GET  /dingtalk/config             当前配置（URL 脱敏）
 *   POST /dingtalk/config             保存配置或仅更新偏好
 *   POST /dingtalk/send-test          发送测试消息
 *   POST /dingtalk/daily-push         手动推送本渠道
 *   GET  /dingtalk/push-logs          本渠道推送记录
 *   POST /dingtalk/retry/:id          重试某条记录
 *   POST /dingtalk/send-checkup-reminder  手动发一条产检提醒
 */
const { createChannelRouter } = require('./push-channel-router');

module.exports = createChannelRouter('dingtalk');
