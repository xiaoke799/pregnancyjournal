/** 孕程记 - 照片/视频管理 API。 */

import client from './client'
import { getApiBase } from '@/utils/api-base'

export const photoApi = {
  /** 上传照片/视频。onProgress：上传进度百分比回调（视频常有几十 MB，界面靠它显示「在传、传到哪了」） */
  upload: (formData: FormData, onProgress?: (pct: number) => void) =>
    client.post('/photos', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      onUploadProgress: (e: any) => {
        if (onProgress && e && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    }),
  list: (pregnancyId: string, params?: { photo_type?: string; gestational_week?: number }) =>
    client.get('/photos', { params: { pregnancy_id: pregnancyId, ...params } }),
  get: (id: string) => client.get(`/photos/${id}`),
  update: (id: string, data: any) => client.put(`/photos/${id}`, data),
  delete: (id: string) => client.delete(`/photos/${id}`),
  // 运行时推导前缀，比 import.meta.env.BASE_URL 更稳（不受入口 URL 形态影响）
  fileUrl: (id: string) => `${getApiBase()}/photos/${id}/file`,
  thumbnailUrl: (id: string) => `${getApiBase()}/photos/${id}/thumbnail`,
}
