import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.css'

// Naive UI 全局注册（必须，否则NDatePicker等组件不渲染）
import naive from 'naive-ui'

import logger from './utils/logger'

const app = createApp(App)
const pinia = createPinia()

// ============ 全局错误捕获 ============
app.config.errorHandler = (err, instance, info) => {
  logger.error('组件', `Vue渲染异常: ${info}`, {
    message: (err as Error)?.message,
    stack: (err as Error)?.stack?.substring(0, 300),
    component: (instance?.$options?.__name || instance?.$options?.name || 'unknown'),
  })
}

// 全局未捕获 Promise 异常
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  logger.error('Promise', '未处理的Promise拒绝', {
    reason: String(event.reason),
    stack: event.reason?.stack?.substring(0, 200),
  })
})

// 全局 JS 运行时错误
window.addEventListener('error', (event) => {
  // ResizeObserver 循环通知是浏览器保护机制，不影响功能，忽略
  if (event.message?.includes('ResizeObserver loop')) {
    event.stopImmediatePropagation()
    return
  }
  // 资源加载错误（图片、脚本等）单独处理，级别降低
  if (event.target && event.target !== window) {
    logger.warn('资源', `加载失败: ${(event.target as any)?.src || event.message}`)
    return
  }
  logger.error('运行时', event.message, { filename: event.filename, lineno: event.lineno })
})

// BFCache 处理：防止页面离开时 WebSocket 断开后无法恢复
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    logger.info('页面', '从 Back-Forward Cache 恢复')
  }
})
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    logger.debug('页面', '进入 Back-Forward Cache（WebSocket 可能被挂起）')
  }
})

// 记录应用启动
logger.info('启动', `孕程记 v${import.meta.env.VITE_APP_VERSION || '0.0.27'} 已加载`, {
  sessionId: logger.getSessionId(),
  userAgent: navigator.userAgent.substring(0, 80),
})

app.use(pinia)
app.use(router)
app.use(naive)
app.mount('#app')
