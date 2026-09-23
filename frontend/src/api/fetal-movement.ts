/** 孕程记 - 胎动计数 API。 */

import client from './client'

export const fetalMovementApi = {
  createSession: (pregnancyId: string) => client.post('/fetal-movements/sessions', { pregnancy_id: pregnancyId }),
  listSessions: (pregnancyId?: string) => client.get('/fetal-movements/sessions', { params: { pregnancy_id: pregnancyId } }),
  getSession: (id: string) => client.get(`/fetal-movements/sessions/${id}`),
  endSession: (id: string, notes?: string) => client.put(`/fetal-movements/sessions/${id}`, { notes }),
  recordKick: (sessionId: string) => client.post(`/fetal-movements/sessions/${sessionId}/kicks`),
  listKicks: (sessionId: string) => client.get(`/fetal-movements/sessions/${sessionId}/kicks`),
}
