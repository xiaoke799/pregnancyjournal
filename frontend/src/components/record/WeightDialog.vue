<template>
  <n-modal v-model:show="visible" preset="card" title="记录体重" style="max-width: 360px">
    <div class="weight-form">
      <div class="weight-input-area">
        <n-input-number
          v-model:value="weight"
          :min="30"
          :max="200"
          :step="0.1"
          :precision="1"
          placeholder="请输入体重"
          style="width: 100%"
          size="large"
        >
          <template #suffix>kg</template>
        </n-input-number>
      </div>
      <div v-if="lastWeight" class="last-weight">
        上次记录：{{ lastWeight }} kg
        <span v-if="diff !== null" class="diff" :class="{ up: diff > 0, down: diff < 0 }">
          {{ diff > 0 ? '+' : '' }}{{ diff.toFixed(1) }} kg
        </span>
      </div>
    </div>
    <template #action>
      <n-button type="primary" :disabled="!weight" @click="handleSave">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NInputNumber } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'

const props = defineProps<{
  show: boolean
  lastWeight?: number | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const pregnancyStore = usePregnancyStore()
const weight = ref<number | null>(null)

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

const diff = computed(() => {
  if (weight.value && props.lastWeight) {
    return weight.value - props.lastWeight
  }
  return null
})

watch(() => props.show, (val) => {
  if (val) weight.value = null
})

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !weight.value) return
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    weight: weight.value,
  })
  visible.value = false
  weight.value = null
  emit('saved')
}
</script>

<style scoped>
.weight-form { text-align: center; }
.weight-input-area { margin-bottom: 12px; }
.last-weight { font-size: 13px; color: var(--text-secondary); }
.diff { margin-left: 8px; font-weight: 600; }
.diff.up { color: #FF4D4F; }
.diff.down { color: #52C41A; }
</style>
