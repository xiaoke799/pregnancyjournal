<template>
  <n-drawer v-model:show="visible" :width="380" placement="right">
    <n-drawer-content :title="drawerTitle">
      <!-- 宝宝天数 & 倒计时 -->
      <div class="drawer-meta">
        <div class="meta-item" v-if="babyDays !== null">
          <span class="meta-label">👶 宝宝第</span>
          <span class="meta-value">{{ babyDays }} 天</span>
        </div>
        <div class="meta-item" v-if="daysUntilDue !== null">
          <span class="meta-label">📅 距预产期</span>
          <span class="meta-value">还有 {{ daysUntilDue }} 天</span>
        </div>
      </div>

      <!-- 当日记录 -->
      <div v-if="records.length > 0" class="drawer-records">
        <div v-for="group in groupedRecords" :key="group.type" class="record-group">
          <div class="group-header">
            <span class="group-icon">{{ group.icon }}</span>
            <span class="group-name">{{ group.label }}</span>
          </div>
          <div class="group-items">
            <div v-for="(item, idx) in group.items" :key="idx" class="record-line">
              <span class="record-time">{{ item.time }}</span>
              <span class="record-value">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="drawer-empty">
        <div class="empty-icon">📝</div>
        <p>当日没有记录</p>
        <p class="empty-hint">点击下方按钮添加第一条记录</p>
      </div>

      <template #footer>
        <n-button type="primary" block @click="$emit('add')">
          添加记录
        </n-button>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NDrawer, NDrawerContent, NButton } from 'naive-ui'
import dayjs from 'dayjs'

const props = defineProps<{
  show: boolean
  date: string
  records: any[]
  pregnancy: any
}>()

const emit = defineEmits<{
  'update:show': [val: boolean]
  'add': []
}>()

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val),
})

const drawerTitle = computed(() => {
  return dayjs(props.date).format('M月D日') + ' 详情'
})

/** 宝宝天数（从末次月经计算） */
const babyDays = computed(() => {
  if (!props.pregnancy?.last_period_date) return null
  const lmp = dayjs(props.pregnancy.last_period_date)
  const dateObj = dayjs(props.date)
  const diff = dateObj.diff(lmp, 'day')
  return diff > 0 ? diff : null
})

/** 距预产期天数 */
const daysUntilDue = computed(() => {
  if (!props.pregnancy?.due_date) return null
  const due = dayjs(props.pregnancy.due_date)
  const dateObj = dayjs(props.date)
  const diff = due.diff(dateObj, 'day')
  return diff > 0 ? diff : null
})

/** 记录类型定义 */
interface RecordGroup {
  type: string
  icon: string
  label: string
  items: Array<{ time: string; value: string }>
}

