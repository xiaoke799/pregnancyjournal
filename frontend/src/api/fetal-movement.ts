/** 孕程记 - 胎动计数 API。 */

import client from './client'

export const fetalMovementApi = {
  createSession: (pregnancyId: string) => client.post('/fetal-movements/sessions', { pregnancy_id: pregnancyId }),
  /** date 传了就只取那一天的会话（记录页展示当天数了几次） */
  listSessions: (pregnancyId?: string, date?: string) =>
    client.get('/fetal-movements/sessions', { params: { pregnancy_id: pregnancyId, ...(date ? { date } : {}) } }),
  getSession: (id: string) => client.get(`/fetal-movements/sessions/${id}`),
  endSession: (id: string, notes?: string) => client.put(`/fetal-movements/sessions/${id}`, { notes }),
  recordKick: (sessionId: string) => client.post(`/fetal-movements/sessions/${sessionId}/kicks`),
  listKicks: (sessionId: string) => client.get(`/fetal-movements/sessions/${sessionId}/kicks`),
}
