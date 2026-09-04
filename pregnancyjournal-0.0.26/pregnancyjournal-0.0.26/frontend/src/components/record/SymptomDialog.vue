<template>
  <n-modal v-model:show="visible" preset="card" title="记录症状" style="max-width: 400px">
    <div class="symptom-form">
      <div class="symptom-grid">
        <div
          v-for="s in symptomOptions"
          :key="s.name"
          class="symptom-chip"
          :class="{ active: selected.has(s.name) }"
          @click="toggleSymptom(s.name)"
        >
          {{ s.emoji }} {{ s.name }}
        </div>
      </div>
      <n-input v-model:value="note" type="textarea" placeholder="其他症状备注..." :rows="2" style="margin-top: 12px" />
    </div>
    <template #action>
      <n-button type="primary" @click="handleSave">保存</n-button>
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
const selected = ref<Set<string>>(new Set())
const note = ref('')

const symptomOptions = [
  { name: '恶心呕吐', emoji: '🤢' },
  { name: '头晕', emoji: '😵' },
  { name: '腰酸背痛', emoji: '💢' },
  { name: '水肿', emoji: '🦶' },
  { name: '失眠', emoji: '😰' },
  { name: '胃灼热', emoji: '🔥' },
  { name: '尿频', emoji: '🚻' },
  { name: '便秘', emoji: '😓' },
  { name: '乏力', emoji: '😴' },
  { name: '气短', emoji: '😮‍💨' },
  { name: '抽筋', emoji: '⚡' },
  { name: '皮肤瘙痒', emoji: '🤔' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => {
  if (val) { selected.value = new Set(); note.value = '' }
})

function toggleSymptom(name: string) {
  if (selected.value.has(name)) {
    selected.value.delete(name)
  } else {
    selected.value.add(name)
  }
}

async function handleSave() {
  if (!pregnancyStore.currentPregnancy) return
  const symptomText = Array.from(selected.value).join('、')
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    note: symptomText + (note.value ? `\n${note.value}` : ''),
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.symptom-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.symptom-chip {
  padding: 6px 12px; border-radius: 20px; font-size: 13px;
  background: var(--bg-color); border: 1px solid var(--border-color);
  cursor: pointer; transition: all 0.2s; user-select: none;
}
.symptom-chip:hover { border-color: var(--primary-color); }
.symptom-chip.active { background: rgba(232,160,191,0.15); border-color: var(--primary-color); color: var(--primary-color); }
</style>