/** 将记录按类型分组展示 */
const groupedRecords = computed<RecordGroup[]>(() => {
  if (!props.records || props.records.length === 0) return []

  const groups: RecordGroup[] = []
  const r = props.records[0] // DailyRecord 是按日期一天一条

  if (r.weight) {
    groups.push({ type: 'weight', icon: '⚖️', label: '体重', items: [{ time: '', value: r.weight + ' kg' }] })
  }
  if (r.blood_pressure_systolic || r.blood_pressure_diastolic) {
    groups.push({
      type: 'blood_pressure', icon: '🩺', label: '血压',
      items: [{ time: '', value: (r.blood_pressure_systolic || '--') + '/' + (r.blood_pressure_diastolic || '--') + ' mmHg' }],
    })
  }
  if (r.blood_glucose_fasting || r.blood_glucose_1h || r.blood_glucose_2h) {
    const items = []
    if (r.blood_glucose_fasting) items.push({ time: '空腹', value: r.blood_glucose_fasting + ' mmol/L' })
    if (r.blood_glucose_1h) items.push({ time: '餐后1h', value: r.blood_glucose_1h + ' mmol/L' })
    if (r.blood_glucose_2h) items.push({ time: '餐后2h', value: r.blood_glucose_2h + ' mmol/L' })
    groups.push({ type: 'blood_glucose', icon: '🩸', label: '血糖', items })
  }
  if (r.fetal_heart_rate) {
    groups.push({ type: 'fetal_heart_rate', icon: '❤️', label: '胎心', items: [{ time: '', value: r.fetal_heart_rate + ' bpm' }] })
  }
  if (r.body_temperature) {
    groups.push({ type: 'body_temperature', icon: '🌡️', label: '体温', items: [{ time: '', value: r.body_temperature + ' °C' }] })
  }
  if (r.symptoms) {
    try {
      const symptoms = JSON.parse(r.symptoms)
      if (Array.isArray(symptoms) && symptoms.length > 0) {
        groups.push({ type: 'symptoms', icon: '📋', label: '症状', items: [{ time: '', value: symptoms.join('、') }] })
      }
    } catch { /* ignore */ }
  }
  if (r.sleep_hours || r.sleep_quality) {
    const val = (r.sleep_hours ? r.sleep_hours + 'h' : '') + (r.sleep_quality ? ' (' + qualityLabel(r.sleep_quality) + ')' : '')
    groups.push({ type: 'sleep', icon: '😴', label: '睡眠', items: [{ time: '', value: val || '--' }] })
  }
  if (r.exercise_type || r.exercise_duration) {
    const val = (r.exercise_type || '运动') + (r.exercise_duration ? ' ' + r.exercise_duration + '分钟' : '')
    groups.push({ type: 'exercise', icon: '🏃', label: '运动', items: [{ time: '', value: val }] })
  }
  if (r.diet_note) {
    groups.push({ type: 'diet', icon: '🍎', label: '饮食', items: [{ time: '', value: r.diet_note }] })
  }
  if (r.medication) {
    try {
      const meds = JSON.parse(r.medication)
      if (Array.isArray(meds) && meds.length > 0) {
        const val = meds.map((m: any) => m.name + (m.dosage ? ' ' + m.dosage : '')).join('、')
        groups.push({ type: 'medication', icon: '💊', label: '用药', items: [{ time: '', value: val }] })
      }
    } catch { /* ignore */ }
  }
  if (r.mood) {
    const moodIcons = ['', '😢', '😔', '😐', '😊', '😄']
    groups.push({ type: 'mood', icon: moodIcons[r.mood] || '😊', label: '心情', items: [{ time: '', value: r.mood_note || '' }] })
  }
  if (r.note) {
    groups.push({ type: 'note', icon: '📝', label: '日记', items: [{ time: '', value: r.note }] })
  }

  return groups
})

function qualityLabel(quality: string): string {
  const map: Record<string, string> = { good: '好', fair: '一般', poor: '差' }
  return map[quality] || quality
}
</script>

<style scoped>
.drawer-meta {
  display: flex;
  gap: 20px;
  padding: 12px 16px;
  background: var(--stage-early-bg, #FFF3E0);
  border-radius: var(--radius-lg, 12px);
  margin-bottom: 16px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-label {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
}

.meta-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--stage-early-color, #FFB74D);
}

.drawer-records {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.record-group {
  background: var(--bg-color, #f8fafc);
  border-radius: var(--radius-md, 8px);
  padding: 12px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.group-icon {
  font-size: 18px;
}

.group-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.group-items {
  padding-left: 26px;
}

.record-line {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.record-time {
  color: var(--text-hint, #94a3b8);
}

.record-value {
  color: var(--text-color, #1e293b);
  font-weight: 500;
}

.drawer-empty {
  text-align: center;
  padding: 40px 20px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.drawer-empty p {
  color: var(--text-secondary, #64748b);
  margin-bottom: 4px;
}

.empty-hint {
  font-size: 13px;
  color: var(--text-hint, #94a3b8);
}
</style>
