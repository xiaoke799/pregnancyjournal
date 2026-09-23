/** 孕程记 - Axios 实例（统一请求/响应拦截）。
 *
 * 飞牛 CGI 模式下，前端通过 /cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1 访问后端。
 * 开发环境通过 Vite 代理，生产环境通过 CGI 代理。
 * 使用相对路径，自动适配开发和生产环境。
 */

import axios from 'axios'
import type { ApiResponse } from '@/types'
import logger from '@/utils/logger'
import { getApiBase } from '@/utils/api-base'

// baseURL 不能用 './api/v1' 之类的相对路径：入口 URL 无尾斜杠时
// （/app/pregnancyjournal）相对解析会丢掉前缀变成 /app/api/v1，
// 请求会打到飞牛系统 API 上（返回 401 {errno:8192, errmsg:"参数错误"}）。
const client = axios.create({
  baseURL: getApiBase(),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截
client.interceptors.request.use(
  (config) => {
    // 调试级别记录所有请求
    logger.debug('HTTP', `${config.method?.toUpperCase()} ${config.url}`, {
      params: config.params,
    })
    return config
  },
  (error) => {
    logger.error('HTTP', '请求拦截器错误', { message: error.message })
    return Promise.reject(error)
  }
)

// 响应拦截 - 增强错误处理
client.interceptors.response.use(
  <T = unknown>(response: { data: ApiResponse<T> }): ApiResponse<T> => {
    const data = response.data
    // FnOS 网关层拦截（非应用自身响应）
    if (data && typeof data.errno === 'number') {
      return Promise.reject(new Error(data.errmsg || '网关拦截'))
    }
    if (data && typeof data.code === 'number' && data.code !== 0) {
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return data
  },
  (error: Error & { response?: { status: number; data?: { message?: string } } }): Promise<never> => {
    if (error.response) {
      const status = error.response.status
      const data = error.response.data

      // 使用结构化日志记录
      const logPayload = { status, message: data?.message || error.message, url: error.config?.url }
      switch (status) {
        case 400:
          logger.warn('HTTP', '请求参数错误', logPayload)
          break
        case 401: {
          const isFnOS = data && typeof (data as any).errno === 'number'
          const msg = isFnOS ? (data as any).errmsg : data?.message
          logger.warn('HTTP', isFnOS ? 'FnOS网关未授权' : '应用未授权', { ...logPayload, message: msg })
          break
        }
        case 403:
          logger.warn('HTTP', '无权限访问', logPayload)
          break
        case 404:
          logger.warn('HTTP', '资源不存在', logPayload)
          break
        case 422:
          logger.warn('HTTP', '表单验证错误', logPayload)
          break
        case 500:
          logger.error('HTTP', '服务器内部错误', logPayload)
          break
        case 502:
        case 503:
        case 504:
          logger.error('HTTP', '服务不可用', logPayload)
          break
        default:
          logger.warn('HTTP', `请求失败 [${status}]`, logPayload)
      }
    } else if (error.request) {
      logger.error('HTTP', '网络连接失败', { message: error.message })
    } else {
      logger.error('HTTP', '请求配置错误', { message: error.message })
    }

    return Promise.reject(error)
  }
)

export default client
