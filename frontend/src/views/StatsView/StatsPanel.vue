<template>
  <div class="stats-panel" :class="{ 'stats-panel--page': size === 'page' }">
    <div class="stats-header">
      <component :is="titleTag" class="stats-title">{{ title }}</component>
      <div class="period-tabs">
        <button
          v-for="p in periodOptions" :key="p.value"
          class="period-tab" :class="{ active: period === p.value }"
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
      <span class="empty-text">
        {{ period !== 'all' && allRecords.length > 0 ? '该时段暂无记录，可切换到「孕期全部」' : '暂无数据，先去记录一些吧' }}
      </span>
    </div>

    <!-- 图表区域 -->
    <div v-if="records.length > 0" class="charts-section">
      <!-- 体重（多一格「孕期增重」：从孕期第一条记录算起，与所选时段无关） -->
      <MetricCard v-if="hasData('weight')" title="体重变化" unit="kg" color="#a78bfa"
        :dates="chartDates" :values="chartValues('weight')" :extra-stats="weightExtraStats"
        :table-data="tableData('weight', 'weight')" />

      <!-- 血压 -->
      <MetricCard v-if="hasData('bp')" title="血压变化" unit="mmHg" color="#ef4444"
        :dates="chartDates"
        :values="chartValues('blood_pressure_systolic')"
        :values2="chartValues('blood_pressure_diastolic')"
        :legend="['收缩压', '舒张压']"
        :table-data="tableData('bp', 'blood_pressure_systolic', { format: (r: any) => `${r.blood_pressure_systolic || '--'}/${r.blood_pressure_diastolic || '--'}` })" />

      <!-- 血糖 -->
      <MetricCard v-if="hasData('glucose')" title="血糖变化" unit="mmol/L" color="#f59e0b"
        :dates="chartDates"
        :values="chartValues('blood_glucose_fasting')"
        :values2="chartValues('blood_glucose_1h')"
        :values3="chartValues('blood_glucose_2h')"
        :legend="['空腹', '餐后1h', '餐后2h']"
        :table-data="tableData('glucose', 'blood_glucose_fasting', {
          cols: [
            { key: 'blood_glucose_fasting', label: '空腹' },
            { key: 'blood_glucose_1h', label: '餐后1h' },
            { key: 'blood_glucose_2h', label: '餐后2h' },
          ]
        })" />

      <!-- HCG -->
      <MetricCard v-if="hasData('hcg')" title="HCG变化" unit="mIU/mL" color="#ec4899"
        :dates="chartDates" :values="chartValues('hcg_value')"
        :table-data="tableData('hcg', 'hcg_value', { extra: 'hcg_weeks', extraLabel: '孕周' })" />

      <!-- 尿酸 -->
      <MetricCard v-if="hasData('uric_acid')" title="尿酸变化" unit="μmol/L" color="#06b6d4"
        :dates="chartDates" :values="chartValues('uric_acid')"
        :table-data="tableData('uric_acid', 'uric_acid', { extra: 'uric_acid_period', extraLabel: '时段' })" />

      <!-- 体温 -->
      <MetricCard v-if="hasData('temp')" title="体温变化" unit="°C" color="#f97316"
        :dates="chartDates" :values="chartValues('body_temperature')"
        :table-data="tableData('temp', 'body_temperature')" />

      <!-- 三围：胸围 / 腰围 / 臀围 三条曲线同图对比（此前是三张独立卡片，看不出相互走势） -->
      <MetricCard v-if="hasData('girth')" title="三围变化" unit="cm" color="#0d9488"
        :dates="chartDates"
        :values="chartValues('bust')"
        :values2="chartValues('waist')"
        :values3="chartValues('hip')"
        :legend="['胸围', '腰围', '臀围']"
        :table-data="tableData('girth', 'bust', {
          cols: [
            { key: 'bust', label: '胸围' },
            { key: 'waist', label: '腰围' },
            { key: 'hip', label: '臀围' },
          ],
          format: girthText,
        })" />

      <!-- 睡眠 -->
      <MetricCard v-if="hasData('sleep')" title="睡眠时长" unit="小时" color="#8b5cf6"
        :dates="chartDates" :values="chartValues('sleep_hours')"
        :table-data="tableData('sleep', 'sleep_hours', { extra: 'sleep_quality', extraLabel: '质量' })" />

      <!-- 饮水 -->
      <MetricCard v-if="hasData('water')" title="饮水量" unit="ml" color="#3b82f6"
        :dates="chartDates" :values="chartValues('water_intake')"
        :table-data="tableData('water', 'water_intake')" />

      <!-- 胎心率（记录页有录入入口，此前统计里一直缺这一项） -->
      <MetricCard v-if="hasData('fhr')" title="胎心率" unit="bpm" color="#f472b6"
        :dates="chartDates" :values="chartValues('fetal_heart_rate')"
        :table-data="tableData('fhr', 'fetal_heart_rate')" />

      <!-- 胎动 -->
      <MetricCard v-if="hasData('fm')" title="胎动次数" unit="次" color="#10b981"
        :dates="chartDates" :values="chartValues('fetal_movement_count')"
        :table-data="tableData('fm', 'fetal_movement_count', { extra: 'fetal_movement_duration', extraLabel: '用时(分)' })" />

      <!-- 宫缩：主曲线用「持续时间(秒)」；间隔与疼痛放在表格里（单位不同，不共用一条 Y 轴） -->
      <MetricCard v-if="hasData('contraction')" title="宫缩持续时间" unit="秒" color="#dc2626"
        :dates="chartDates" :values="chartValues('contraction_duration')"
        :table-data="tableData('contraction', 'contraction_duration', { extra: 'contraction_interval', extraLabel: '间隔(分)', noteField: 'contraction_pain' })" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'
