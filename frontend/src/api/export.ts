import client from './client'

export const exportApi = {
  backup: (dir: string) => client.post('/backup', { dir }),
  restore: (dir: string) => client.post('/restore', { dir }),

  browseDir: (dirPath?: string) =>
    client.get('/browse-dir', { params: { path: dirPath || '/' } }),

  exportCsv: (params?: Record<string, any>) =>
    client.get('/export/csv', { params, responseType: 'blob' }),

  exportDiaryPdf: (params?: Record<string, any>) =>
    client.get('/export/diary-pdf', { params, responseType: 'blob' }),

  generatePdf: (pregnancyId: string) =>
    client.post('/pdf/generate', { pregnancy_id: pregnancyId }),

  getPdfProgress: (taskId: string) =>
    client.get(`/pdf/progress/${taskId}`),

  downloadPdf: (taskId: string) =>
    client.get(`/pdf/download/${taskId}`, { responseType: 'blob' }),

  getLogs: (lines?: number) =>
    client.get('/logs', { params: lines ? { lines } : {} }),

  clearLogs: () => client.delete('/logs'),
}
