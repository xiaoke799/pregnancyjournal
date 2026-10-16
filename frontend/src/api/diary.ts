/** 孕程记 - 日记 API（独立于 daily-record，使用 diary_entry 表）。 */

import client from './client'

/**
 * 日记的心情分值。
 *
 * ⚠️ 类型是 string 而不是 number：diary_entry.mood 列是 TEXT，保存时前端
 * `String(value)` 落库（见 DiaryView）。取值域 = `utils/format.ts` 的
 * `MOOD_OPTIONS`（1=很差 … 5=很好）—— 文案与 emoji 的真源也在那里，
 * 展示一律走 `getMoodLabel` / `getMoodEmoji`，别再另抄映射。
 */
export type DiaryMood = string

export const diaryApi = {
  /** 创建日记 */
  create: (data: { pregnancy_id: string; entry_date: string; content: string; mood?: string; title?: string; image_urls?: string[] }) =>
    client.post('/diaries', data),

  /** 获取日记列表 */
  list: (pregnancyId: string, params?: { start_date?: string; end_date?: string; page?: number; page_size?: number }) =>
    client.get('/diaries', { params: { pregnancy_id: pregnancyId, ...params } }),

  /** 获取单篇日记 */
  get: (id: string) => client.get(`/diaries/${id}`),

  /** 更新日记 */
  update: (id: string, data: { entry_date?: string; content?: string; mood?: string; title?: string; image_urls?: string[] }) =>
    client.put(`/diaries/${id}`, data),

  /** 删除日记 */
  delete: (id: string) => client.delete(`/diaries/${id}`),
}
