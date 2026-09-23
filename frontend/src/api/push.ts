/** 孕程记 - 推送（企业微信 / 飞书）API */

import client from './client'

export type PushChannelKey = 'wecom' | 'feishu'

export interface PushChannelConfig {
  channel: PushChannelKey
  name: string
  needs_secret: boolean
  url_placeholder: string
  configured: boolean
  webhook_url_masked: string
  enabled: boolean
  push_checkup: boolean
  push_daily: boolean
  push_reminder: boolean
  push_time: string
  secret_set?: boolean
  status?: { success: boolean; message: string }
}

export interface PushPrefs {
  enabled?: boolean
  push_checkup?: boolean
  push_daily?: boolean
  push_reminder?: boolean
  push_time?: string
  secret?: string
  webhook_url?: string
}

export const pushApi = {
  /** 所有渠道的配置摘要 + 状态 */
  getChannels: () => client.get('/push/channels'),

  /** 单个渠道的配置（URL 脱敏） */
  getChannelConfig: (channel: PushChannelKey) => client.get(`/${channel}/config`),

  /**
   * 保存渠道配置。
   * - 传 webhook_url（非空）→ 保存并测试发送
   * - 传 webhook_url: '' → 清除该渠道配置
   * - 不传 webhook_url，只传偏好 → 仅更新开关/内容/时间
   */
  saveChannelConfig: (channel: PushChannelKey, payload: PushPrefs) => client.post(`/${channel}/config`, payload),

  /** 指定渠道发测试消息 */
  sendTest: (channel: PushChannelKey) => client.post(`/push/test/${channel}`),

  /** 推送记录（可按渠道过滤） */
  getLogs: (filter?: 'today' | 'week7' | 'all', channel?: PushChannelKey | '') =>
    client.get('/push/logs', { params: { filter: filter || 'all', channel: channel || '' } }),

  /** 重试某条记录（渠道由记录自身决定） */
  retry: (logId: string) => client.post(`/push/retry/${logId}`),

  /** 手动推送到所有已启用渠道 */
  dailyPushAll: (pregnancyId: string) => client.post('/push/daily-push', { pregnancy_id: pregnancyId }),
}