import MetricCard from './MetricCard.vue'

/**
 * 记录页「统计」标签 与 独立「统计」页 共用的面板。
 * ⚠️ 这里曾经是两份复制粘贴的代码（同 12 张卡各自写死），改一边必漏另一边；
 *    统一收进本组件后，两处天然一致，新增指标只改这里。
 */
const props = defineProps({
  /** 面板标题（记录页内嵌时可用更小的措辞） */
  title: { type: String, default: '数据统计' },
  /** 版式：compact = 嵌在记录页里的紧凑版；page = 独立「统计」页的大号版 */
  size: { type: String, default: 'compact' },
})

/** 独立页用 h2、内嵌用 h3（视觉相同，语义与页面层级一致） */
const titleTag = computed(() => (props.size === 'page' ? 'h2' : 'h3'))

const pregnancyStore = usePregnancyStore()

/**
 * 时段档位。
 * ⚠️ 档位直接决定「取哪一段数据」（本地过滤），**不是**靠图表内部缩放去遮住其余数据。
 *    老实现只有「本月 / 孕期全部」两档，且「孕期全部」是把 200+ 个点丢给图表、
 *    由 echarts 的 dataZoom 默认只显示末尾约 20 个点 —— 后果是血糖这种每 45 天才测一次的
 *    指标整张图**空白**（6 条数据全在视窗外），看起来像"数据丢了"。
 */
type Period = '7d' | '30d' | '90d' | 'all'
const PERIODS: Array<{ value: Period; label: string; days: number | null; short: string }> = [
  { value: '7d', label: '近7天', days: 7, short: '最近 7 天' },
  { value: '30d', label: '近30天', days: 30, short: '最近 30 天' },
  { value: '90d', label: '近90天', days: 90, short: '最近 90 天' },
  { value: 'all', label: '孕期全部', days: null, short: '孕期全部' },
]

const loading = ref(false)
/** 该孕期的全部记录（一次取回，切时段在本地过滤 —— 顺带让「孕期增重」的基准稳定） */
const allRecords = ref<any[]>([])
const period = ref<Period>('30d')
const periodOptions = PERIODS

