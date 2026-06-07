<template>
  <div class="stats-view" :class="{ 'is-mobile': isMobile }">
    <!-- 顶部：时间段切换 -->
    <div class="stats-header">
      <h2 class="stats-title">📊 数据统计</h2>
      <div class="period-tabs">
        <button
          v-for="p in periodOptions" :key="p.value"
          class="period-tab" :class="{ active: currentPeriod === p.value }"
          @click="switchPeriod(p.value)"
        >{{ p.label }}</button>
      </div>
      <div class="period-info">{{ periodLabel }}</div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && records.length === 0" class="loading-state">
      <span class="loading-spinner"></span> 加载中...
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && records.length === 0" class="empty-state">
      <span class="empty-icon">📈</span>
      <span class="empty-text">暂无数据，先去记录一些吧</span>
    </div>

    <!-- 图表区域 -->
    <div v-if="records.length > 0" class="charts-section">

      <!-- 体重 -->
      <MetricCard v-if="hasData('weight')" title="⚖️ 体重变化" unit="kg" :color="'#a78bfa'"
        :dates="chartDates" :values="chartValues('weight')" :table-data="tableData('weight', 'weight')" />

      <!-- 血压 -->
      <MetricCard v-if="hasData('bp')" title="🩺 血压变化" unit="mmHg" :color="'#ef4444'"
        :dates="chartDates"
        :values="chartValues('bp_systolic')"
        :values2="chartValues('bp_diastolic')"
        :legend="['收缩压', '舒张压']"
        :table-data="tableData('bp', 'blood_pressure_systolic', { sub: 'blood_pressure_diastolic', format: (r: any) => `${r.blood_pressure_systolic || '--'}/${r.blood_pressure_diastolic || '--'}` })" />

      <!-- 血糖 -->
      <MetricCard v-if="hasData('glucose')" title="🩸 血糖变化" unit="mmol/L" :color="'#f59e0b'"
        :dates="chartDates"
        :values="chartValues('glucose_fasting')"
        :values2="chartValues('glucose_1h')"
        :values3="chartValues('glucose_2h')"
        :legend="['空腹', '餐后1h', '餐后2h']"
        :table-data="tableData('glucose', 'blood_glucose_fasting', {
          cols: [
            { key: 'blood_glucose_fasting', label: '空腹' },
            { key: 'blood_glucose_1h', label: '餐后1h' },
            { key: 'blood_glucose_2h', label: '餐后2h' },
          ]
        })" />

      <!-- HCG -->
      <MetricCard v-if="hasData('hcg')" title="🧬 HCG 变化" unit="mIU/mL" :color="'#ec4899'"
        :dates="chartDates" :values="chartValues('hcg_value')"
        :table-data="tableData('hcg', 'hcg_value', { extra: 'hcg_weeks', extraLabel: '孕周' })" />

      <!-- 尿酸 -->
      <MetricCard v-if="hasData('uric_acid')" title="🧪 尿酸变化" unit="μmol/L" :color="'#06b6d4'"
        :dates="chartDates" :values="chartValues('uric_acid')"
        :table-data="tableData('uric_acid', 'uric_acid', { extra: 'uric_acid_period', extraLabel: '时段' })" />

      <!-- 体温 -->
      <MetricCard v-if="hasData('temp')" title="🌡️ 体温变化" unit="°C" :color="'#f97316'"
        :dates="chartDates" :values="chartValues('body_temperature')"
        :table-data="tableData('temp', 'body_temperature')" />

      <!-- 睡眠 -->
      <MetricCard v-if="hasData('sleep')" title="😴 睡眠时长" unit="小时" :color="'#8b5cf6'"
        :dates="chartDates" :values="chartValues('sleep_hours')"
        :table-data="tableData('sleep', 'sleep_hours', { extra: 'sleep_quality', extraLabel: '质量' })" />

      <!-- 饮水 -->
      <MetricCard v-if="hasData('water')" title="💧 饮水量" unit="ml" :color="'#3b82f6'"
        :dates="chartDates" :values="chartValues('water_intake')"
        :table-data="tableData('water', 'water_intake')" />

      <!-- 胎动 -->
      <MetricCard v-if="hasData('fm')" title="🦶 胎动次数" unit="次" :color="'#10b981'"
        :dates="chartDates" :values="chartValues('fetal_movement_count')"
        :table-data="tableData('fm', 'fetal_movement_count', { extra: 'fetal_movement_duration', extraLabel: '用时(分)' })" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import { useResize } from '@/composables/useResize'
import dayjs from 'dayjs'
import MetricCard from './StatsView/MetricCard.vue'

const pregnancyStore = usePregnancyStore()
const { isMobile } = useResize()

const loading = ref(false)
const records = ref<any[]>([])
const currentPeriod = ref<'month'|'pregnancy'>('month')

const periodOptions = [
  { value: 'month' as const, label: '本月' },
  { value: 'pregnancy' as const, label: '孕期全部' },
]

