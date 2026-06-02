/** 孕程记 - 清单 API。 */

import client from './client'

export const checklistApi = {
  list: (pregnancyId: string) => client.get('/checklists', { params: { pregnancy_id: pregnancyId } }),
  get: (id: string) => client.get(`/checklists/${id}`),
  update: (id: string, name: string) => client.put(`/checklists/${id}`, null, { params: { name } }),
  addItem: (checklistId: string, data: any) => client.post(`/checklists/${checklistId}/items`, data),
  updateItem: (itemId: string, data: any) => client.put(`/checklists/items/${itemId}`, data),
  deleteItem: (itemId: string) => client.delete(`/checklists/items/${itemId}`),
  initDefault: (checklistId: string) => client.post(`/checklists/${checklistId}/init-default`),
  getProgress: (pregnancyId: string) => client.get('/checklists/progress', { params: { pregnancy_id: pregnancyId } }),
}
