<template>
  <div class="month-calendar">
    <div class="calendar-header">
      <button class="nav-btn" @click="$emit('prev')">◀</button>
      <span class="month-title">{{ monthTitle }}</span>
      <button class="nav-btn" @click="$emit('next')">▶</button>
    </div>
    <div class="weekday-row">
      <span v-for="d in weekdays" :key="d" class="weekday">{{ d }}</span>
    </div>
    <div class="days-grid">
      <div
        v-for="(day, i) in calendarDays"
        :key="i"
        class="day-cell"
        :class="{
          today: day.isToday,
          otherMonth: !day.isCurrentMonth,
          hasCheckup: day.hasCheckup,
          hasRecord: day.hasRecord,
          selected: day.date === selectedDate,
        }"
        @click="$emit('selectDate', day.date)"
      >
        <span class="day-number">{{ day.day }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'

const props = defineProps<{
  currentMonth: string
  selectedDate?: string
  checkupDates?: string[]
  recordDates?: string[]
}>()

defineEmits<{
  prev: []
  next: []
  selectDate: [date: string]
}>()

const weekdays = ['日', '一', '二', '三', '四', '五', '六']

const monthTitle = computed(() => dayjs(props.currentMonth).format('YYYY年MM月'))

const calendarDays = computed(() => {
  const current = dayjs(props.currentMonth)
  const start = current.startOf('month')
  const startDay = start.day()
  const daysInMonth = current.daysInMonth()
  const today = dayjs().format('YYYY-MM-DD')
  const checkupSet = new Set(props.checkupDates || [])
  const recordSet = new Set(props.recordDates || [])

  const days: Array<{
    day: number
    date: string
    isCurrentMonth: boolean
    isToday: boolean
    hasCheckup: boolean
    hasRecord: boolean
  }> = []

  for (let i = startDay - 1; i >= 0; i--) {
    const d = start.subtract(i + 1, 'day')
    days.push({ day: d.date(), date: d.format('YYYY-MM-DD'), isCurrentMonth: false, isToday: false, hasCheckup: false, hasRecord: false })
  }

  for (let i = 1; i <= daysInMonth; i++) {
    const d = current.date(i)
    const dateStr = d.format('YYYY-MM-DD')
    days.push({
      day: i, date: dateStr, isCurrentMonth: true, isToday: dateStr === today,
      hasCheckup: checkupSet.has(dateStr), hasRecord: recordSet.has(dateStr),
    })
  }

  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    const d = current.add(1, 'month').date(i)
    days.push({ day: i, date: d.format('YYYY-MM-DD'), isCurrentMonth: false, isToday: false, hasCheckup: false, hasRecord: false })
  }
  return days
})
</script>

<style scoped>
.calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.nav-btn { background: none; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 4px 12px; cursor: pointer; }
.nav-btn:hover { border-color: var(--primary-color); }
.month-title { font-size: 18px; font-weight: 600; }
.weekday-row { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; margin-bottom: 8px; }
.weekday { font-size: 12px; color: var(--text-hint); padding: 4px 0; }
.days-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.day-cell { text-align: center; padding: 8px 4px; border-radius: var(--radius-sm); position: relative; cursor: pointer; transition: background-color 0.2s, color 0.2s, opacity 0.2s; }
.day-cell:hover { background: rgba(232,160,191,0.1); }
.day-cell.today { background: var(--primary-color); color: white; border-radius: var(--radius-md); }
.day-cell.otherMonth { opacity: 0.3; }
.day-cell.selected { outline: 2px solid var(--primary-color); }
.day-cell.hasCheckup::after { content: ''; position: absolute; bottom: 2px; left: calc(50% - 5px); width: 6px; height: 6px; background: #FF4D4F; border-radius: 50%; }
.day-cell.hasRecord::before { content: ''; position: absolute; bottom: 2px; left: calc(50% + 1px); width: 6px; height: 6px; background: #52C41A; border-radius: 50%; }
.day-number { font-size: 14px; }
</style>
