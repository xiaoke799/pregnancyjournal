<template>
  <div class="weight-chart">
    <h4 v-if="title">{{ title }}</h4>
    <v-chart :option="chartOption" :autoresize="true" style="height: 280px" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  title?: string
  data: Array<{ date: string; weight: number }>
  recommendMin?: number
  recommendMax?: number
}>(), {
  title: '体重趋势',
})

const chartOption = computed(() => {
  const dates = props.data.map(d => d.date)
  const weights = props.data.map(d => d.weight)

  const series: any[] = [
    {
      name: '体重',
      type: 'line',
      data: weights,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: '#E8A0BF', width: 2 },
      itemStyle: { color: '#E8A0BF' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(232,160,191,0.3)' },
            { offset: 1, color: 'rgba(232,160,191,0.05)' },
          ],
        },
      },
    },
  ]

  if (props.recommendMin !== undefined && props.recommendMax !== undefined) {
    series[0].markArea = {
      silent: true,
      data: [[
        { yAxis: props.recommendMin, itemStyle: { color: 'rgba(82,196,26,0.1)' } },
        { yAxis: props.recommendMax },
      ]],
    }
  }

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = params[0]
        return `${p.axisValue}<br/>体重：${p.value} kg`
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11, color: '#999' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#999', formatter: '{value}kg' }, splitLine: { lineStyle: { type: 'dashed' } } },
    series,
  }
})
</script>

<style scoped>
.weight-chart h4 { margin-bottom: 8px; color: var(--text-color); font-size: 15px; }
</style>
