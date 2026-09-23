/** 孕程记 - 孕期档案 API。 */

import client from './client'

export const pregnancyApi = {
  create: (data: any) => client.post('/pregnancies', data),
  list: () => client.get('/pregnancies'),
  getActive: () => client.get('/pregnancies/active'),
  getGestationalAge: () => client.get('/pregnancies/active/gestational-age'),
  get: (id: string) => client.get(`/pregnancies/${id}`),
  update: (id: string, data: any) => client.put(`/pregnancies/${id}`, data),
  activate: (id: string) => client.put(`/pregnancies/${id}/activate`),
}
