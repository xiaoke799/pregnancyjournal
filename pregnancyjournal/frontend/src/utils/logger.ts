/**
 * 孕程记 - 前端日志系统
 * 特性：级别分级、session 标记、保留最近 N 条供调试上报
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts: string
  level: LogLevel
  category: string
  message: string
  data?: unknown
}

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const CONFIG = {
  level: (import.meta.env?.DEV ? 'debug' : 'info') as LogLevel,
  maxBuffer: 200, // 内存中保留最近 N 条日志
 categories: new Set(['HTTP', '组件', '路由', 'Store', '业务']),
}

// 环形缓冲区：保存最近的日志条目供"导出日志"或"诊断"用
const buffer: LogEntry[] = []
let sessionId = ''

/** 生成会话 ID（用于关联同一次页面加载的所有日志） */
function ensureSessionId() {
  if (!sessionId) {
    sessionId = `fe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  }
  return sessionId
}

function log(level: LogLevel, category: string, message: string, data?: unknown) {
  if (LEVEL_VALUE[level] < LEVEL_VALUE[CONFIG.level]) return

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
  }
  if (data !== undefined) entry.data = data

  // 写入缓冲区
  buffer.push(entry)
  if (buffer.length > CONFIG.maxBuffer) buffer.shift()

  // 控制台输出
  const prefix = `[${entry.ts.substring(11, 19)}] [${level.toUpperCase().padEnd(5)}] [${category}]`
  switch (level) {
    case 'error':
      console.error(prefix, message, data ?? '')
      break
    case 'warn':
      console.warn(prefix, message, data ?? '')
      break
    case 'info':
      console.info(prefix, message, data ?? '')
      break
    default:
      console.log(prefix, message, data ?? '')
  }
}

/** 获取当前缓冲区日志（供诊断页面使用） */
export function getLogBuffer(filter?: { level?: LogLevel; category?: string; limit?: number }): LogEntry[] {
  let entries = [...buffer]
  if (filter?.level) entries = entries.filter(e => LEVEL_VALUE[e.level] >= LEVEL_VALUE[filter.level!])
  if (filter?.category) entries = entries.filter(e => e.category.includes(filter.category!))
  const limit = filter?.limit ?? 50
  return entries.slice(-limit)
}

/** 导出缓冲区日志为字符串 */
export function exportLogs(): string {
  return buffer.map(e => JSON.stringify(e)).join('\n')
}

/** 获取会话 ID */
export function getSessionId(): string {
  return ensureSessionId()
}

/** 设置最小日志级别 */
export function setLogLevel(level: LogLevel) {
  CONFIG.level = level
}

/** 日志 API */
export const logger = {
  debug: (cat: string, msg: string, data?: unknown) => log('debug', cat, msg, data),
  info: (cat: string, msg: string, data?: unknown) => log('info', cat, msg, data),
  warn: (cat: string, msg: string, data?: unknown) => log('warn', cat, msg, data),
  error: (cat: string, msg: string, data?: unknown) => log('error', cat, msg, data),
  getLogBuffer,
  exportLogs,
  getSessionId,
  setLogLevel,
}

export default logger
