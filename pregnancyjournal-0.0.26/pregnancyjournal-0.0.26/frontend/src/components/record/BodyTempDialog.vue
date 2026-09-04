<template>
  <n-modal v-model:show="visible" preset="card" title="记录体温" style="max-width: 360px">
    <div class="temp-form">
      <n-input-number
        v-model:value="temp"
        :min="35"
        :max="42"
        :step="0.1"
        :precision="1"
        placeholder="请输入体温"
        style="width: 100%"
        size="large"
      >
        <template #suffix>°C</template>
      </n-input-number>
      <div class="temp-hint">
        <span :class="tempStatus">{{ tempStatusText }}</span>
      </div>
    </div>
    <template #action>
      <n-button type="primary" :disabled="!temp" @click="handleSave">保存</n-button>
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
const temp = ref<number | null>(null)

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

const tempStatus = computed(() => {
  if (!temp.value) return ''
  if (temp.value < 36.0) return 'low'
  if (temp.value > 37.3) return 'high'
  return 'normal'
})

const tempStatusText = computed(() => {
  if (!temp.value) return ''
  if (temp.value < 36.0) return '体温偏低'
  if (temp.value > 37.3) return '体温偏高，请注意观察'
  return '体温正常'
})

watch(() => props.show, (val) => { if (val) temp.value = null })

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !temp.value) return
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    body_temperature: temp.value,
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.temp-form { text-align: center; }
.temp-hint { margin-top: 8px; font-size: 13px; }
.temp-hint .low { color: #1890FF; }
.temp-hint .normal { color: #52C41A; }
.temp-hint .high { color: #FF4D4F; }
</style>
