<template>
  <n-modal v-model:show="visible" preset="card" title="好习惯打卡" style="max-width: 400px">
    <div class="habit-form">
      <div class="habit-list">
        <div
          v-for="h in habits"
          :key="h.name"
          class="habit-item"
          :class="{ checked: selected.has(h.name) }"
          @click="toggleHabit(h.name)"
        >
          <span class="habit-check">{{ selected.has(h.name) ? '✅' : '⬜' }}</span>
          <span class="habit-emoji">{{ h.emoji }}</span>
          <span class="habit-name">{{ h.name }}</span>
        </div>
      </div>
    </div>
    <template #action>
      <n-button type="primary" @click="handleSave">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const pregnancyStore = usePregnancyStore()
const selected = ref<Set<string>>(new Set())

const habits = [
  { name: '按时产检', emoji: '🏥' },
  { name: '适度运动', emoji: '🏃' },
  { name: '充足饮水', emoji: '💧' },
  { name: '均衡饮食', emoji: '🥗' },
  { name: '充足睡眠', emoji: '😴' },
  { name: '心情愉快', emoji: '😊' },
  { name: '胎教互动', emoji: '🎵' },
  { name: '避免久坐', emoji: '🚶' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => { if (val) selected.value = new Set() })

function toggleHabit(name: string) {
  if (selected.value.has(name)) {
    selected.value.delete(name)
  } else {
    selected.value.add(name)
  }
}

async function handleSave() {
  if (!pregnancyStore.currentPregnancy) return
  const text = Array.from(selected.value).join('、')
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    note: `✅ ${text}`,
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.habit-list { display: flex; flex-direction: column; gap: 4px; }
.habit-item {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;
}
.habit-item:hover { background: rgba(232,160,191,0.05); }
.habit-item.checked { background: rgba(82,196,26,0.05); }
.habit-check { font-size: 16px; }
.habit-emoji { font-size: 16px; }
.habit-name { font-size: 14px; }
</style>