const periodLabel = computed(() => {
  if (currentPeriod.value === 'month') return dayjs().format('YYYY年MM月')
  if (pregnancyStore.currentPregnancy?.last_menstrual_date) {
    return `从 ${dayjs(pregnancyStore.currentPregnancy.last_menstrual_date).format('YYYY-MM')} 至今`
  }
  return '孕期全部记录'
})

// ====== 数据加载 ======
async function loadData() {
  if (!pregnancyStore.currentPregnancy?.id) return
  loading.value = true
  try {
    let start = ''
    let end = ''
    if (currentPeriod.value === 'month') {
      start = dayjs().startOf('month').format('YYYY-MM-DD')
      end = dayjs().endOf('month').format('YYYY-MM-DD')
    }
    console.log('[Stats] loadData:', { period: currentPeriod.value, start, end })
    const res: any = await dailyRecordApi.list(
      pregnancyStore.currentPregnancy.id,
      { start_date: start || undefined, end_date: end || undefined, page_size: 365 }
    )
    if (res.code === 0) {
      const data = res.data
      records.value = Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : [])
      // 按日期排序
      records.value.sort((a: any, b: any) =>
        (a.record_date || '').localeCompare(b.record_date || '')
      )
      console.log('[Stats] loaded', records.value.length, 'records')
    }
  } catch (e) {
    console.error('[Stats] load error:', e)
  } finally {
    loading.value = false
  }
}

function switchPeriod(p: 'month'|'pregnancy') {
  if (currentPeriod.value === p) return
  currentPeriod.value = p
  loadData()
}

// ====== 图表数据提取 ======
const chartDates = computed(() =>
  records.value.map((r: any) => dayjs(r.record_date).format('MM/DD'))
)

function chartValues(field: string): (number | null)[] {
  return records.value.map((r: any) => {
    const v = r[field]
    if (v == null || v === '') return null
    const n = Number(v)
    return isNaN(n) ? null : n
  })
}

function hasData(metric: string): boolean {
  switch (metric) {
    case 'weight': return records.value.some((r: any) => r.weight != null)
    case 'bp': return records.value.some((r: any) => r.blood_pressure_systolic != null || r.blood_pressure_diastolic != null)
    case 'glucose': return records.value.some((r: any) => r.blood_glucose_fasting != null || r.blood_glucose_1h != null || r.blood_glucose_2h != null)
    case 'hcg': return records.value.some((r: any) => r.hcg_value != null)
    case 'uric_acid': return records.value.some((r: any) => r.uric_acid != null)
    case 'temp': return records.value.some((r: any) => r.body_temperature != null)
    case 'sleep': return records.value.some((r: any) => r.sleep_hours != null)
    case 'water': return records.value.some((r: any) => r.water_intake != null)
    case 'fm': return records.value.some((r: any) => r.fetal_movement_count != null)
    default: return false
  }
}

interface TableCol {
  date: string
  value: string | number
  extra?: string
  note?: string
}

function tableData(
  metric: string,
  mainField: string,
  opts?: { sub?: string; format?: (r: any) => string; cols?: Array<{key:string;label:string}>; extra?: string; extraLabel?: string }
): TableCol[] {
  return records.value
    .filter((r: any) => {
      if (opts?.cols) return opts.cols.some(c => r[c.key] != null)
      if (opts?.format) return true
      return r[mainField] != null
    })
    .map((r: any) => ({
      date: dayjs(r.record_date).format('MM-DD'),
      value: opts?.format ? opts.format(r) : (r[mainField] ?? '--'),
      extra: opts?.extra ? (r[opts.extra] ?? '') : undefined,
      note: r.note || undefined,
    }))
}

onMounted(() => loadData())
watch(() => [pregnancyStore.currentPregnancy?.id, currentPeriod.value], () => {
  if (pregnancyStore.currentPregnancy?.id) loadData()
}, { immediate: true })
</script>

<style scoped>
.stats-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 16px;
  min-height: 100%;
}

/* 头部 */
.stats-header {
  background: white;
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.stats-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 12px;
  color: #1e293b;
}
.period-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.period-tab {
  padding: 7px 20px;
  border: 1.5px solid #e2e8f0;
  border-radius: 20px;
  background: white;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all .2s;
}
.period-tab:hover { border-color: #c44680; color: #c44680; }
.period-tab.active {
  background: linear-gradient(135deg, #e879a0, #c44680);
  color: white;
  border-color: transparent;
}
.period-info {
  font-size: 12px;
  color: #94a3b8;
}

/* 图表区域 */
.charts-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 状态 */
.loading-state, .empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #94a3b8;
  font-size: 15px;
}
.empty-icon { font-size: 48px; display: block; margin-bottom: 10px; opacity: .4; }
.loading-spinner {
  display: inline-block;
  width: 24px; height: 24px;
  border: 3px solid #e2e8f0;
  border-top-color: #c44680;
  border-radius: 50%;
  animation: spin .6s linear infinite;
  vertical-align: middle;
  margin-right: 8px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 移动端 */
@media (max-width: 768px) {
  .stats-view { padding: 10px; }
  .stats-header { padding: 12px 14px; border-radius: 12px; }
  .stats-title { font-size: 16px; }
  .period-tab { padding: 6px 16px; font-size: 13px; }
}
</style>
