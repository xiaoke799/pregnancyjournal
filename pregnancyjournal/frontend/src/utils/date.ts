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
