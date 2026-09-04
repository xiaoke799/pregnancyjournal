<template>
  <div class="hcg-trend-chart">
    <h4 v-if="title">{{ title }}</h4>
    <v-chart :option="chartOption" :autoresize="true" style="height: 280px" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  title?: string
  data: Array<{ gestational_week: number; value: number; reference_min?: number; reference_max?: number }>
}>(), {
  title: 'HCG趋势',
})

const chartOption = computed(() => {
  const weeks = props.data.map(d => `${d.gestational_week}周`)
  const values = props.data.map(d => d.value)
  const refMins = props.data.map(d => d.reference_min ?? null)
  const refMaxs = props.data.map(d => d.reference_max ?? null)

  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['HCG值', '参考下限', '参考上限'], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: weeks, axisLabel: { fontSize: 11, color: '#999' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#999' }, splitLine: { lineStyle: { type: 'dashed' } } },
    series: [
      {
        name: 'HCG值', type: 'line', data: values, smooth: true,
        lineStyle: { color: '#7C3AED', width: 2 }, itemStyle: { color: '#7C3AED' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(124,58,237,0.2)' }, { offset: 1, color: 'rgba(124,58,237,0.02)' }] } },
      },
      {
        name: '参考下限', type: 'line', data: refMins, smooth: true,
        lineStyle: { color: '#52C41A', type: 'dashed', width: 1 }, itemStyle: { color: '#52C41A' },
      },
      {
        name: '参考上限', type: 'line', data: refMaxs, smooth: true,
        lineStyle: { color: '#FF4D4F', type: 'dashed', width: 1 }, itemStyle: { color: '#FF4D4F' },
      },
    ],
  }
})
</script>

<style scoped>
.hcg-trend-chart h4 { margin-bottom: 8px; color: var(--text-color); font-size: 15px; }
</style>
