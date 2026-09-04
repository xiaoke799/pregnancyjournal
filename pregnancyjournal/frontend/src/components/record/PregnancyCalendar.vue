<template>
  <div class="pregnancy-calendar">
    <!-- 月份导航 -->
    <div class="calendar-nav">
      <button class="nav-btn" @click="prevMonth">‹</button>
      <span class="month-label">{{ currentMonthLabel }}</span>
      <button class="nav-btn" @click="nextMonth">›</button>
    </div>

    <!-- 星期标题 -->
    <div class="weekday-header">
      <span v-for="d in weekdays" :key="d" class="weekday-cell">{{ d }}</span>
    </div>

    <!-- 日期网格 -->
    <div class="calendar-grid">
      <div
        v-for="(cell, idx) in calendarCells"
        :key="idx"
        class="date-cell"
        :class="{
          'other-month': !cell.inMonth,
          'is-today': cell.isToday,
          'has-record': cell.hasRecord,
          'has-checkup': cell.hasCheckup,
          'is-due-date': isDueDate(cell.date),
        }"
        @click="cell.inMonth && $emit('select-date', cell.date)"
      >
        <span
          class="date-text"
          :style="{ color: getDateColor(cell) }"
        >
          {{ cell.day }}
        </span>
        <!-- 产检日小圆点 -->
        <span v-if="cell.hasCheckup" class="checkup-dot" :style="{ background: 'var(--stage-late-color)' }"></span>
        <!-- 有记录小标记 -->
        <span v-if="cell.hasRecord" class="record-dot" :style="{ background: getRecordDotColor(cell.date) }"></span>
        <!-- 今天圆圈 -->
        <span v-if="cell.isToday" class="today-ring" :style="{ borderColor: getDateColor(cell) }"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const props = defineProps<{
  pregnancy: any
  checkupDates: string[]
  recordDates: string[]
  recordTypes?: Record<string, string>
}>()

const emit = defineEmits<{
  'select-date': [date: string]
  'month-change': [month: string]
}>()

const recordTypeColors: Record<string, string> = {
  weight: '#a78bfa',
  supplement: '#06b6d4',
  hcg: '#8b5cf6',
  progesterone: '#ec4899',
  blood_glucose: '#f59e0b',
  habit: '#6366f1',
  stool: '#a3e635',
  symptoms: '#34d399',
  mood: '#f87171',
  note: '#f59e0b',
  fetal_heart_rate: '#f472b6',
  photo: '#f43f5e',
  intimacy: '#f43f5e',
  temperature: '#ef4444',
  plan: '#14b8a6',
  blood_pressure: '#f97316',
  sleep: '#818cf8',
  exercise: '#22d3ee',
  diet: '#84cc16',
  medication: '#a855f7',
  water: '#38bdf8',
  contraction: '#e11d48',
  fetal_movement: '#d946ef',
}

function getRecordDotColor(date: string): string {
  if (!props.recordTypes) return 'var(--stage-mid-color)'
  const type = props.recordTypes[date]
  return (type && recordTypeColors[type]) || 'var(--stage-mid-color)'
}

const currentMonth = ref<Dayjs>(dayjs())

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

const currentMonthLabel = computed(() => {
  return currentMonth.value.format('YYYY年 M月')
})

/** 获取日期对应孕周的阶段颜色（优先使用预产期） */
function getDateColor(cell: CalendarCell): string {
  const p = props.pregnancy
  if (!p) return ''
  const dueDate = p.due_date || p.dueDate || null
  const lmp = p.last_period_date

  // 有预产期时优先用预产期倒推 LMP
  if (dueDate) {
    const due = dayjs(dueDate)
    const dateObj = dayjs(cell.date)
    // 预产日特殊高亮
    if (dateObj.format('YYYY-MM-DD') === due.format('YYYY-MM-DD')) {
      return 'var(--primary-color)'
    }
    const totalDays = dateObj.diff(due.subtract(280, 'day'), 'day')
    if (totalDays < 0) return 'var(--stage-preparing-color)'
    const weeks = Math.floor(totalDays / 7)
    if (weeks < 13) return 'var(--stage-early-color)'
    if (weeks < 28) return 'var(--stage-mid-color)'
    return 'var(--stage-late-color)'
  }

  // fallback：使用 LMP
  if (!lmp) return ''
  const lmpDayjs = dayjs(lmp)
  const dateObj = dayjs(cell.date)
  const totalDays = dateObj.diff(lmpDayjs, 'day')
  if (totalDays < 0) return 'var(--stage-preparing-color)'
  const weeks = Math.floor(totalDays / 7)
  if (weeks < 13) return 'var(--stage-early-color)'
  if (weeks < 28) return 'var(--stage-mid-color)'
  return 'var(--stage-late-color)'
}

