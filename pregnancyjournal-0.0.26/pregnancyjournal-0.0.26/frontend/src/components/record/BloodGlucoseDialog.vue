<template>
  <n-modal v-model:show="visible" preset="card" title="记录血糖" style="max-width: 400px">
    <div class="glucose-form">
      <div class="glucose-type">
        <div
          v-for="t in glucoseTypes"
          :key="t.key"
          class="type-chip"
          :class="{ active: glucoseType === t.key }"
          @click="glucoseType = t.key"
        >
          {{ t.label }}
        </div>
      </div>
      <n-input-number
        v-model:value="glucose"
        :min="1"
        :max="30"
        :step="0.1"
        :precision="1"
        placeholder="请输入血糖值"
        style="width: 100%"
        size="large"
      >
        <template #suffix>mmol/L</template>
      </n-input-number>
      <div class="glucose-hint" v-if="glucose">
        <span :class="glucoseStatus">{{ glucoseStatusText }}</span>
      </div>
    </div>
    <template #action>
      <n-button type="primary" :disabled="!glucose || !glucoseType" @click="handleSave">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NInputNumber } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const pregnancyStore = usePregnancyStore()
const glucoseType = ref<'fasting' | 'post_meal_1h' | 'post_meal_2h'>('fasting')
const glucose = ref<number | null>(null)

const glucoseTypes = [
  { key: 'fasting' as const, label: '空腹' },
  { key: 'post_meal_1h' as const, label: '餐后1h' },
  { key: 'post_meal_2h' as const, label: '餐后2h' },
]

const glucoseStatus = computed(() => {
  if (!glucose.value) return ''
  const thresholds: Record<string, [number, number]> = {
    fasting: [3.9, 5.1],
    post_meal_1h: [3.9, 7.8],
    post_meal_2h: [3.9, 6.7],
  }
  const [low, high] = thresholds[glucoseType.value]
  if (glucose.value < low) return 'low'
  if (glucose.value > high) return 'high'
  return 'normal'
})

const glucoseStatusText = computed(() => {
  const map: Record<string, string> = { low: '偏低', normal: '正常范围', high: '偏高' }
  return glucoseStatus.value ? map[glucoseStatus.value] : ''
})

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => {
  if (val) { glucose.value = null; glucoseType.value = 'fasting' }
})

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !glucose.value || !glucoseType.value) return
  const fieldMap: Record<string, string> = {
    fasting: 'blood_glucose_fasting',
    post_meal_1h: 'blood_glucose_post_meal_1h',
    post_meal_2h: 'blood_glucose_post_meal_2h',
  }
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    [fieldMap[glucoseType.value]]: glucose.value,
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.glucose-type { display: flex; gap: 8px; margin-bottom: 12px; }
.type-chip {
  padding: 6px 16px; border-radius: 20px; font-size: 13px;
  background: var(--bg-color); border: 1px solid var(--border-color);
  cursor: pointer; transition: all 0.2s;
}
.type-chip.active { background: rgba(232,160,191,0.15); border-color: var(--primary-color); color: var(--primary-color); }
.glucose-hint { margin-top: 8px; font-size: 13px; }
.glucose-hint .low { color: #1890FF; }
.glucose-hint .normal { color: #52C41A; }
.glucose-hint .high { color: #FF4D4F; }
</style>
