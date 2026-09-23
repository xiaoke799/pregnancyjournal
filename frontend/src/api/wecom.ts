/**
 * 【已废弃】企业微信专用 API —— 请改用 `@/api/push`（pushApi）。
 *
 * 推送已升级为多渠道（企业微信 + 飞书），新代码统一走 pushApi：
 *   pushApi.getChannelConfig('wecom') / saveChannelConfig('wecom', ...) / sendTest('wecom')
 *   pushApi.getLogs() / retry() / dailyPushAll()
 *
 * 后端 /wecom/* 接口仍然保留（老版本客户端与自动化脚本还能用），
 * 本文件仅为这些旧接口留一份调用清单；当前前端已无任何地方引用它。
 */

import client from './client'

export const wecomApi = {
  /** 获取配置状态 */
  getStatus: () => client.get('/wecom/status'),

  /** 获取当前 Webhook URL（脱敏） */
  getConfig: () => client.get('/wecom/config'),

  /** 保存 Webhook URL（自动测试发送）或仅更新偏好 */
  saveConfig: (webhookUrl: string, prefs?: { enabled?: boolean; push_checkup?: boolean; push_daily?: boolean; push_reminder?: boolean; push_time?: string }) =>
    client.post('/wecom/config', { webhook_url: webhookUrl, ...prefs }),

  /** 发送测试消息 */
  sendTest: () => client.post('/wecom/send-test'),

  /** 手动发送产检提醒 */
  sendCheckupReminder: (checkupName: string, week: number, date: string, items?: string) =>
    client.post('/wecom/send-checkup-reminder', undefined, {
      params: { checkup_name: checkupName, gestational_week: week, checkup_date: date, items },
    }),

  /** 手动触发每日看板推送（首页按钮） */
  dailyPush: (pregnancyId: string) => client.post('/wecom/daily-push', { pregnancy_id: pregnancyId }),

  /** 查询推送记录列表 */
  getPushLogs: (filter?: 'today' | 'week7' | 'all') => client.get('/wecom/push-logs', { params: { filter: filter || 'all' } }),

  /** 重试失败的推送 */
  retryPush: (logId: string) => client.post(`/wecom/retry/${logId}`),
}
