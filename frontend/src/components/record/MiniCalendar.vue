<template>
  <MonthCalendar
    :current-month="currentMonth"
    :selected-date="selectedDate"
    :checkup-dates="checkupDates"
    :record-dates="recordDates"
    :stage-dates="stageDates"
    @prev="prevMonth"
    @next="nextMonth"
    @select-date="onSelect"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import MonthCalendar from '@/components/calendar/MonthCalendar.vue'
import { usePregnancyStore } from '@/stores/pregnancy'
import { getCheckupSchedule } from '@/api/checkup-schedule'
import { checkupApi } from '@/api/checkup'
import { dailyRecordApi } from '@/api/daily-record'
import { calculateGestationalAge } from '@/utils/gestational'

/** 根据预产期和目标日期计算该日期所处的孕期阶段 */
function getStageForDate(targetDate: dayjs.Dayjs, lmp: string, dueDate: string | null | undefined): string {
  // 如果有预产期，优先用预产期倒推
  if (dueDate) {
    const due = dayjs(dueDate)
    const totalDays = targetDate.diff(due.subtract(280, 'day'), 'day')
    const weeks = Math.floor(totalDays / 7)
    // 标记预产日
    if (targetDate.format('YYYY-MM-DD') === due.format('YYYY-MM-DD')) return '预产期'
    if (totalDays < 0) return ''
    if (weeks < 13) return '孕早期'
    if (weeks < 28) return '孕中期'
    if (weeks <= 42) return '孕晚期'
    return ''
  }
  // fallback：使用 LMP
  const daysDiff = targetDate.diff(dayjs(lmp), 'day')
  const weeks = Math.floor(daysDiff / 7)
  if (daysDiff < 0) return ''
  if (weeks < 13) return '孕早期'
  if (weeks < 28) return '孕中期'
  if (weeks <= 42) return '孕晚期'
  return ''
}

const emit = defineEmits<{
  select: [date: string]
}>()

const pregnancyStore = usePregnancyStore()
const currentMonth = ref(dayjs().format('YYYY-MM-DD'))
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const scheduleItems = ref<any[]>([])
const customDates = ref<string[]>([])
const recordDates = ref<string[]>([])
const stageDates = ref<Array<{ date: string; stage: string }>>([])

const checkupDates = computed(() => {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  if (!lmp) return customDates.value
  const dates: string[] = []
  for (const item of scheduleItems.value) {
    const est = dayjs(lmp).add(item.week_start, 'week')
    dates.push(est.format('YYYY-MM-DD'))
  }
  return [...new Set([...dates, ...customDates.value])]
})

async function loadDates() {
  const pid = pregnancyStore.currentPregnancy?.id
  if (!pid) return
  const [schedRes, customRes, recordRes] = await Promise.allSettled([
    getCheckupSchedule(pid),
    checkupApi.listCustom(pid),
    dailyRecordApi.list(pid, { page: 1, page_size: 365 }),
  ])
  if (schedRes.status === 'fulfilled') {
    scheduleItems.value = (schedRes.value as any)?.data || []
  }
  if (customRes.status === 'fulfilled') {
    const list = (customRes.value as any)?.data || []
    customDates.value = list.filter((c: any) => c.checkup_date).map((c: any) => c.checkup_date)
  }
  if (recordRes.status === 'fulfilled') {
    const data = (recordRes.value as any)?.data
    const list = data?.list || data || []
    recordDates.value = Array.isArray(list) ? list.map((r: any) => r.record_date).filter(Boolean) : []
  }
  calculateStageDates()
}

function calculateStageDates() {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  const dueDate = pregnancyStore.currentPregnancy?.due_date || pregnancyStore.currentPregnancy?.dueDate || null
  if (!lmp && !dueDate) {
    stageDates.value = []
    return
  }
  // 计算可见月份范围（当前月 ±1 个月用于填充前后月份）
  const monthStart = dayjs(currentMonth.value).startOf('month').subtract(1, 'month')
  const monthEnd = dayjs(currentMonth.value).endOf('month').add(1, 'month')

  const dates: Array<{ date: string; stage: string }> = []
  let current = monthStart
  while (current.isBefore(monthEnd)) {
    const stage = getStageForDate(current, lmp!, dueDate)
    if (stage) {
      dates.push({ date: current.format('YYYY-MM-DD'), stage })
    }
    current = current.add(1, 'day')
  }
  stageDates.value = dates
}

function prevMonth() {
  currentMonth.value = dayjs(currentMonth.value).subtract(1, 'month').format('YYYY-MM-DD')
  calculateStageDates()
}

function nextMonth() {
  currentMonth.value = dayjs(currentMonth.value).add(1, 'month').format('YYYY-MM-DD')
  calculateStageDates()
}

function onSelect(date: string) {
  selectedDate.value = date
  emit('select', date)
}

onMounted(loadDates)
watch(() => pregnancyStore.currentPregnancy?.id, loadDates)
</script>
