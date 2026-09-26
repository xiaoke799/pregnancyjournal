/** 孕程记 - 日期工具。 */

import dayjs from 'dayjs'

export function formatDate(date: string | Date, format = 'YYYY-MM-DD'): string {
  return dayjs(date).format(format)
}

export function formatTime(time: string | Date, format = 'HH:mm:ss'): string {
  return dayjs(time).format(format)
}

export function isToday(date: string): boolean {
  return dayjs(date).isSame(dayjs(), 'day')
}

export function getDaysDiff(startDate: string, endDate: string): number {
  return dayjs(endDate).diff(dayjs(startDate), 'day')
}

/**
 * 本地「今天」YYYY-MM-DD。
 * ⚠️ 不要用 `new Date().toISOString().split('T')[0]`——那是 UTC，
 * 东八区（及所有 UTC 以东时区）00:00~08:00 会算成**前一天**：
 * 新增记录的默认日期、导出文件名都曾因此差一天。
 * dayjs 的 format 走本地时区，正是需要的口径。
 */
export function localToday(date: string | Date = new Date()): string {
  return dayjs(date).format('YYYY-MM-DD')
}
