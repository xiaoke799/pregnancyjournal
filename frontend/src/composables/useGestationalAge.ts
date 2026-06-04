/** 孕程记 - 孕周计算 Hook（支持实时修正）。 */

import { computed, ref, onMounted, onUnmounted } from 'vue'
import { usePregnancyStore } from '@/stores/pregnancy'
import { calculateGestationalAge, calculateGestationalAgeFromDueDate, getCurrentTimestamp } from '@/utils/gestational'

/** 实时更新间隔：每60秒修正一次（保证跨天时自动更新）。 */
const REALTIME_INTERVAL = 60 * 1000

export function useGestationalAge() {
  const store = usePregnancyStore()
  const ticker = ref(getCurrentTimestamp())
  let timer: ReturnType<typeof setInterval> | null = null

  /** 启动实时计时器。 */
  function startRealtimeTicker() {
    if (timer) return
    timer = setInterval(() => {
      ticker.value = getCurrentTimestamp()
    }, REALTIME_INTERVAL)
  }

  /** 停止实时计时器。 */
  function stopRealtimeTicker() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onMounted(() => startRealtimeTicker())
  onUnmounted(() => stopRealtimeTicker())

  /**
   * 核心计算：优先使用预产期实时计算，其次 LMP，最后用 store 缓存。
   * ticker 作为响应式依赖，确保定时触发重新计算。
   */
  const age = computed(() => {
    // 触发响应式更新
    void ticker.value

    const pregnancy = store.currentPregnancy
    if (!pregnancy) return store.gestationalAge || null

    // 优先：有预产期时，直接从预产期实时计算（核心修正逻辑）
    if (pregnancy.due_date) {
      return calculateGestationalAgeFromDueDate(pregnancy.due_date)
    }

    // 其次：从 LMP 计算
    if (pregnancy.last_period_date) {
      return calculateGestationalAge(pregnancy.last_period_date)
    }

    // 兜底：store 缓存
    return store.gestationalAge || null
  })

  const displayText = computed(() => {
    if (!age.value) return '未设置'
    const a = age.value
    if (a.isPrePregnancy) return `距末次月经约 ${Math.abs(a.totalDays)} 天`
    if (a.isOverdue) return `已过预产期 ${Math.abs(a.daysUntilDue)} 天`
    return `孕 ${a.weeks} 周 ${a.days} 天`
  })

  const countdownText = computed(() => {
    if (!age.value) return ''
    const s = age.value.daysUntilDue
    if (s < 0) return `已过预产期 ${Math.abs(s)} 天`
    return `距离预产期还有 ${s} 天`
  })

  const trimesterText = computed(() => age.value?.trimester || '')

  const stageKey = computed(() => age.value?.stageKey || 'unknown')

  /** 距离预产期天数（实时）。 */
  const daysUntilDue = computed(() => age.value?.daysUntilDue ?? 0)

  /** 预产日期。 */
  const dueDate = computed(() => store.currentPregnancy?.due_date || null)

  return {
    age,
    displayText,
    countdownText,
    trimesterText,
    stageKey,
    daysUntilDue,
    dueDate,
    startRealtimeTicker,
    stopRealtimeTicker,
  }
}
