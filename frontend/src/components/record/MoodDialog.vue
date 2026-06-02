<template>
  <n-modal v-model:show="visible" preset="card" title="记录心情" style="max-width: 360px">
    <div class="mood-form">
      <div class="mood-selector">
        <div
          v-for="m in moods"
          :key="m.value"
          class="mood-item"
          :class="{ active: mood === m.value }"
          @click="mood = m.value"
        >
          <span class="mood-emoji">{{ m.emoji }}</span>
          <span class="mood-label">{{ m.label }}</span>
        </div>
      </div>
      <n-input v-model:value="moodNote" type="textarea" placeholder="今天的心情..." :rows="3" />
    </div>
    <template #action>
      <n-button type="primary" :disabled="!mood" @click="handleSave">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NInput } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const pregnancyStore = usePregnancyStore()
const mood = ref<number | null>(null)
const moodNote = ref('')

const moods = [
  { value: 5, emoji: '😄', label: '很开心' },
  { value: 4, emoji: '😊', label: '开心' },
  { value: 3, emoji: '😐', label: '一般' },
  { value: 2, emoji: '😔', label: '低落' },
  { value: 1, emoji: '😢', label: '很难过' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => {
  if (val) { mood.value = null; moodNote.value = '' }
})

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !mood.value) return
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    mood: mood.value,
    mood_note: moodNote.value,
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.mood-form { text-align: center; }
.mood-selector { display: flex; justify-content: center; gap: 12px; margin-bottom: 16px; }
.mood-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 12px; border-radius: var(--radius-md); cursor: pointer;
  transition: all 0.2s; border: 2px solid transparent;
}
.mood-item:hover { background: rgba(232,160,191,0.1); }
.mood-item.active { border-color: var(--primary-color); background: rgba(232,160,191,0.15); }
.mood-emoji { font-size: 32px; }
.mood-label { font-size: 12px; color: var(--text-secondary); }
</style>
