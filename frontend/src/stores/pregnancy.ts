/** 孕程记 - 孕期状态 Store（支持实时修正）。 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { pregnancyApi } from '@/api/pregnancy'
import { calculateGestationalAge, calculateGestationalAgeFromDueDate, type GestationalAge } from '@/utils/gestational'

export const usePregnancyStore = defineStore('pregnancy', () => {
  const currentPregnancy = ref<any>(null)
  /** 后端缓存的孕周数据（API 返回值，非实时） */
  const gestationalAge = ref<GestationalAge | null>(null)
  const loading = ref(false)

  const isActive = computed(() => !!currentPregnancy.value)

  /**
   * 实时孕周计算：基于当前时间 + 预产期/LMP 实时计算。
   * 与 gestationalAge（API 缓存）不同，此值每秒都在变化。
   */
  const realtimeGestationalAge = computed(() => {
    const p = currentPregnancy.value
    if (!p) return null
    // 优先从预产期实时计算
    if (p.due_date) {
      return calculateGestationalAgeFromDueDate(p.due_date)
    }
    // 其次从 LMP 计算
    if (p.last_period_date) {
      return calculateGestationalAge(p.last_period_date)
    }
    return null
  })

  async function fetchActivePregnancy() {
    loading.value = true
    try {
      const res: any = await pregnancyApi.getActive()
      if (res.code === 0 && res.data) {
        currentPregnancy.value = res.data
        await fetchGestationalAge()
      } else {
        currentPregnancy.value = null
        gestationalAge.value = null
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchGestationalAge() {
    try {
      const res: any = await pregnancyApi.getGestationalAge()
      if (res.code === 0 && res.data) {
        // 后端返回 snake_case，统一转 camelCase
        gestationalAge.value = {
          weeks: res.data.weeks,
          days: res.data.days,
          totalDays: res.data.total_days || 0,
          daysUntilDue: res.data.days_until_due,
          trimester: res.data.trimester,
          stageKey: 'unknown' as const,
          isOverdue: (res.data.days_until_due ?? 0) < 0,
          isPrePregnancy: (res.data.total_days ?? 0) < 0,
        }
      }
    } catch {
      // fallback 前端计算
      if (currentPregnancy.value?.last_period_date) {
        const lmp = dayjs(currentPregnancy.value.last_period_date)
        const age = calculateGestationalAge(lmp)
        gestationalAge.value = age
      }
    }
  }

  async function activatePregnancy(id: string) {
    await pregnancyApi.activate(id)
    await fetchActivePregnancy()
  }

  function clearState() {
    currentPregnancy.value = null
    gestationalAge.value = null
  }

  return {
    currentPregnancy,
    /** @deprecated 建议使用 composables/useGestationalAge 中的实时版本 */
    gestationalAge,
    /** 实时计算的孕周数据（响应式，基于当前时间） */
    realtimeGestationalAge,
    loading,
    isActive,
    fetchActivePregnancy,
    fetchGestationalAge,
    activatePregnancy,
    clearState,
  }
})
