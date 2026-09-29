/** 孕程记 - 胎动计数 Hook。 */

import { ref, computed } from 'vue'
import { fetalMovementApi } from '@/api/fetal-movement'

export function useFetalMovementCounter() {
  const sessionId = ref<string | null>(null)
  const kickCount = ref(0)
  const isRunning = ref(false)
  const startTime = ref<string | null>(null)
  const kicks = ref<any[]>([])

  /**
   * ⚠️ 这三个操作一律返回**是否成功**，绝不静默失败。
   * 以前失败时只是不更新状态（isRunning 不变、计数不涨），
   * 界面纹丝不动、也不报错 —— 用户看到的就是「点了没反应」，既不知道没成，也没法重试。
   */
  async function startSession(pregnancyId: string): Promise<boolean> {
    try {
      const res: any = await fetalMovementApi.createSession(pregnancyId)
      if (res.code === 0 && res.data) {
        sessionId.value = res.data.id
        kickCount.value = 0
        startTime.value = res.data.start_time
        kicks.value = []
        isRunning.value = true
        return true
      }
      return false
    } catch (e) {
      return false
    }
  }

  async function recordKick(): Promise<boolean> {
    if (!sessionId.value) return false
    try {
      const res: any = await fetalMovementApi.recordKick(sessionId.value)
      if (res.code === 0 && res.data) {
        kickCount.value++
        kicks.value.push(res.data)
        return true
      }
      return false
    } catch (e) {
      return false
    }
  }

  async function endSession(notes?: string): Promise<boolean> {
    if (!sessionId.value) return false
    try {
      await fetalMovementApi.endSession(sessionId.value, notes)
      isRunning.value = false
      sessionId.value = null
      return true
    } catch (e) {
      return false
    }
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
