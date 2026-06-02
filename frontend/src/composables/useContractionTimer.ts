/** 孕程记 - 宫缩计时 Hook。 */

import { ref, computed } from 'vue'
import { contractionApi } from '@/api/contraction'

export function useContractionTimer() {
  const sessionId = ref<string | null>(null)
  const isRunning = ref(false)
  const contractions = ref<any[]>([])
  const currentStartTime = ref<Date | null>(null)
  const lastDuration = ref<number>(0)
  const lastInterval = ref<number>(0)
  const alert511 = ref(false)

  const totalCount = computed(() => contractions.value.length)

  async function startSession(pregnancyId: string) {
    const res: any = await contractionApi.createSession(pregnancyId)
    if (res.code === 0 && res.data) {
      sessionId.value = res.data.id
      contractions.value = []
      alert511.value = false
    }
  }

  async function startContraction() {
    if (!sessionId.value) return
    isRunning.value = true
    currentStartTime.value = new Date()
    await contractionApi.recordContraction(sessionId.value, 'start')
  }

  async function endContraction() {
    if (!sessionId.value || !currentStartTime.value) return
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

    const res: any = await contractionApi.recordContraction(sessionId.value, 'end')

    contractions.value.push({
      startTime: currentStartTime.value.toISOString(),
      endTime: now.toISOString(),
      duration: lastDuration.value,
      interval: lastInterval.value,
    })
    currentStartTime.value = null

    // 检查 5-1-1
    if (sessionId.value) {
      const analysis: any = await contractionApi.analyze(sessionId.value)
      if (analysis.code === 0 && analysis.data) {
        alert511.value = analysis.data.is_511_met
      }
    }
  }

  async function endSession(notes?: string) {
    if (!sessionId.value) return
    await contractionApi.endSession(sessionId.value, notes)
    sessionId.value = null
    isRunning.value = false
  }

  async function recordManual(startTime: string, endTime: string) {
    if (!sessionId.value) return
    const res: any = await contractionApi.recordContraction(sessionId.value, 'manual', startTime, endTime)
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
