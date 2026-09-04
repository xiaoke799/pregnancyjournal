/** 孕程记 - 首页概览 API。 */

import client from './client'

export const dashboardApi = {
  get: (pregnancyId: string) => client.get(`/dashboard?pregnancy_id=${pregnancyId}`),
}

/** 便捷导出 */
export const getDashboard = (pregnancyId: string) => dashboardApi.get(pregnancyId)