/** 按所选时段过滤（近 N 天 = 含今天在内往前数 N 天，按字符串比较 YYYY-MM-DD） */
const records = computed(() => {
  const p = PERIODS.find((x) => x.value === period.value)
  if (!p || p.days == null) return allRecords.value
  const start = dayjs().subtract(p.days - 1, 'day').format('YYYY-MM-DD')
  return allRecords.value.filter((r: any) => String(r.record_date || '') >= start)
})

const periodLabel = computed(() => {
  const rows = records.value
  const head = period.value === 'all'
    ? (pregnancyStore.currentPregnancy?.last_period_date
        ? `从 ${dayjs(pregnancyStore.currentPregnancy.last_period_date).format('YYYY-MM')} 至今`
        : '孕期全部记录')
    : (PERIODS.find((p) => p.value === period.value)?.short || '')
  if (!rows.length) return `${head} · 暂无记录`
  const a = dayjs(rows[0].record_date).format('MM/DD')
  const b = dayjs(rows[rows.length - 1].record_date).format('MM/DD')
  return `${head} · 有记录 ${rows.length} 天（${a} ~ ${b}）`
})

// ====== 数据加载 ======
/**
 * 确保孕期档案已就绪。
 * ⚠️ 这里是「直链/刷新进来」的关键：pinia 里的 currentPregnancy 只在别的页面
 *    （首页、产检页等）调过 fetchActivePregnancy 后才有值。老的两份统计代码都没这一步，
 *    于是直接打开 #/stats 或在那页按 F5，会一直显示"暂无数据"（数据其实都在）。
 *    产检页早就是这么做的（CheckupScheduleView 里先 fetch 再取 id），这里补齐。
 */
async function ensurePregnancyId(): Promise<string | undefined> {
  if (pregnancyStore.currentPregnancy?.id) return pregnancyStore.currentPregnancy.id
  try {
    await pregnancyStore.fetchActivePregnancy()
  } catch (e) {
    console.error('[Stats] fetchActivePregnancy error:', e)
  }
  return pregnancyStore.currentPregnancy?.id
}

async function loadData() {
  const pid = await ensurePregnancyId()
  if (!pid) return
  loading.value = true
  try {
    // 不传日期区间：一次取回该孕期全部记录，时段切换不再重复请求
    const res: any = await dailyRecordApi.list(pid, { page_size: 1000 })
    if (res.code === 0) {
      const data = res.data
      const list = Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : [])
      list.sort((a: any, b: any) => (a.record_date || '').localeCompare(b.record_date || ''))
      allRecords.value = list
    }
  } catch (e) {
    console.error('[Stats] load error:', e)
  } finally {
    loading.value = false
  }
}

function switchPeriod(p: Period) {
  if (period.value === p) return
  period.value = p
}

onMounted(() => loadData())
watch(() => pregnancyStore.currentPregnancy?.id, (id) => { if (id) loadData() }, { immediate: true })

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
  const any = (fn: (r: any) => boolean) => records.value.some(fn)
  switch (metric) {
    case 'weight': return any((r) => r.weight != null)
    case 'bp': return any((r) => r.blood_pressure_systolic != null || r.blood_pressure_diastolic != null)
    case 'glucose': return any((r) => r.blood_glucose_fasting != null || r.blood_glucose_1h != null || r.blood_glucose_2h != null)
    case 'hcg': return any((r) => r.hcg_value != null)
    case 'uric_acid': return any((r) => r.uric_acid != null)
    case 'temp': return any((r) => r.body_temperature != null)
    // 三围：胸/腰/臀任一项有值即出图（三条曲线各自独立，缺的那条自然断开）
    case 'girth': return any((r) => r.bust != null || r.waist != null || r.hip != null)
    case 'sleep': return any((r) => r.sleep_hours != null)
    case 'water': return any((r) => r.water_intake != null)
    case 'fhr': return any((r) => r.fetal_heart_rate != null)
    case 'fm': return any((r) => r.fetal_movement_count != null)
    case 'contraction': return any((r) => r.contraction_duration != null || r.contraction_count != null)
    default: return false
  }
}

