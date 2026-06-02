<template>
  <MonthCalendar
    :current-month="currentMonth"
    :selected-date="selectedDate"
    :checkup-dates="checkupDates"
    :record-dates="recordDates"
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

const emit = defineEmits<{
  select: [date: string]
}>()

const pregnancyStore = usePregnancyStore()
const currentMonth = ref(dayjs().format('YYYY-MM-DD'))
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const scheduleItems = ref<any[]>([])
const customDates = ref<string[]>([])
const recordDates = ref<string[]>([])

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
}

function prevMonth() {
  currentMonth.value = dayjs(currentMonth.value).subtract(1, 'month').format('YYYY-MM-DD')
}

function nextMonth() {
  currentMonth.value = dayjs(currentMonth.value).add(1, 'month').format('YYYY-MM-DD')
}

function onSelect(date: string) {
  selectedDate.value = date
  emit('select', date)
}

onMounted(loadDates)
watch(() => pregnancyStore.currentPregnancy?.id, loadDates)
</script>
