/** 孕程记 - 产检时间表 API。 */

import client from './client'

/** 获取产检时间表 */
export function getCheckupSchedule(pregnancyId?: string) {
  return client.get('/checkup-schedule', { params: { pregnancy_id: pregnancyId } })
}

/** 标记产检项目已完成 */
export function markCheckupCompleted(itemId: string, pregnancyId: string) {
  return client.put(`/checkup-schedule/${itemId}/complete`, undefined, {
    params: { pregnancy_id: pregnancyId },
  })
}