/** 体重专属汇总：孕期第一条体重 → 最新一条体重的增减（与所选时段无关，是个孕期级事实） */
const weightExtraStats = computed(() => {
  const rows = allRecords.value.filter((r: any) => r.weight != null && r.weight !== '')
  if (rows.length < 2) return []
  const first = Number(rows[0].weight)
  const last = Number(rows[rows.length - 1].weight)
  if (isNaN(first) || isNaN(last)) return []
  const d = last - first
  const val = Number.isInteger(d) ? String(Math.abs(d)) : Math.abs(d).toFixed(1)
  return [{ label: '孕期增重', value: (d > 0 ? '+' : d < 0 ? '−' : '±') + val + ' kg' }]
})

interface TableCol {
  date: string
  value: string | number
  extra?: string
  note?: string
}

/** 三围的「数值」列：三条曲线的值一起列，并带短标签，避免只显示胸围看不出另外两项 */
function girthText(r: any): string {
  const parts: Array<[string, any]> = [['胸', r.bust], ['腰', r.waist], ['臀', r.hip]]
  const shown = parts.filter(([, v]) => v != null && v !== '')
  if (!shown.length) return '--'
  return shown.map(([k, v]) => k + v).join(' / ')
}

function tableData(
  metric: string,
  mainField: string,
  opts?: {
    sub?: string
    format?: (r: any) => string
    cols?: Array<{ key: string; label: string }>
    extra?: string
    extraLabel?: string
    /** 备注列改成取该字段（如宫缩的疼痛程度），与用户自己的备注合并显示 */
    noteField?: string
  }
): TableCol[] {
  return records.value
    .filter((r: any) => {
      if (opts?.cols) return opts.cols.some((c) => r[c.key] != null)
      if (opts?.format) return true
      return r[mainField] != null
    })
    .map((r: any) => {
      const parts: string[] = []
      if (opts?.noteField && r[opts.noteField] != null && r[opts.noteField] !== '') parts.push(String(r[opts.noteField]))
      if (r.note) parts.push(String(r.note))
      return {
        date: dayjs(r.record_date).format('MM-DD'),
        value: opts?.format ? opts.format(r) : (r[mainField] ?? '--'),
        extra: opts?.extra ? (r[opts.extra] ?? '') : undefined,
        note: parts.length ? parts.join(' · ') : undefined,
      }
    })
}
</script>

<style scoped>
.stats-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 2px;
}
.stats-header {
  background: white;
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.stats-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 10px;
  color: #1e293b;
}
.period-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.period-tab {
  padding: 6px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 20px;
  background: white;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
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

.charts-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 50px 20px;
  color: #94a3b8;
  font-size: 14px;
}
.empty-icon { font-size: 40px; display: block; margin-bottom: 8px; opacity: 0.4; }
.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid #e2e8f0;
  border-top-color: #c44680;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ====== 独立「统计」页的大号版式（与记录页内嵌共用同一份数据/图表逻辑）====== */
.stats-panel--page {
  flex: none;
  overflow: visible;
  padding: 0;
}
.stats-panel--page .stats-header {
  padding: 16px 20px;
  margin-bottom: 16px;
}
.stats-panel--page .stats-title {
  font-size: 18px;
  margin: 0 0 12px;
}
.stats-panel--page .period-tabs { margin-bottom: 8px; }
.stats-panel--page .period-tab { padding: 7px 20px; }
.stats-panel--page .charts-section { gap: 16px; }
.stats-panel--page .loading-state,
.stats-panel--page .empty-state {
  padding: 60px 20px;
  font-size: 15px;
}
.stats-panel--page .empty-icon { font-size: 48px; margin-bottom: 10px; }
.stats-panel--page .loading-spinner {
  width: 24px;
  height: 24px;
  margin-right: 8px;
}

@media (max-width: 768px) {
  .stats-header { padding: 12px 14px; border-radius: 12px; }
  .stats-title { font-size: 14px; }
  .period-tab { padding: 5px 14px; font-size: 12px; }

  .stats-panel--page .stats-header { padding: 12px 14px; border-radius: 12px; }
  .stats-panel--page .stats-title { font-size: 16px; }
  .stats-panel--page .period-tab { padding: 6px 16px; font-size: 13px; }
}
</style>
