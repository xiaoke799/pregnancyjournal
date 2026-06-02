<template>
  <div class="fetal-heart-rate-chart">
    <h4 v-if="title">{{ title }}</h4>
    <v-chart :option="chartOption" :autoresize="true" style="height: 280px" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkAreaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, TooltipComponent, MarkAreaComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  title?: string
  data: Array<{ date: string; fetal_heart_rate: number }>
}>(), {
  title: '胎心率趋势',
})

const chartOption = computed(() => {
  const dates = props.data.map(d => d.date)
  const rates = props.data.map(d => d.fetal_heart_rate)

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = params[0]
        return `${p.axisValue}<br/>胎心率：${p.value} 次/分`
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11, color: '#999' } },
    yAxis: {
      type: 'value', min: 80, max: 200,
      axisLabel: { fontSize: 11, color: '#999', formatter: '{value}' },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    series: [
      {
        type: 'line', data: rates, smooth: true,
        lineStyle: { color: '#FF6B8A', width: 2 }, itemStyle: { color: '#FF6B8A' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255,107,138,0.2)' }, { offset: 1, color: 'rgba(255,107,138,0.02)' }] },
        },
        markArea: {
          silent: true,
          data: [[
            { yAxis: 110, itemStyle: { color: 'rgba(82,196,26,0.1)' } },
            { yAxis: 160 },
          ]],
        },
      },
    ],
  }
})
</script>

<style scoped>
.fetal-heart-rate-chart h4 { margin-bottom: 8px; color: var(--text-color); font-size: 15px; }
</style>
