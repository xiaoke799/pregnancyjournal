<template>
  <div class="metric-card">
    <div class="card-head">
      <h3 class="card-title">{{ title }}</h3>
      <span class="card-unit">{{ unit }}</span>
    </div>

    <!-- 折线图 -->
    <div class="chart-wrap" ref="chartWrapRef">
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
})

const showTable = ref(false)
const chartWrapRef = ref<HTMLDivElement>()

const hasExtra = computed(() => props.tableData.some((r: any) => r.extra))
const hasNote = computed(() => props.tableData.some((r: any) => r.note))

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
      bottom: 0,
      textStyle: { fontSize: 11, color: '#64748b' },
      itemWidth: 16,
      itemHeight: 3,
    },
    grid: {
      top: 12,
      left: 8,
      right: 8,
      bottom: series.length > 1 ? 28 : 8,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: props.dates,
      axisLabel: {
        fontSize: 10,
        color: '#94a3b8',
        interval: props.dates.length > 15 ? Math.ceil(props.dates.length / 10) - 1 : 0,
        rotate: props.dates.length > 20 ? 45 : 0,
      },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' as const } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    dataZoom: props.dates.length > 15 ? [
      { type: 'inside', start: Math.max(0, 100 - (20 / props.dates.length * 100)), end: 100 },
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
}
.card-unit {
  font-size: 11px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 8px;
}

/* 图表 */
.chart-wrap {
  height: 220px;
  margin-bottom: 4px;
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
  .card-title { font-size: 14px; }
}
</style>
