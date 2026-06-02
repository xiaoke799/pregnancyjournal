/** 孕程记 - Axios 实例（统一请求/响应拦截）。
 *
 * 飞牛网关模式下，前端通过 /app/pregnancy-journal/api/v1 访问后端。
 * 使用 Vite BASE_URL 自动适配开发和生产环境。
 */

import axios from 'axios'

const client = axios.create({
  baseURL: import.meta.env.BASE_URL + 'api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截
client.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截 - 增强错误处理
client.interceptors.response.use(
  (response) => {
    const data = response.data
    if (data && typeof data.code === 'number' && data.code !== 0) {
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return data
  },
  (error) => {
    if (error.response) {
      const status = error.response.status
      const data = error.response.data

      // 根据状态码提供友好提示
      switch (status) {
        case 400:
          console.error('请求参数错误:', data?.message || error.message)
          break
        case 401:
          console.warn('未授权，继续当前会话')
          break
        case 403:
          console.error('无权限访问:', data?.message || '操作被拒绝')
          break
        case 404:
          console.error('资源不存在:', data?.message || '请求的资源未找到')
          break
        case 422:
          // 表单验证错误，由各组件自行处理
          break
        case 500:
          console.error('服务器内部错误:', data?.message || '服务器繁忙，请稍后重试')
          break
        case 502:
        case 503:
        case 504:
          console.error('服务不可用:', '后端服务可能正在启动中，请稍后重试')
          break
        default:
          console.error(`请求失败 [${status}]:`, data?.message || error.message)
      }
    } else if (error.request) {
      // 请求已发出但没有响应（网络问题）
      console.error('网络连接失败:', '请检查网络连接或后端服务是否正常运行')
    } else {
      console.error('请求配置错误:', error.message)
    }

    return Promise.reject(error)
  }
)

export default client
