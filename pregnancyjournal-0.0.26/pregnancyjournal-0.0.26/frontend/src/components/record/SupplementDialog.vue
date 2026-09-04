<template>
  <n-modal v-model:show="visible" preset="card" title="营养补充" style="max-width: 400px">
    <div class="supplement-form">
      <div class="supplement-grid">
        <div
          v-for="s in supplements"
          :key="s.name"
          class="supplement-chip"
          :class="{ active: selected.has(s.name) }"
          @click="toggleSupplement(s.name)"
        >
          {{ s.emoji }} {{ s.name }}
        </div>
      </div>
      <n-input v-model:value="customNote" placeholder="其他补充..." style="margin-top: 12px" />
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
const customNote = ref('')

const supplements = [
  { name: '叶酸', emoji: '💊' },
  { name: '铁剂', emoji: '🔴' },
  { name: '钙片', emoji: '🦴' },
  { name: 'DHA', emoji: '🐟' },
  { name: '维生素D', emoji: '☀️' },
  { name: '复合维生素', emoji: '🌈' },
  { name: '益生菌', emoji: '🦠' },
  { name: '蛋白粉', emoji: '💪' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => {
  if (val) { selected.value = new Set(); customNote.value = '' }
})

function toggleSupplement(name: string) {
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
    note: text + (customNote.value ? `\n${customNote.value}` : ''),
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.supplement-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.supplement-chip {
  padding: 6px 12px; border-radius: 20px; font-size: 13px;
  background: var(--bg-color); border: 1px solid var(--border-color);
  cursor: pointer; transition: all 0.2s; user-select: none;
}
.supplement-chip:hover { border-color: var(--primary-color); }
.supplement-chip.active { background: rgba(232,160,191,0.15); border-color: var(--primary-color); color: var(--primary-color); }
</style>
