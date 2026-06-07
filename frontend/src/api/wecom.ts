/** 孵程记 - 企业微信群机器人 API。 */

import client from './client'

export const wecomApi = {
  /** 获取配置状态 */
  getStatus: () => client.get('/wecom/status'),

  /** 获取当前 Webhook URL（脱敏） */
  getConfig: () => client.get('/wecom/config'),

  /** 保存 Webhook URL（自动测试发送） */
  saveConfig: (webhookUrl: string) => client.post('/wecom/config', { webhook_url: webhookUrl }),

  /** 发送测试消息 */
  sendTest: () => client.post('/wecom/send-test'),

  /** 手动发送产检提醒 */
  sendCheckupReminder: (checkupName: string, week: number, date: string, items?: string) =>
    client.post('/wecom/send-checkup-reminder', undefined, {
      params: {
        checkup_name: checkupName,
        gestational_week: week,
        checkup_date: date,
        items,
      },
    }),
}
