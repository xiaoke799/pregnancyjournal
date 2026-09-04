/** 孕程记 - 孕周计算前端工具。 */

import dayjs, { Dayjs } from 'dayjs'

export interface GestationalAge {
  weeks: number
  days: number
  totalDays: number
  daysUntilDue: number
  trimester: string
  /** 孕期阶段标识 */
  stageKey: 'preparing' | 'early' | 'mid' | 'late' | 'nursing' | 'unknown'
  /** 是否已过预产期 */
  isOverdue: boolean
  /** 是否在孕前（LMP之前） */
  isPrePregnancy: boolean
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
  const isOverdue = daysUntilDue < 0
  const isPrePregnancy = totalDays < 0

  let trimester = '孕早期'
  let stageKey: GestationalAge['stageKey'] = 'unknown'
  if (isPrePregnancy) {
    trimester = '备孕期'
    stageKey = 'preparing'
  } else if (isOverdue) {
    trimester = '预产期后'
    stageKey = 'nursing'
  } else if (weeks >= 28) {
    trimester = '孕晚期'
    stageKey = 'late'
  } else if (weeks >= 13) {
    trimester = '孕中期'
    stageKey = 'mid'
  } else {
    stageKey = 'early'
  }

  return { weeks, days, totalDays, daysUntilDue, trimester, stageKey, isOverdue, isPrePregnancy }
}

/** 根据预产期直接计算孕周（实时修正核心函数）。 */
export function calculateGestationalAgeFromDueDate(dueDateStr: string): GestationalAge {
  const dueDate = dayjs(dueDateStr)
  const today = dayjs()
  const daysUntilDue = dueDate.diff(today, 'day')
  // 从预产期倒推 LMP（280天）
  const lmp = dueDate.subtract(280, 'day')
  const totalDays = today.diff(lmp, 'day')
  const weeks = Math.floor(totalDays / 7)
  const days = totalDays % 7
  const isOverdue = daysUntilDue < 0
  const isPrePregnancy = totalDays < 0

  let trimester = '孕早期'
  let stageKey: GestationalAge['stageKey'] = 'unknown'
  if (isPrePregnancy) {
    trimester = '备孕期'
    stageKey = 'preparing'
  } else if (isOverdue) {
    trimester = '预产期后'
    stageKey = 'nursing'
  } else if (weeks >= 28) {
    trimester = '孕晚期'
    stageKey = 'late'
  } else if (weeks >= 13) {
    trimester = '孕中期'
    stageKey = 'mid'
  } else {
    stageKey = 'early'
  }

  return { weeks, days, totalDays, daysUntilDue, trimester, stageKey, isOverdue, isPrePregnancy }
}

/** 根据 LMP 计算预产期。 */
export function calculateDueDate(lmpDate: string): string {
  return dayjs(lmpDate).add(280, 'day').format('YYYY-MM-DD')
}

/** 根据受精日期计算预产期。 */
export function calculateDueDateFromConception(conceptionDate: string): string {
  return dayjs(conceptionDate).add(266, 'day').format('YYYY-MM-DD')
}

/** 获取当前时间戳（用于强制响应式更新）。 */
export function getCurrentTimestamp(): number {
  return Date.now()
}
