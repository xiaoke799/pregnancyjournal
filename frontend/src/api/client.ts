/** 孕程记 - Axios 实例（统一请求/响应拦截）。
 *
 * 飞牛 CGI 模式下，前端通过 /cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1 访问后端。
 * 开发环境通过 Vite 代理，生产环境通过 CGI 代理。
 * 使用相对路径，自动适配开发和生产环境。
 */

import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import type { ApiResponse } from '@/types'
import logger from '@/utils/logger'
import { getApiBase } from '@/utils/api-base'

/** 飞牛网关拦截时的响应体（与应用自身的 `code/message` 不是一套） */
interface GatewayErrorBody {
  errno: number
  errmsg?: string
}

/**
 * 「响应已被拦截器解包」的类型声明。
 *
 * 【为什么需要】响应拦截器（见下方 `interceptors.response.use`）把 `AxiosResponse`
 * 直接换成了 `ApiResponse` —— 运行时是真的解包了。但 axios 的类型里
 * `client.get()` 的返回值仍按 `Promise<AxiosResponse<T>>` 算，于是**调用侧每写一次
 * `res.code` 就报一个类型错误**。本项目因此长期挂着 15 个类型错误，
 * 后果不是"只是难看"：**新出现的真错误会被这堆常驻噪音淹掉**（2026-09-30 之前没人发现）。
 *
 * 这里把实例的方法返回类型如实改成 `ApiResponse<T>`，与运行时对齐。
 * ⚠️ 全项目没有任何地方依赖 `AxiosResponse.status / headers`（已 grep 确认），
 *    所以这样标注不会掩盖真实用法；真要看响应头请另建原生 axios 实例。
 * ⚠️ 用 `Omit` 摘掉 axios 原有方法再交叉，是为了**避免重载并存导致原签名优先**。
 */
type UnwrappedApiClient = {
  request<T = any>(config: AxiosRequestConfig): Promise<ApiResponse<T>>
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  head<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  options<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
  patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>>
}

type ApiClient = Omit<AxiosInstance, 'request' | 'get' | 'delete' | 'head' | 'options' | 'post' | 'put' | 'patch'>
  & UnwrappedApiClient

// baseURL 不能用 './api/v1' 之类的相对路径：入口 URL 无尾斜杠时
// （/app/pregnancyjournal）相对解析会丢掉前缀变成 /app/api/v1，
// 请求会打到飞牛系统 API 上（返回 401 {errno:8192, errmsg:"参数错误"}）。
const client = axios.create({
  baseURL: getApiBase(),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
}) as ApiClient

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
// ⚠️ 返回类型必须放宽为 `any`：这里**故意**把 AxiosResponse 换成 ApiResponse，
//    而 axios 的 InterceptorManager 仍按 AxiosResponse 校验（见上方 UnwrappedApiClient 注释）。
client.interceptors.response.use(
  (response: AxiosResponse<ApiResponse<any> | GatewayErrorBody>): any => {
    const data = response.data
    // FnOS 网关层拦截（非应用自身响应）
    if (data && typeof (data as GatewayErrorBody).errno === 'number') {
      return Promise.reject(new Error((data as GatewayErrorBody).errmsg || '网关拦截'))
    }
    if (data && typeof (data as ApiResponse<any>).code === 'number' && (data as ApiResponse<any>).code !== 0) {
      return Promise.reject(new Error((data as ApiResponse<any>).message || '请求失败'))
    }
    return data
  },
  (error: Error & {
    response?: { status: number; data?: { message?: string; errno?: number; errmsg?: string } }
    request?: unknown
    config?: { url?: string }
  }): Promise<never> => {
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
          // data 的类型已含能识别的 errno/errmsg（见上方 error 形参声明），不再需要 as any
          const isFnOS = !!data && typeof data.errno === 'number'
          const msg = isFnOS ? data?.errmsg : data?.message
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
