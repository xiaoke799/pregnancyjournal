/** 孕程记 - 参考数据 API。 */

import client from './client'

export const referenceApi = {
  getDevelopment: (week?: number) =>
    week ? client.get(`/reference/development/${week}`) : client.get('/reference/development'),
  getCheckupPlan: () => client.get('/reference/checkup-plan'),
  getCheckupKnowledge: (type: string) => client.get(`/reference/checkup-items/${type}`),
  getReferenceRanges: (category: string) => client.get(`/reference/ranges/${category}`),
  getIomWeight: () => client.get('/reference/iom-weight'),
  getFoodSafety: (keyword?: string) => client.get('/reference/food-safety', { params: { keyword } }),
}
