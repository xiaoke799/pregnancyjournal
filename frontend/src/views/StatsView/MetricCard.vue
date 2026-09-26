<template>
  <div class="metric-card">
    <div class="card-head">
      <h3 class="card-title">{{ title }}</h3>
      <div class="head-right">
        <span v-if="metaText" class="card-meta">{{ metaText }}</span>
        <span class="card-unit">{{ unit }}</span>
      </div>
    </div>

    <!-- 汇总数字：一眼看清「现在多少 / 平均多少 / 涨了还是降了」 -->
    <div v-if="summaryItems.length" class="summary-strip">
      <div v-for="(s, i) in summaryItems" :key="i" class="sum-item">
        <span class="sum-label">{{ s.label }}</span>
        <span class="sum-value">{{ s.value }}</span>
      </div>
    </div>

    <!-- 折线图 -->
    <div class="chart-wrap" ref="chartWrapRef" :class="{ 'has-zoom': showZoom }">
      <v-chart v-if="chartOption" :option="chartOption" autoresize class="echart" />
      <div v-else class="no-data">数据不足，无法绘制图表</div>
    </div>

    <!-- 数据表格 -->
    <div class="table-section">
      <div class="table-toggle" @click="showTable = !showTable">
        <span>{{ showTable ? '▾ 收起' : '▸ 数据列表 (' + tableData.length + '条)' }}</span>
      </div>
      <div v-show="showTable" class="table-body">
        <table class="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>数值</th>
              <th v-if="hasExtra">补充</th>
              <th v-if="hasNote">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in tableData" :key="i">
              <td class="col-date">{{ row.date }}</td>
              <td class="col-value" :style="{ color: color }">{{ row.value }}</td>
              <td v-if="hasExtra" class="col-extra">{{ row.extra || '-' }}</td>
              <td v-if="hasNote" class="col-note">{{ row.note || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  TitleComponent, TooltipComponent, GridComponent,
  LegendComponent, DataZoomComponent
} from 'echarts/components'

use([CanvasRenderer, LineChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, DataZoomComponent])

const props = defineProps({
  title: { type: String, required: true },
  unit: { type: String, required: true },
  color: { type: String, required: true },
  dates: { type: Array as () => string[], required: true },
  values: { type: Array as () => (number | null)[], required: true },
  values2: { type: Array as () => (number | null)[], default: () => [] },
  values3: { type: Array as () => (number | null)[], default: () => [] },
  legend: { type: Array as () => string[], default: () => [] },
  tableData: { type: Array as any, required: true },
  /** 额外想展示的汇总项（如体重的「较首次」增重），格式 { label, value } */
  extraStats: { type: Array as () => Array<{ label: string; value: string }>, default: () => [] },
})

const showTable = ref(false)
const chartWrapRef = ref<HTMLDivElement>()

const hasExtra = computed(() => props.tableData.some((r: any) => r.extra))
const hasNote = computed(() => props.tableData.some((r: any) => r.note))

// ====== 汇总数字 ======
/** 只统计非空值；取不到有效数据时返回 null（该序列不参与汇总） */
function statsOf(arr: (number | null)[]) {
  const nums = (arr || [])
    .filter((v) => v != null && v !== ('' as any) && !isNaN(Number(v)))
    .map(Number)
  if (!nums.length) return null
  const first = nums[0]
  const last = nums[nums.length - 1]
  return {
    first,
    last,
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    delta: last - first,
  }
}

/** 整数原样显示，小数保留 1 位（避免 62.300000000000004 这类浮点噪声） */
function fmt(n: number): string {
  if (n == null || isNaN(n)) return '--'
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1)
}

/** 实际有几条曲线在画（第二条/第三条全空就不算） */
const seriesList = computed(() => {
  const out: Array<{ name: string; v: (number | null)[] }> = [
    { name: props.legend[0] || props.title, v: props.values },
  ]
  if (props.values2?.some((v) => v != null)) out.push({ name: props.legend[1] || '第二项', v: props.values2 })
  if (props.values3?.some((v) => v != null)) out.push({ name: props.legend[2] || '第三项', v: props.values3 })
  return out
})

