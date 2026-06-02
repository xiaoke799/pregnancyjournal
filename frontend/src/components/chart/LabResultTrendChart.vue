<template>
  <div class="lab-result-trend-chart">
    <h4 v-if="title">{{ title }}</h4>
    <v-chart :option="chartOption" :autoresize="true" style="height: 280px" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])

const props = defineProps<{
  title?: string
  itemName: string
  unit: string
  data: Array<{ gestational_week: number; value: number }>
  referenceMin?: number
  referenceMax?: number
}>()

const chartOption = computed(() => {
  const weeks = props.data.map(d => `${d.gestational_week}周`)
  const values = props.data.map(d => d.value)

  const series: any = {
    name: props.itemName, type: 'line', data: values, smooth: true,
    lineStyle: { color: '#7C3AED', width: 2 }, itemStyle: { color: '#7C3AED' },
    areaStyle: {
      color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(124,58,237,0.2)' }, { offset: 1, color: 'rgba(124,58,237,0.02)' }] },
    },
  }

  const markLines: any[] = []
  if (props.referenceMin !== undefined) {
    markLines.push({ yAxis: props.referenceMin, lineStyle: { color: '#52C41A', type: 'dashed' }, label: { formatter: `下限 ${props.referenceMin}` } })
  }
  if (props.referenceMax !== undefined) {
    markLines.push({ yAxis: props.referenceMax, lineStyle: { color: '#FF4D4F', type: 'dashed' }, label: { formatter: `上限 ${props.referenceMax}` } })
  }
  if (markLines.length > 0) {
    series.markLine = { silent: true, data: markLines }
  }

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => `${params[0].axisValue}<br/>${props.itemName}：${params[0].value} ${props.unit}`,
    },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: weeks, axisLabel: { fontSize: 11, color: '#999' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#999' }, splitLine: { lineStyle: { type: 'dashed' } } },
    series: [series],
  }
})
</script>

<style scoped>
.lab-result-trend-chart h4 { margin-bottom: 8px; color: var(--text-color); font-size: 15px; }
</style>
