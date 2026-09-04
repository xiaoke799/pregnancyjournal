/** 孕程记 - 提醒 API。 */

import client from './client'

export const reminderApi = {
  create: (data: any) => client.post('/reminders', data),
  list: (pregnancyId: string) => client.get('/reminders', { params: { pregnancy_id: pregnancyId } }),
  getUpcoming: (pregnancyId: string, days = 7) => client.get('/reminders/upcoming', { params: { pregnancy_id: pregnancyId, days } }),
  get: (id: string) => client.get(`/reminders/${id}`),
  update: (id: string, data: any) => client.put(`/reminders/${id}`, data),
  delete: (id: string) => client.delete(`/reminders/${id}`),
  complete: (id: string) => client.put(`/reminders/${id}`, { is_completed: 1 }),

  /** 获取统一事件流（产检计划 + 自定义提醒 + 记录异常） */
  getEvents: (pregnancyId: string, days = 14) =>
    client.get('/dashboard/events', { params: { pregnancy_id: pregnancyId, days } }),
}
