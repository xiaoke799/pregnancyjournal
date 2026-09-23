/**
 * 飞书推送路由
 *
 * 与企业微信共用 services/push-engine.js 的发送/重试/调度逻辑，路由结构完全一致：
 *   GET  /feishu/status            配置状态
 *   GET  /feishu/config            当前配置（URL 脱敏，含是否已设置加签密钥）
 *   POST /feishu/config            保存配置或仅更新偏好（webhook_url / secret / 开关 / 时间）
 *   POST /feishu/send-test         发送测试消息
 *   POST /feishu/daily-push        手动推送本渠道
 *   GET  /feishu/push-logs         本渠道推送记录
 *   POST /feishu/retry/:id         重试某条记录
 *   POST /feishu/send-checkup-reminder  手动发一条产检提醒
 *
 * 飞书自定义机器人的三种安全设置都支持：
 *   - 自定义关键词：消息里含「孕程记」即可（看板正文自带），建议把关键词设为「孕程记」
 *   - IP 白名单：需把 NAS 出口 IP 加进去，否则报 19022
 *   - 签名校验：把加签密钥填到设置页「加签密钥」，引擎会自动带 timestamp/sign
 */
const { createChannelRouter } = require('./push-channel-router');

module.exports = createChannelRouter('feishu');
