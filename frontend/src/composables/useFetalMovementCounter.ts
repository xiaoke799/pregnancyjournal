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

  /**
   * **恢复**今天还没结束的那次计数（中途退出页面留下的）。
   *
   * 同宫缩：本页退出时不结束服务端会话 ⇒ 一条 end_time=NULL 的会话挂在那里，
   * 以前再进来点「开始计数」会**新建**一条，之前数的次数虽然已汇总进当天记录，
   * 但会话页面接不上、明细里那条永远显示「未计时」。
   * 现在进页面时先把它接回来：次数、开始时间、逐次明细都还原。
   */
  async function resumeSession(session: any): Promise<boolean> {
    if (!session || !session.id) return false
    try {
      sessionId.value = session.id
      startTime.value = session.start_time || null
      const res: any = await fetalMovementApi.listKicks(session.id)
      kicks.value = res && res.code === 0 && Array.isArray(res.data) ? res.data : []
      // 明细条数优先（它就是「记录胎动」按下几次的真身）；取不到才退回会话汇总
      kickCount.value = kicks.value.length || Number(session.total_count) || 0
      isRunning.value = true
      return true
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
    startSession, resumeSession, recordKick, endSession, reset,
  }
}
