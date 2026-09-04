/** 孕程记 - 检查指标 API。 */

import client from './client'

export const labResultApi = {
  create: (data: any) => client.post('/lab-results', data),
  list: (params: { checkup_id?: string; category?: string }) =>
    client.get('/lab-results', { params }),
  trend: (params: { category: string; item_name: string; pregnancy_id: string }) =>
    client.get('/lab-results/trend', { params }),
  get: (id: string) => client.get(`/lab-results/${id}`),
  update: (id: string, data: any) => client.put(`/lab-results/${id}`, data),
  delete: (id: string) => client.delete(`/lab-results/${id}`),
}
