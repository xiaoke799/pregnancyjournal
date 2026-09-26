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

/** 手动产检提醒的入参（后端从 query 读取，不是 body） */
export interface PushCheckupReminder {
  /** 产检名称，如「NT 检查」；后端缺省会用「产检」 */
  checkup_name: string
  /** 孕周 */
  gestational_week?: number
  /** 计划日期，如 2026-10-01 */
  checkup_date?: string
  /** 检查项目，多个用顿号/逗号分隔 */
  items?: string
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
   * 单个渠道的「是否已配置 + 最近一次推送结果」。
   * 与 getChannels() 的区别：getChannels 一次拿全部渠道的摘要，
   * 这个只查一个渠道，适合单独刷新某个渠道卡片。
   */
  getChannelStatus: (channel: PushChannelKey) => client.get(`/${channel}/status`),

  /**
   * 保存渠道配置。
   * - 传 webhook_url（非空）→ 保存并测试发送
   * - 传 webhook_url: '' → 清除该渠道配置
   * - 不传 webhook_url，只传偏好 → 仅更新开关/内容/时间
   */
  saveChannelConfig: (channel: PushChannelKey, payload: PushPrefs) => client.post(`/${channel}/config`, payload),

  /** 指定渠道发测试消息 */
  sendTest: (channel: PushChannelKey) => client.post(`/push/test/${channel}`),

  /**
   * 推送记录（可按渠道过滤）。
   *
   * ⚠️ `limit` 对应后端的条数上限（默认 300），**拿不到全量**：
   * 应用是每天定时推送的，「全部」若不限量会把所有历史记录一次性返回、
   * 前端再全部渲染成 DOM，设置页会越来越卡、越滚越长。
   */
  getLogs: (filter?: 'today' | 'week7' | 'all', channel?: PushChannelKey | '', limit = 300) =>
    client.get('/push/logs', { params: { filter: filter || 'all', channel: channel || '', limit } }),

  /** 重试某条记录（渠道由记录自身决定） */
  retry: (logId: string) => client.post(`/push/retry/${logId}`),

  /** 手动推送到所有已启用渠道 */
  dailyPushAll: (pregnancyId: string) => client.post('/push/daily-push', { pregnancy_id: pregnancyId }),

  /**
   * 手动发一条产检提醒。
   *
   * ⚠️ 只有「按渠道」的版本（`/${channel}/send-checkup-reminder`），
   * 后端没有跨渠道的 /push/send-checkup-reminder —— 要同时发两个渠道就调两次。
   * （后端注释：该接口目前前端未调用，属于保留能力。）
   */
  sendCheckupReminder: (
    channel: PushChannelKey,
    payload: PushCheckupReminder
  ) => client.post(`/${channel}/send-checkup-reminder`, undefined, { params: payload }),
}
