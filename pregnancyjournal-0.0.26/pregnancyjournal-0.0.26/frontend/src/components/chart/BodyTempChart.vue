<template>
  <div class="body-temp-chart">
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
  data: Array<{ date: string; body_temperature: number }>
}>(), {
  title: '体温趋势',
})

const chartOption = computed(() => {
  const dates = props.data.map(d => d.date)
  const temps = props.data.map(d => d.body_temperature)

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => `${params[0].axisValue}<br/>体温：${params[0].value}°C`,
    },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11, color: '#999' } },
    yAxis: {
      type: 'value', min: 35, max: 40,
      axisLabel: { fontSize: 11, color: '#999', formatter: '{value}°C' },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    series: [
      {
        type: 'line', data: temps, smooth: true,
        lineStyle: { color: '#FAAD14', width: 2 }, itemStyle: { color: '#FAAD14' },
        markArea: {
          silent: true,
          data: [[
            { yAxis: 36.0, itemStyle: { color: 'rgba(82,196,26,0.1)' } },
            { yAxis: 37.3 },
          ]],
        },
      },
    ],
  }
})
</script>

<style scoped>
.body-temp-chart h4 { margin-bottom: 8px; color: var(--text-color); font-size: 15px; }
</style>
