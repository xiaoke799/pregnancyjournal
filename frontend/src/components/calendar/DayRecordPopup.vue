<template>
  <n-modal v-model:show="visible" preset="card" :title="popupTitle" style="max-width: 400px">
    <div class="day-popup">
      <div v-if="record" class="record-section">
        <h4>当日记录</h4>
        <div class="record-item" v-if="record.weight">体重：{{ record.weight }} kg</div>
        <div class="record-item" v-if="record.fetal_heart_rate">胎心率：{{ record.fetal_heart_rate }} 次/分</div>
        <div class="record-item" v-if="record.body_temperature">体温：{{ record.body_temperature }}°C</div>
        <div class="record-item" v-if="record.mood">心情：{{ moodEmojis[record.mood] || '' }}</div>
        <div class="record-item" v-if="record.note">备注：{{ record.note }}</div>
        <div v-if="!hasRecord" class="empty-record">当日无记录</div>
      </div>
      <div v-if="(checkups || []).length > 0" class="checkup-section">
        <h4>产检记录</h4>
        <div v-for="c in checkups" :key="c.id" class="checkup-brief">
          <span>{{ c.checkup_type }}</span>
          <span :class="c.is_completed ? 'completed' : 'pending'">
            {{ c.is_completed ? '已完成' : '待检查' }}
          </span>
        </div>
      </div>
    </div>
    <template #action>
      <n-button type="primary" @click="goToRecord">添加记录</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { useRouter } from 'vue-router'

const props = defineProps<{
  show: boolean
  date: string
  record?: any
  checkups?: any[]
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const router = useRouter()

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

const popupTitle = computed(() => `${props.date} 详情`)

const hasRecord = computed(() => {
  return props.record && (props.record.weight || props.record.fetal_heart_rate || props.record.body_temperature || props.record.mood || props.record.note)
})

const moodEmojis: Record<number, string> = { 1: '😢', 2: '😔', 3: '😐', 4: '😊', 5: '😄' }

function goToRecord() {
  visible.value = false
  router.push({ path: '/record' })
}
</script>

<style scoped>
.record-section, .checkup-section { margin-bottom: 16px; }
.record-section h4, .checkup-section h4 { margin-bottom: 8px; color: var(--text-color); font-size: 14px; }
.record-item { padding: 4px 0; font-size: 14px; color: var(--text-secondary); }
.empty-record { color: var(--text-hint); font-size: 13px; }
.checkup-brief { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
.completed { color: #52C41A; }
.pending { color: #FAAD14; }
</style>