const summaryItems = computed(() => {
  const items: Array<{ label: string; value: string }> = []
  const multi = seriesList.value.length > 1
  for (const s of seriesList.value) {
    const st = statsOf(s.v)
    if (!st) continue
    // 多曲线时（血压收缩/舒张、血糖三个时点）先标出是哪条线，避免数字张冠李戴
    const pre = multi ? s.name + ' ' : ''
    items.push({ label: pre + '最新', value: fmt(st.last) })
    items.push({ label: pre + '平均', value: fmt(st.avg) })
    if (!multi) {
      items.push({ label: '范围', value: `${fmt(st.min)}~${fmt(st.max)}` })
      const d = st.delta
      items.push({ label: '变化', value: (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt(Math.abs(d)) })
    }
  }
  for (const e of props.extraStats || []) items.push(e)
  return items
})

/**
 * 卡片头的小字：「起止日期 · N 条」。
 * 取的是**该指标真正有值的首末两条**（不是坐标轴范围），所以一眼能看出这张图覆盖了哪一段、
 * 以及"看起来空"到底是没数据、还是数据在所选时段之外。
 */
const metaText = computed(() => {
  const td = (props.tableData || []) as Array<{ date: string }>
  if (!td.length) return ''
  if (td.length === 1) return `${td[0].date} · 1 条`
  return `${td[0].date}~${td[td.length - 1].date} · ${td.length} 条`
})

/**
 * 是否给「可见的缩放条」。
 * ⚠️ 只在点多（>40）时出现，且**默认显示全部（start:0 / end:100）**。
 *    老实现是 `type:'inside'` 且默认只显示末尾约 20 个点 —— 于是血糖这类每 45 天测一次的指标
 *    6 个点全被挪到视窗外，整张图空白，看起来像"数据丢了"（数据其实都在）。
 *    另外把 `zoomOnMouseWheel` 关掉：否则鼠标停在图上滚轮会变成缩放，长页面滚不下去。
 */
const showZoom = computed(() => props.dates.length > 40)

// 构建单条线
function buildSeries(data: (number | null)[], name: string, lineColor: string, idx: number) {
  return {
    name,
    type: 'line',
    data,
    smooth: true,
    symbol: props.dates.length > 20 ? 'none' : 'circle',
    symbolSize: 6,
    lineStyle: { width: 2.5, color: lineColor },
    itemStyle: { color: lineColor },
    emphasis: { focus: 'series' },
    connectNulls: true,
    // 第二/第三条线用虚线
    ...(idx > 0 ? { lineStyle: { width: 2, color: lineColor, type: [5, 5] as any } } : {}),
  }
}

// 颜色方案
const colors = ['#c44680', '#f97316', '#10b981']

const chartOption = computed(() => {
  const series = []
  series.push(buildSeries(props.values, props.legend[0] || props.title, props.color, 0))

  if (props.values2?.some(v => v != null)) {
    const c2 = colors[1] || adjustColor(props.color, 40)
    series.push(buildSeries(props.values2, props.legend[1] || '', c2, 1))
  }
  if (props.values3?.some(v => v != null)) {
    const c3 = colors[2] || adjustColor(props.color, -40)
    series.push(buildSeries(props.values3, props.legend[2] || '', c3, 2))
  }

  if (series.every(s => s.data.every(v => v == null))) return null

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,.95)',
      borderColor: '#e2e8f0',
      borderWidth: 1,
      textStyle: { color: '#1e293b', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params)) params = [params]
        let html = `<strong>${params[0]?.axisValue || ''}</strong>`
        for (const p of params) {
          if (p.value == null) continue
          html += `<br/>${p.marker} ${p.seriesName}: ${p.value} ${props.unit}`
        }
        return html
      },
    },
    legend: {
      show: series.length > 1,
      bottom: showZoom.value ? 24 : 0,
      textStyle: { fontSize: 11, color: '#64748b' },
      itemWidth: 16,
      itemHeight: 3,
    },
    grid: {
      top: 12,
      left: 8,
      right: 8,
      bottom: (series.length > 1 ? 28 : 8) + (showZoom.value ? 30 : 0),
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: props.dates,
      axisLabel: {
        fontSize: 10,
        color: '#94a3b8',
        // 不再手算 interval：以前按「总点数」算，一缩放窗口里就只剩一个标签。
        // 交给 echarts 按**当前可见窗口**自动排布并隐藏重叠标签。
        hideOverlap: true,
        rotate: props.dates.length > 12 ? 45 : 0,
      },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      // scale: true = 轴上下界贴合数据范围。原来一律从 0 起，
      // 体温 36.1~36.7 被画在 0~40 的轴上、三围 87~104 画在 0~120 的轴上 —— 全被压成一条直线。
      scale: true,
      axisLabel: { fontSize: 10, color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' as const } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    // 点数多时给一条「看得见、拖得动」的缩放条；默认显示全部，不偷偷裁掉数据
    dataZoom: showZoom.value ? [
      {
        type: 'inside',
        start: 0,
        end: 100,
        // 关掉滚轮缩放：否则鼠标停在图上滚页面会变成缩放，长页面滚不动
        zoomOnMouseWheel: false,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
      },
      {
        type: 'slider',
        start: 0,
        end: 100,
        height: 16,
        bottom: 4,
        borderColor: 'transparent',
        handleSize: 16,
        handleStyle: { color: '#fff', borderColor: '#c44680', borderWidth: 1.5 },
        moveHandleStyle: { color: '#e8d9e3' },
        // 关掉缩放条里的"数据小预览"：多条曲线/大量空值时它会被画成锯齿状的一团，很噪，
        // 而卡片本身已经把这些信息画清楚了。
        showDataShadow: false,
        backgroundColor: '#f1ebf2',
        fillerColor: 'rgba(196, 70, 128, 0.14)',
        textStyle: { fontSize: 10, color: '#94a3b8' },
        brushSelect: false,
      },
    ] : [],
    series,
  }
})

