/** 孕程记 - 照片/视频管理 API。 */

import client from './client'

export const photoApi = {
  upload: (formData: FormData) =>
    client.post('/photos', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  list: (pregnancyId: string, params?: { photo_type?: string; gestational_week?: number }) =>
    client.get('/photos', { params: { pregnancy_id: pregnancyId, ...params } }),
  get: (id: string) => client.get(`/photos/${id}`),
  update: (id: string, data: any) => client.put(`/photos/${id}`, data),
  delete: (id: string) => client.delete(`/photos/${id}`),
  fileUrl: (id: string) => `${import.meta.env.BASE_URL}api/v1/photos/${id}/file`,
  thumbnailUrl: (id: string) => `${import.meta.env.BASE_URL}api/v1/photos/${id}/thumbnail`,
}
