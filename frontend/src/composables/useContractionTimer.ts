/** 孕程记 - 宫缩计时 Hook。 */

import { ref, computed } from 'vue'
import { contractionApi } from '@/api/contraction'
import type { ContractionItem, ApiResponse } from '@/types'

export function useContractionTimer() {
  const sessionId = ref<string | null>(null)
  const isRunning = ref(false)
  const contractions = ref<ContractionItem[]>([])
  const currentStartTime = ref<Date | null>(null)
  const lastDuration = ref<number>(0)
  const lastInterval = ref<number>(0)
  const alert511 = ref(false)

  const totalCount = computed(() => contractions.value.length)

  /**
   * ⚠️ 同 useFetalMovementCounter：这几个操作一律返回**是否成功**。
   * 以前 sessionId 为空时是 `if (!sessionId.value) return` —— 界面毫无变化也不报错，
   * 而「会话没建起来」恰恰是最容易发生的（页面挂载时孕期档案可能还没取回）。
   * 那种情况下用户点「开始/结束」看到的就是纯粹的「没反应」。
   */
  async function startSession(pregnancyId: string): Promise<boolean> {
    try {
      const res = await contractionApi.createSession(pregnancyId)
      if (res.code === 0 && res.data) {
        sessionId.value = res.data.id
        contractions.value = []
        alert511.value = false
        return true
      }
      return false
    } catch (e) {
      return false
    }
  }

  async function startContraction(): Promise<boolean> {
    if (!sessionId.value) return false
    try {
      isRunning.value = true
      currentStartTime.value = new Date()
      await contractionApi.recordContraction(sessionId.value, 'start')
      return true
    } catch (e) {
      isRunning.value = false
      currentStartTime.value = null
      return false
    }
  }

  async function endContraction(): Promise<boolean> {
    if (!sessionId.value || !currentStartTime.value) return false
    try {
      isRunning.value = false

      const now = new Date()
      lastDuration.value = (now.getTime() - currentStartTime.value.getTime()) / 1000

      // 计算间隔
      if (contractions.value.length > 0) {
        const lastEnd = contractions.value[contractions.value.length - 1].endTime
        if (lastEnd) {
          lastInterval.value = (currentStartTime.value.getTime() - new Date(lastEnd).getTime()) / 1000
        }
      }

      await contractionApi.recordContraction(sessionId.value, 'end')

      contractions.value.push({
        startTime: currentStartTime.value.toISOString(),
        endTime: now.toISOString(),
        duration: lastDuration.value,
        interval: lastInterval.value,
      })
      currentStartTime.value = null

      // 检查 5-1-1
      if (sessionId.value) {
        const analysis = await contractionApi.analyze(sessionId.value)
        if (analysis.code === 0 && analysis.data) {
          alert511.value = analysis.data.is_511_met
        }
      }
      return true
    } catch (e) {
      return false
    }
  }

  async function endSession(notes?: string): Promise<boolean> {
    if (!sessionId.value) return false
    try {
      await contractionApi.endSession(sessionId.value, notes)
      sessionId.value = null
      isRunning.value = false
      return true
    } catch (e) {
      return false
    }
  }

  async function recordManual(startTime: string, endTime: string): Promise<boolean> {
    if (!sessionId.value) return false
    try {
      const res = await contractionApi.recordContraction(sessionId.value, 'manual', startTime, endTime)
      if (res.code === 0 && res.data) {
        const c = res.data
        contractions.value.push({
          startTime: c.start_time,
          endTime: c.end_time,
          duration: c.duration,
          interval: c.interval_from_prev,
        })
        lastDuration.value = c.duration || 0
        if (c.interval_from_prev) lastInterval.value = c.interval_from_prev
        return true
      }
      return false
    } catch (e) {
      return false
    }
  }

  function reset() {
    sessionId.value = null
    isRunning.value = false
    contractions.value = []
    currentStartTime.value = null
    lastDuration.value = 0
    lastInterval.value = 0
    alert511.value = false
  }

  return {
    sessionId, isRunning, contractions, currentStartTime,
    lastDuration, lastInterval, alert511, totalCount,
    startSession, startContraction, endContraction, recordManual, endSession, reset,
  }
}
