<template>
  <div class="due-date-setting">
    <h3>预产期设置</h3>
    <div class="setting-row">
      <label>末次月经日期</label>
      <n-input v-model:value="lmpDate" type="text" placeholder="YYYY-MM-DD" style="width: 200px" />
    </div>
    <div class="setting-row" v-if="calculatedDueDate">
      <label>计算预产期</label>
      <span class="due-date">{{ calculatedDueDate }}</span>
    </div>
    <div class="setting-row" v-if="pregnancyStore.currentPregnancy">
      <label>当前预产期</label>
      <span class="current-due">{{ pregnancyStore.currentPregnancy.due_date }}</span>
    </div>
    <div class="setting-actions">
      <n-button type="primary" size="small" :disabled="!lmpDate" @click="handleSave">
        {{ pregnancyStore.currentPregnancy ? '更新' : '创建' }}
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NInput, NButton } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { pregnancyApi } from '@/api/pregnancy'
import dayjs from 'dayjs'

const pregnancyStore = usePregnancyStore()
const lmpDate = ref('')

const calculatedDueDate = computed(() => {
  if (!lmpDate.value) return ''
  return dayjs(lmpDate.value).add(280, 'day').format('YYYY-MM-DD')
})

async function handleSave() {
  if (!lmpDate.value) return
  if (pregnancyStore.currentPregnancy) {
    await pregnancyApi.update(pregnancyStore.currentPregnancy.id, {
      last_period_date: lmpDate.value,
    })
  } else {
    await pregnancyApi.create({ last_period_date: lmpDate.value })
  }
  await pregnancyStore.fetchActivePregnancy()
  lmpDate.value = ''
}
</script>

<style scoped>
.due-date-setting {
  background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.due-date-setting h3 { margin-bottom: 16px; color: var(--accent-color); }
.setting-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color); }
.setting-row label { min-width: 120px; color: var(--text-secondary); font-size: 14px; }
.due-date { font-weight: 600; color: var(--primary-color); }
.current-due { font-weight: 600; }
.setting-actions { margin-top: 16px; text-align: right; }
</style>
