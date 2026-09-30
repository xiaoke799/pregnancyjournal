/** 孕程记 - 每日记录 API。 */

import client from './client'

export const dailyRecordApi = {
  upsert: (data: any) => client.post('/daily-records', data),
  create: (data: any) => client.post('/daily-records', data),
  list: (pregnancyId: string, params?: { start_date?: string; end_date?: string; page?: number; page_size?: number }) =>
    client.get('/daily-records', { params: { pregnancy_id: pregnancyId, ...params } }),
  getByDate: (pregnancyId: string, date: string) =>
    client.get(`/daily-records/by-date/${date}`, { params: { pregnancy_id: pregnancyId } }),
  /**
   * 当天「胎动 / 宫缩」每次会话的明细（计数器 / 计时器产生的原始记录）。
   * 汇总值在 daily_record 里，这里取的是「几点到几点、那一次记了多少」。
   */
  getSessionDetail: (pregnancyId: string, date: string) =>
    client.get('/daily-records/session-detail', { params: { pregnancy_id: pregnancyId, date } }),
  /**
   * 每天「次数最高的那一次会话」—— 统计曲线用（一天多次会话时只取一个点）。
   * 返回以日期为键的映射；只有「当天有会话」的日期才在里面，
   * 只手填的日子由调用方沿用 daily_record 的值。
   */
  getSessionDaily: (pregnancyId: string, params?: { start_date?: string; end_date?: string }) =>
    client.get('/daily-records/session-daily', { params: { pregnancy_id: pregnancyId, ...params } }),
  update: (id: string, data: any) => client.put(`/daily-records/${id}`, data),
  delete: (id: string) => client.delete(`/daily-records/${id}`),
}
