/** 孕程记 - 孕期状态 Store。 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { pregnancyApi } from '@/api/pregnancy'
import { calculateGestationalAge } from '@/utils/gestational'

export const usePregnancyStore = defineStore('pregnancy', () => {
  const currentPregnancy = ref<any>(null)
  const gestationalAge = ref<{ weeks: number; days: number; totalDays: number; daysUntilDue: number; trimester: string } | null>(null)
  const loading = ref(false)

  const isActive = computed(() => !!currentPregnancy.value)

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
    gestationalAge,
    loading,
    isActive,
    fetchActivePregnancy,
    fetchGestationalAge,
    activatePregnancy,
    clearState,
  }
})
