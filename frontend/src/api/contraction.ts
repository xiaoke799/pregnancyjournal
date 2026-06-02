/** 孕程记 - 宫缩计时 API。 */

import client from './client'

export const contractionApi = {
  createSession: (pregnancyId: string) => client.post('/contractions/sessions', { pregnancy_id: pregnancyId }),
  listSessions: (pregnancyId?: string) => client.get('/contractions/sessions', { params: { pregnancy_id: pregnancyId } }),
  getSession: (id: string) => client.get(`/contractions/sessions/${id}`),
  endSession: (id: string, notes?: string) => client.put(`/contractions/sessions/${id}`, { notes }),
  recordContraction: (sessionId: string, action: 'start' | 'end' | 'manual', startTime?: string, endTime?: string) =>
    client.post(`/contractions/sessions/${sessionId}/contractions`, {
      action,
      ...(action === 'manual' && startTime && endTime ? { start_time: startTime, end_time: endTime } : {}),
    }),
  listContractions: (sessionId: string) => client.get(`/contractions/sessions/${sessionId}/contractions`),
  analyze: (sessionId: string) => client.get(`/contractions/sessions/${sessionId}/analysis`),
}
