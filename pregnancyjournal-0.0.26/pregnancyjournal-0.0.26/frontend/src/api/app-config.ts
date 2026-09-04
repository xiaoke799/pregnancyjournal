/** 孕程记 - 应用配置 API。 */

import client from './client'

/** 获取初始设置状态 */
export function getSetupStatus() {
  return client.get('/app-config/setup_status')
}

/** 获取可用的存储路径 */
export function getAvailablePaths() {
  return client.get('/app-config/paths')
}

/** 执行首次设置向导 */
export function setupWizard(data: {
  storage_dir: string
  stage: string
  due_date?: string
  last_period_date?: string
  baby_name?: string
}) {
  return client.post('/app-config/setup', data)
}

/** 根据键获取配置 */
export function getConfig(key: string) {
  return client.get(`/app-config/${key}`)
}

/** 设置配置（存在则更新，不存在则创建） */
export function setConfig(data: { key: string; value: string; description?: string }) {
  return client.post('/app-config', data)
}

/** 获取全部配置 */
export function listConfigs() {
  return client.get('/app-config')
}

/** 获取存储目录 */
export function getStorageDir() {
  return client.get('/app-config/storage_dir')
}

/** 设置存储目录 */
export function setStorageDir(storageDir: string) {
  return client.post('/app-config/setup', { storage_dir: storageDir })
}
