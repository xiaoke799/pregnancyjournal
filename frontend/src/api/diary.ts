/** 孕程记 - 日记 API（独立于 daily-record，使用 diary_entry 表）。 */

import client from './client'

export const diaryApi = {
  /** 创建日记 */
  create: (data: { pregnancy_id: string; entry_date: string; content: string; mood?: string; title?: string }) =>
    client.post('/diaries', data),

  /** 获取日记列表 */
  list: (pregnancyId: string, params?: { start_date?: string; end_date?: string; page?: number; page_size?: number }) =>
    client.get('/diaries', { params: { pregnancy_id: pregnancyId, ...params } }),

  /** 获取单篇日记 */
  get: (id: string) => client.get(`/diaries/${id}`),

  /** 更新日记 */
  update: (id: string, data: { entry_date?: string; content?: string; mood?: string; title?: string }) =>
    client.put(`/diaries/${id}`, data),

  /** 删除日记 */
  delete: (id: string) => client.delete(`/diaries/${id}`),
}
