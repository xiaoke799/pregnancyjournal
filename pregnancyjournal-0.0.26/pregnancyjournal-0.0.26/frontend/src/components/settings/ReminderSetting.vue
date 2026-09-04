<template>
  <div class="reminder-setting">
    <h3>提醒设置</h3>
    <div class="reminder-list">
      <div v-for="r in reminders" :key="r.id" class="reminder-row">
        <div class="reminder-info">
          <span class="reminder-title">{{ r.title }}</span>
          <span class="reminder-date">{{ r.trigger_date }} {{ r.trigger_time || '' }}</span>
        </div>
        <n-switch :value="!!r.is_enabled" @update:value="toggleReminder(r)" />
      </div>
      <div v-if="reminders.length === 0" class="empty-hint">暂无提醒</div>
    </div>
    <div class="add-reminder">
      <n-button size="small" @click="showAdd = true">+ 添加提醒</n-button>
    </div>
    <n-modal v-model:show="showAdd" preset="card" title="添加提醒" style="max-width: 360px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标题">
          <n-input v-model:value="form.title" placeholder="提醒标题" />
        </n-form-item>
        <n-form-item label="类型">
          <n-select v-model:value="form.reminder_type" :options="reminderTypes" />
        </n-form-item>
        <n-form-item label="日期">
          <n-input v-model:value="form.trigger_date" type="text" placeholder="YYYY-MM-DD" />
        </n-form-item>
        <n-form-item label="提前天数">
          <n-input-number v-model:value="form.advance_days" :min="0" :max="30" style="width: 100%" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button type="primary" @click="addReminder">添加</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NButton, NSwitch, NModal, NForm, NFormItem, NInput, NInputNumber, NSelect } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { reminderApi } from '@/api/reminder'

const pregnancyStore = usePregnancyStore()
const reminders = ref<any[]>([])
const showAdd = ref(false)

const form = ref({
  title: '',
  reminder_type: 'other' as string,
  trigger_date: '',
  advance_days: 1,
})

const reminderTypes = [
  { label: '产检提醒', value: 'checkup' },
  { label: '用药提醒', value: 'medication' },
  { label: '营养补充', value: 'supplement' },
  { label: '运动提醒', value: 'exercise' },
  { label: '其他', value: 'other' },
]

async function loadReminders() {
  if (!pregnancyStore.currentPregnancy) return
  const res: any = await reminderApi.list(pregnancyStore.currentPregnancy.id)
  if (res.code === 0) reminders.value = res.data || []
}

async function toggleReminder(r: any) {
  const newEnabled = r.is_enabled ? 0 : 1
  await reminderApi.update(r.id, { is_enabled: newEnabled })
  r.is_enabled = newEnabled
}

async function addReminder() {
  if (!pregnancyStore.currentPregnancy || !form.value.title || !form.value.trigger_date) return
  await reminderApi.create({
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    ...form.value,
  })
  showAdd.value = false
  form.value = { title: '', reminder_type: 'other', trigger_date: '', advance_days: 1 }
  await loadReminders()
}

onMounted(() => { if (pregnancyStore.isActive) loadReminders() })
</script>

<style scoped>
.reminder-setting {
  background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.reminder-setting h3 { margin-bottom: 12px; color: var(--accent-color); }
.reminder-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-color); }
.reminder-info { display: flex; flex-direction: column; gap: 2px; }
.reminder-title { font-weight: 500; }
.reminder-date { font-size: 12px; color: var(--text-hint); }
.empty-hint { text-align: center; padding: 20px; color: var(--text-hint); }
.add-reminder { margin-top: 12px; }
</style>
