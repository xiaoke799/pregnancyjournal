/** 孕程记 - 孕周计算前端工具。 */

import dayjs, { Dayjs } from 'dayjs'

export interface GestationalAge {
  weeks: number
  days: number
  totalDays: number
  daysUntilDue: number
  trimester: string
}

/** 基于 LMP 计算孕周。 */
export function calculateGestationalAge(lmpDate: Dayjs | string): GestationalAge {
  const lmp = dayjs(lmpDate)
  const today = dayjs()
  const totalDays = today.diff(lmp, 'day')
  const weeks = Math.floor(totalDays / 7)
  const days = totalDays % 7
  const dueDate = lmp.add(280, 'day')
  const daysUntilDue = dueDate.diff(today, 'day')

  let trimester = '孕早期'
  if (weeks >= 28) trimester = '孕晚期'
  else if (weeks >= 13) trimester = '孕中期'

  return { weeks, days, totalDays, daysUntilDue, trimester }
}

/** 根据 LMP 计算预产期。 */
export function calculateDueDate(lmpDate: string): string {
  return dayjs(lmpDate).add(280, 'day').format('YYYY-MM-DD')
}

/** 根据受精日期计算预产期。 */
export function calculateDueDateFromConception(conceptionDate: string): string {
  return dayjs(conceptionDate).add(266, 'day').format('YYYY-MM-DD')
}
