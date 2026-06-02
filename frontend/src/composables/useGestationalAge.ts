/** 孕程记 - 孕周计算 Hook。 */

import { computed } from 'vue'
import { usePregnancyStore } from '@/stores/pregnancy'
import { calculateGestationalAge } from '@/utils/gestational'

export function useGestationalAge() {
  const store = usePregnancyStore()

  const age = computed(() => {
    if (store.gestationalAge) {
      return store.gestationalAge
    }
    if (store.currentPregnancy?.last_period_date) {
      return calculateGestationalAge(store.currentPregnancy.last_period_date)
    }
    return null
  })

  const displayText = computed(() => {
    if (!age.value) return '未设置'
    return `孕 ${age.value.weeks} 周 ${age.value.days} 天`
  })

  const countdownText = computed(() => {
    if (!age.value) return ''
    return `距预产期还有 ${age.value.daysUntilDue} 天`
  })

  const trimesterText = computed(() => age.value?.trimester || '')

  return { age, displayText, countdownText, trimesterText }
}
