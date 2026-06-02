/** 孕程记 - 每日记录 API。 */

import client from './client'

export const dailyRecordApi = {
  upsert: (data: any) => client.post('/daily-records', data),
  list: (pregnancyId: string, params?: { start_date?: string; end_date?: string; page?: number; page_size?: number }) =>
    client.get('/daily-records', { params: { pregnancy_id: pregnancyId, ...params } }),
  getByDate: (date: string, pregnancyId: string) =>
    client.get(`/daily-records/${date}`, { params: { pregnancy_id: pregnancyId } }),
  update: (id: string, data: any) => client.put(`/daily-records/${id}`, data),
  delete: (id: string) => client.delete(`/daily-records/${id}`),
}