function adjustColor(hex: string, amount: number): string {
  // 简单的亮度调整
  let c = hex.replace('#', '')
  if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2]
  const num = parseInt(c, 16)
  let r = Math.min(255, Math.max(0, (num >> 16) + amount))
  let g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount))
  let b = Math.min(255, Math.max(0, (num & 0xff) + amount))
  return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`
}
</script>

<style scoped>
.metric-card {
  background: white;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  color: #1e293b;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.card-meta {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
}
.card-unit {
  font-size: 11px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 8px;
}

/* 汇总数字条：横向可换行，不挤压图表高度 */
.summary-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.sum-item {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  background: var(--bg-color-2, #f6f1ee);
  border: 1px solid var(--divider-color, #f1ebf2);
}
.sum-label {
  font-size: 11px;
  color: var(--text-hint, #6b6480);
  white-space: nowrap;
}
.sum-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color, #1f1730);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 图表 */
.chart-wrap {
  height: 220px;
  margin-bottom: 4px;
}
/* 带缩放条时给图表让出位置，否则绘图区被压缩 */
.chart-wrap.has-zoom {
  height: 264px;
}
.echart {
  width: 100%;
  height: 100%;
}
.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #cbd5e1;
  font-size: 13px;
}

/* 表格 */
.table-section { margin-top: 8px; border-top: 1px solid #f1f5f9; }
.table-toggle {
  text-align: center;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  cursor: pointer;
  user-select: none;
}
.table-toggle:hover { color: #c44680; }

.table-body { overflow-x: auto; padding-top: 4px; }
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.data-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 7px 10px;
  text-align: left;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.data-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #f8fafc;
  white-space: nowrap;
  color: #334155;
}
.col-date { font-weight: 500; color: #475569; }
.col-value { font-weight: 700; font-variant-numeric: tabular-nums; }
.col-extra { color: #64748b; }
.col-note { max-width: 120px; overflow: hidden; text-overflow: ellipsis; color: #94a3b8; font-size: 11px; }
.data-table tr:hover td { background: #f8fafc; }

@media (max-width: 768px) {
  .metric-card { padding: 12px; border-radius: 12px; }
  .chart-wrap { height: 180px; }
  .chart-wrap.has-zoom { height: 226px; }
  .card-title { font-size: 14px; }
  .card-meta { font-size: 10px; }
}
</style>
