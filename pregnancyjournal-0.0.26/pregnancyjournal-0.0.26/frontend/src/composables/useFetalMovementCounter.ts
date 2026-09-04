/** 孕程记 - 胎动计数 Hook。 */

import { ref, computed } from 'vue'
import { fetalMovementApi } from '@/api/fetal-movement'

export function useFetalMovementCounter() {
  const sessionId = ref<string | null>(null)
  const kickCount = ref(0)
  const isRunning = ref(false)
  const startTime = ref<string | null>(null)
  const kicks = ref<any[]>([])

  async function startSession(pregnancyId: string) {
    const res: any = await fetalMovementApi.createSession(pregnancyId)
    if (res.code === 0 && res.data) {
      sessionId.value = res.data.id
      kickCount.value = 0
      startTime.value = res.data.start_time
      kicks.value = []
      isRunning.value = true
    }
  }

  async function recordKick() {
    if (!sessionId.value) return
    const res: any = await fetalMovementApi.recordKick(sessionId.value)
    if (res.code === 0 && res.data) {
      kickCount.value++
      kicks.value.push(res.data)
    }
  }

  async function endSession(notes?: string) {
    if (!sessionId.value) return
    await fetalMovementApi.endSession(sessionId.value, notes)
    isRunning.value = false
    sessionId.value = null
  }

  function reset() {
    sessionId.value = null
    kickCount.value = 0
    isRunning.value = false
    startTime.value = null
    kicks.value = []
  }

  return {
    sessionId, kickCount, isRunning, startTime, kicks,
    startSession, recordKick, endSession, reset,
  }
}
