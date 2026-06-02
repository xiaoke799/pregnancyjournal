/** 孕程记 - 产检记录 API（含自定义产检、报告上传、NAS文件浏览）。 */

import client from './client'

export const checkupApi = {
  // 标准产检
  create: (data: any) => client.post('/checkups', data),
  list: (pregnancyId: string, page = 1, pageSize = 20) =>
    client.get('/checkups', { params: { pregnancy_id: pregnancyId, page, page_size: pageSize } }),
  get: (id: string) => client.get(`/checkups/${id}`),
  update: (id: string, data: any) => client.put(`/checkups/${id}`, data),
  delete: (id: string) => client.delete(`/checkups/${id}`),
  uploadPhoto: (checkupId: string, file: File, note?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (note) formData.append('note', note)
    return client.post(`/checkups/${checkupId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  listPhotos: (checkupId: string) => client.get(`/checkups/${checkupId}/photos`),
  deletePhoto: (photoId: string) => client.delete(`/checkups/photos/${photoId}`),

  // 自定义产检
  createCustom: (data: { pregnancy_id: string; name: string; items?: string[]; checkup_date?: string; notes?: string }) =>
    client.post('/checkups/custom', data),
  listCustom: (pregnancyId: string) =>
    client.get('/checkups/custom', { params: { pregnancy_id: pregnancyId } }),
  updateCustom: (id: string, data: any) => client.put(`/checkups/custom/${id}`, data),
  deleteCustom: (id: string) => client.delete(`/checkups/custom/${id}`),
  markCustomComplete: (id: string) => client.put(`/checkups/custom/${id}/complete`),

  // 产检报告附件（支持分类 + NAS上传）
  uploadReport: (checkupId: string, file: File, checkupType: string = 'standard', category: string = '其他', subItem?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('checkup_type', checkupType)
    formData.append('report_category', category)
    if (subItem) formData.append('sub_item', subItem)
    return client.post(`/checkups/${checkupId}/reports`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  /** 从 NAS 复制文件作为报告 */
  uploadReportFromNas: (checkupId: string, nasPath: string, checkupType: string = 'standard', category: string = '其他', subItem?: string) => {
    const formData = new FormData()
    formData.append('checkup_type', checkupType)
    formData.append('report_category', category)
    formData.append('nas_path', nasPath)
    if (subItem) formData.append('sub_item', subItem)
    return client.post(`/checkups/${checkupId}/reports/from-nas`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  listReports: (checkupId: string, checkupType: string = 'standard') =>
    client.get(`/checkups/${checkupId}/reports`, { params: { checkup_type: checkupType } }),
  getReportDownloadUrl: (reportId: string) =>
    `${client.defaults.baseURL}/checkups/reports/${reportId}/download`,
  deleteReport: (reportId: string) => client.delete(`/checkups/reports/${reportId}`),

  // NAS 文件浏览
  browseNasFiles: (path: string = '/') =>
    client.get('/files/browse', { params: { path } }),

  // 产检日期
  getScheduleDates: (pregnancyId: string) =>
    client.get(`/checkup-schedule/${pregnancyId}/dates`),
  setScheduleDate: (pregnancyId: string, scheduleId: string, dateStr: string) => {
    const formData = new FormData()
    formData.append('date_str', dateStr)
    return client.put(`/checkup-schedule/${pregnancyId}/dates/${scheduleId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}