/** 判断是否为预产日 */
function isDueDate(date: string): boolean {
  const p = props.pregnancy
  if (!p) return false
  const dueDate = p.due_date || p.dueDate || null
  if (!dueDate) return false
  return date === dayjs(dueDate).format('YYYY-MM-DD')
}

interface CalendarCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  hasRecord: boolean
  hasCheckup: boolean
}

/** 生成日历格子 */
const calendarCells = computed<CalendarCell[]>(() => {
  const startOfMonth = currentMonth.value.startOf('month')
  const endOfMonth = currentMonth.value.endOf('month')

  // 月初是周几（调整为周一=0）
  let startDayOfWeek = startOfMonth.day() - 1
  if (startDayOfWeek < 0) startDayOfWeek = 6

  const cells: CalendarCell[] = []
  const today = dayjs().format('YYYY-MM-DD')

  // 填充月初空白
  for (let i = 0; i < startDayOfWeek; i++) {
    const date = startOfMonth.subtract(startDayOfWeek - i, 'day')
    cells.push({
      date: date.format('YYYY-MM-DD'),
      day: date.date(),
      inMonth: false,
      isToday: date.format('YYYY-MM-DD') === today,
      hasRecord: props.recordDates.includes(date.format('YYYY-MM-DD')),
      hasCheckup: props.checkupDates.includes(date.format('YYYY-MM-DD')),
    })
  }

  // 填充当月日期
  for (let i = 1; i <= endOfMonth.date(); i++) {
    const date = currentMonth.value.date(i)
    const dateStr = date.format('YYYY-MM-DD')
    cells.push({
      date: dateStr,
      day: i,
      inMonth: true,
      isToday: dateStr === today,
      hasRecord: props.recordDates.includes(dateStr),
      hasCheckup: props.checkupDates.includes(dateStr),
    })
  }

  // 填充月末空白（确保 6 行）
  const remaining = 42 - cells.length
  for (let i = 1; i <= remaining; i++) {
    const date = endOfMonth.add(i, 'day')
    cells.push({
      date: date.format('YYYY-MM-DD'),
      day: date.date(),
      inMonth: false,
      isToday: date.format('YYYY-MM-DD') === today,
      hasRecord: props.recordDates.includes(date.format('YYYY-MM-DD')),
      hasCheckup: props.checkupDates.includes(date.format('YYYY-MM-DD')),
    })
  }

  return cells
})

function prevMonth() {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
  emit('month-change', currentMonth.value.format('YYYY-MM'))
}

function nextMonth() {
  currentMonth.value = currentMonth.value.add(1, 'month')
  emit('month-change', currentMonth.value.format('YYYY-MM'))
}
</script>

<style scoped>
.pregnancy-calendar {
  background: white;
  border-radius: var(--radius-lg, 12px);
  padding: 16px;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
}

.calendar-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 0 8px;
}

.nav-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 50%;
  background: white;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #64748b);
  transition: background-color 0.2s;
}

.nav-btn:hover {
  background: var(--border-color, #f1f5f9);
}

.month-label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.weekday-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 8px;
}

.weekday-cell {
  text-align: center;
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
  padding: 4px 0;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.date-cell {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: var(--radius-sm, 6px);
  transition: background 0.15s;
}

.date-cell:hover:not(.other-month) {
  background: rgba(0, 0, 0, 0.04);
}

.date-cell.other-month {
  cursor: default;
}

.date-cell.other-month .date-text {
  color: var(--text-hint, #c4c9d4) !important;
}

/* 预产日特殊高亮 */
.date-cell.is-due-date {
  background: linear-gradient(135deg, #E8A0BF, #F06292);
  border-radius: var(--radius-sm, 6px);
}
.date-cell.is-due-date .date-text {
  color: white !important;
  font-weight: 700;
}

.date-text {
  font-size: 14px;
  font-weight: 500;
  position: relative;
  z-index: 1;
}

/* 今天圆圈 */
.today-ring {
  position: absolute;
  inset: 2px;
  border: 2px solid;
  border-radius: 50%;
  pointer-events: none;
}

/* 产检日小圆点 */
.checkup-dot {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* 有记录小标记 */
.record-dot {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--stage-mid-color, #4FC3F7);
}

/* 响应式 */
@media (max-width: 768px) {
  .pregnancy-calendar {
    padding: 12px;
  }

  .date-text {
    font-size: 13px;
  }
}
</style>
