<template>
  <n-modal v-model:show="visible" preset="card" title="记录胎心率" style="max-width: 360px">
    <div class="fhr-form">
      <n-input-number
        v-model:value="fhr"
        :min="60"
        :max="200"
        :step="1"
        placeholder="请输入胎心率"
        style="width: 100%"
        size="large"
      >
        <template #suffix>次/分</template>
      </n-input-number>
      <div class="fhr-hint" v-if="fhr">
        <span :class="fhrStatus">{{ fhrStatusText }}</span>
      </div>
      <div class="fhr-range">正常范围：110 ~ 160 次/分</div>
    </div>
    <template #action>
      <n-button type="primary" :disabled="!fhr" @click="handleSave">保存</n-button>
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
const fhr = ref<number | null>(null)

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

const fhrStatus = computed(() => {
  if (!fhr.value) return ''
  if (fhr.value < 110) return 'low'
  if (fhr.value > 160) return 'high'
  return 'normal'
})

const fhrStatusText = computed(() => {
  if (!fhr.value) return ''
  if (fhr.value < 110) return '胎心率偏低，请咨询医生'
  if (fhr.value > 160) return '胎心率偏高，请咨询医生'
  return '胎心率正常'
})

watch(() => props.show, (val) => { if (val) fhr.value = null })

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !fhr.value) return
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    fetal_heart_rate: fhr.value,
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.fhr-form { text-align: center; }
.fhr-hint { margin-top: 8px; font-size: 13px; }
.fhr-hint .low { color: #1890FF; }
.fhr-hint .normal { color: #52C41A; }
.fhr-hint .high { color: #FF4D4F; }
.fhr-range { margin-top: 8px; font-size: 12px; color: var(--text-hint); }
</style>
