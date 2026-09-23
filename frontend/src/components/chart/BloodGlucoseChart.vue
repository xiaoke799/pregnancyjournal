<template>
  <div class="blood-glucose-chart">
    <h4 v-if="title">{{ title }}</h4>
    <v-chart :option="chartOption" :autoresize="true" style="height: 280px" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  title?: string
  data: Array<{
    date: string
    fasting?: number
    post_meal_1h?: number
    post_meal_2h?: number
  }>
}>(), {
  title: '血糖监测',
})

const chartOption = computed(() => {
  const dates = props.data.map(d => d.date)
  const fasting = props.data.map(d => d.fasting ?? null)
  const post1h = props.data.map(d => d.post_meal_1h ?? null)
  const post2h = props.data.map(d => d.post_meal_2h ?? null)

  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['空腹', '餐后1h', '餐后2h'], bottom: 0 },
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11, color: '#999' } },
    yAxis: {
      type: 'value', axisLabel: { fontSize: 11, color: '#999', formatter: '{value}' },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    series: [
      {
        name: '空腹', type: 'line', data: fasting, smooth: true,
        lineStyle: { color: '#1890FF', width: 2 }, itemStyle: { color: '#1890FF' },
        markLine: { silent: true, data: [{ yAxis: 5.1, lineStyle: { color: '#1890FF', type: 'dashed' }, label: { formatter: '空腹上限 5.1' } }] },
      },
      {
        name: '餐后1h', type: 'line', data: post1h, smooth: true,
        lineStyle: { color: '#FAAD14', width: 2 }, itemStyle: { color: '#FAAD14' },
        markLine: { silent: true, data: [{ yAxis: 7.8, lineStyle: { color: '#FAAD14', type: 'dashed' }, label: { formatter: '餐后1h上限 7.8' } }] },
      },
      {
        name: '餐后2h', type: 'line', data: post2h, smooth: true,
        lineStyle: { color: '#7C3AED', width: 2 }, itemStyle: { color: '#7C3AED' },
        markLine: { silent: true, data: [{ yAxis: 6.7, lineStyle: { color: '#7C3AED', type: 'dashed' }, label: { formatter: '餐后2h上限 6.7' } }] },
      },
    ],
  }
})
</script>

<style scoped>
.blood-glucose-chart h4 { margin-bottom: 8px; color: var(--text-color); font-size: 15px; }
</style>
