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

  /**
   * **恢复**一条已经存在、但还没结束的会话（今天中途退出页面留下的那条）。
   *
   * 【为什么必须要有】计时器页进页面就建会话、退出页面只做本地 reset（不结束服务端会话），
   * 且此前**没有任何恢复入口** ⇒ 用户计到一半退出，那条会话的 end_time 永远是 NULL：
   *   · 首页宫缩卡一直显示「计时中…」（现在按今天过滤，当天仍然如此）；
   *   · 再进计时器页又**新建**一条 ⇒ 未结束的会话越积越多；
   *   · 原来记下的那几条宫缩只能靠明细弹窗看到，页面上再也接不上。
   * 现在进页面时先找它：找到就接着用，不再新建。
   *
   * `session.start_time` 是 'HH:MM:SS'（当天），要拼上今天的日期才能还原「本次已持续」的走字。
   */
  async function resumeSession(session: any): Promise<boolean> {
    if (!session || !session.id) return false
    try {
      sessionId.value = session.id
      const res: any = await contractionApi.listContractions(session.id)
      const list = res && res.code === 0 && Array.isArray(res.data) ? res.data : []
      contractions.value = list.map((c: any) => ({
        startTime: c.start_time,
        endTime: c.end_time,
        duration: c.duration,
        interval: c.interval_from_prev,
      }))
      const withEnd = contractions.value.filter((c) => c.endTime)
      const lastDone = withEnd[withEnd.length - 1]
      lastDuration.value = (lastDone && lastDone.duration) || 0
      lastInterval.value = (lastDone && lastDone.interval) || 0

      // 最后一条宫缩没有 end_time ⇒ 退出时正计到一半，接着走字
      const last = list[list.length - 1]
      if (last && !last.end_time) {
        const day = session.session_date || new Date().toISOString().slice(0, 10)
        const t = new Date(`${day} ${String(last.start_time).slice(0, 8)}`)
        // 拼不出合法时间就退化成「会话开着但没在计时」，绝不把 Invalid Date 塞进走字逻辑
        if (!isNaN(t.getTime())) {
          isRunning.value = true
          currentStartTime.value = t
        } else {
          isRunning.value = false
          currentStartTime.value = null
        }
      } else {
        isRunning.value = false
        currentStartTime.value = null
      }
      // 恢复后同样重算 5-1-1：用户中途退出时若已经达标，回来必须还能看到告警
      // （以前恢复不碰这个状态，一条已经满足「每5分钟1次、持续1分钟、满1小时」的会话
      //   重新打开后告警条凭空消失，比不恢复更容易误导）。
      try {
        const a: any = await contractionApi.analyze(session.id)
        if (a && a.code === 0 && a.data) alert511.value = !!a.data.is_511_met
      } catch (e) { /* 分析失败不影响恢复 */ }
      return true
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
      const res: any = await contractionApi.recordContraction(sessionId.value, 'end')
      // ⚠️ **以后端返回的行为准**：它带着服务端算好的 duration / interval_from_prev（**秒**）。
      //    以前前端自己 `new Date(lastEnd)` 再算一遍 —— 而 lastEnd 在「恢复的会话」与
      //    「手动补记」里是 'HH:MM:SS'，`new Date('14:30:00')` = Invalid Date ⇒ 间隔算出 NaN
      //    （界面「距上次间隔」静默消失）；而且后端**拒绝**时（如没有进行中的宫缩）
      //    以前也会照常 push 一条本地记录，界面上会凭空多出一条不存在的宫缩。
      if (!res || res.code !== 0 || !res.data) {
        // 服务端没认：把状态退回「正在计时」，让用户可以再点一次结束（而不是静默半成功）
        isRunning.value = true
        return false
      }
      isRunning.value = false
      const c = res.data
      contractions.value.push({
        startTime: c.start_time,
        endTime: c.end_time,
        duration: c.duration,
        interval: c.interval_from_prev,
      })
      lastDuration.value = c.duration || 0
      lastInterval.value = c.interval_from_prev != null ? c.interval_from_prev : 0
      currentStartTime.value = null

      // 检查 5-1-1
      const analysis = await contractionApi.analyze(sessionId.value)
      if (analysis.code === 0 && analysis.data) {
        alert511.value = analysis.data.is_511_met
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
    startSession, resumeSession, startContraction, endContraction, recordManual, endSession, reset,
  }
}
