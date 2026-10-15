import client from './client'

export const exportApi = {
  backup: (dir?: string) => client.post('/backup', { dir }),
  /** ⚠️ 从指定目录恢复：前端目前只接了 restoreLatest，这一条是**预留能力**（不是死代码），
   *  后端 /restore 已实现并随权限闸门保护。补 UI 时直接用它。 */
  restore: (dir: string) => client.post('/restore', { dir }),
  restoreLatest: () => client.post('/restore-latest'),

  browseDir: (dirPath?: string) =>
    client.get('/browse-dir', { params: { path: dirPath || '/' } }),

  /** 默认备份落点 + 用户已授权的目录（应用设置页里授权的那份） */
  storageInfo: () => client.get('/storage-info'),

  /** 确认并记住一个手动指定的导出目录（后端会先做一次真实写入测试） */
  trustDir: (dir: string) => client.post('/trust-dir', { dir }),

  // ⚠️ 2026-10-15 删除三个零调用的导出封装（exportCsv / exportDiaryPdf / exportAlbumPdf）。
  //    它们与设置页真正在用的 exportViaDownload()（先 GET 预检、再隐藏 <a> 直链下载）
  //    是**同一批接口的两套实现**：blob 封装从未被调用，留着只会让人以为改这边就生效。
  //    接口本身（/export/csv、/export/diary-pdf、/export/album-pdf）完全没动。

  getLogs: (lines?: number) =>
    client.get('/logs', { params: lines ? { lines } : {} }),

  clearLogs: () => client.delete('/logs'),
}
