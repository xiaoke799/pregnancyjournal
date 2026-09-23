/** 孕程记 - 企业微信群机器人 API */

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
