<template>
  <n-modal v-model:show="visible" preset="card" title="记录便便" style="max-width: 360px">
    <div class="stool-form">
      <div class="bristol-scale">
        <div
          v-for="b in bristolTypes"
          :key="b.type"
          class="bristol-item"
          :class="{ active: selected === b.type }"
          @click="selected = b.type"
        >
          <span class="bristol-emoji">{{ b.emoji }}</span>
          <span class="bristol-label">Type {{ b.type }}</span>
          <span class="bristol-desc">{{ b.desc }}</span>
        </div>
      </div>
    </div>
    <template #action>
      <n-button type="primary" :disabled="!selected" @click="handleSave">保存</n-button>
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
const selected = ref<number | null>(null)

const bristolTypes = [
  { type: 1, emoji: '⚫', desc: '硬块状，便秘' },
  { type: 2, emoji: '⚫', desc: '腊肠状，偏硬' },
  { type: 3, emoji: '🟤', desc: '腊肠状，有裂纹' },
  { type: 4, emoji: '🟤', desc: '光滑柔软，正常' },
  { type: 5, emoji: '🟫', desc: '软块状，偏软' },
  { type: 6, emoji: '🟫', desc: '糊状，腹泻' },
  { type: 7, emoji: '💧', desc: '水样，严重腹泻' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => { if (val) selected.value = null })

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !selected.value) return
  await dailyRecordApi.upsert({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    record_date: dayjs().format('YYYY-MM-DD'),
    stool: selected.value,
  })
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.bristol-scale { display: flex; flex-direction: column; gap: 8px; }
.bristol-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;
  border: 2px solid transparent;
}
.bristol-item:hover { background: rgba(232,160,191,0.05); }
.bristol-item.active { border-color: var(--primary-color); background: rgba(232,160,191,0.1); }
.bristol-emoji { font-size: 16px; }
.bristol-label { font-weight: 600; font-size: 13px; min-width: 60px; }
.bristol-desc { font-size: 12px; color: var(--text-secondary); }
</style>
