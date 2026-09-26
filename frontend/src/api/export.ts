import client from './client'

export const exportApi = {
  backup: (dir: string) => client.post('/backup', { dir }),
  restore: (dir: string) => client.post('/restore', { dir }),
  restoreLatest: () => client.post('/restore-latest'),

  browseDir: (dirPath?: string) =>
    client.get('/browse-dir', { params: { path: dirPath || '/' } }),

  /** 默认备份落点 + 用户已授权的目录（应用设置页里授权的那份） */
  storageInfo: () => client.get('/storage-info'),

  /** 确认并记住一个手动指定的导出目录（后端会先做一次真实写入测试） */
  trustDir: (dir: string) => client.post('/trust-dir', { dir }),

  exportCsv: (params?: Record<string, any>) =>
    client.get('/export/csv', { params, responseType: 'blob' }),

  exportDiaryPdf: (params?: Record<string, any>) =>
    client.get('/export/diary-pdf', { params, responseType: 'blob' }),

  exportAlbumPdf: (params?: Record<string, any>) =>
    client.get('/export/album-pdf', { params, responseType: 'blob' }),

  getLogs: (lines?: number) =>
    client.get('/logs', { params: lines ? { lines } : {} }),

  clearLogs: () => client.delete('/logs'),
}
