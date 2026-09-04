<template>
  <div class="reference-range-slider">
    <div class="range-label">
      <span class="item-name">{{ itemName }}</span>
      <span class="status-badge" :class="status">{{ statusText }}</span>
    </div>
    <div class="range-bar">
      <div class="range-track">
        <div class="range-normal" :style="normalStyle" />
        <div class="range-marker" :style="markerStyle" />
      </div>
      <div class="range-labels">
        <span>{{ min }}</span>
        <span class="ref-range">{{ referenceMin }} ~ {{ referenceMax }} {{ unit }}</span>
        <span>{{ max }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  itemName: string
  value: number
  referenceMin: number
  referenceMax: number
  unit: string
  min?: number
  max?: number
}>(), {
  min: 0,
  max: 100,
})

const status = computed(() => {
  if (props.value < props.referenceMin) return 'low'
  if (props.value > props.referenceMax) return 'high'
  return 'normal'
})

const statusText = computed(() => {
  const map: Record<string, string> = { low: '偏低', normal: '正常', high: '偏高' }
  return map[status.value]
})

const normalStyle = computed(() => {
  const range = props.max - props.min
  const left = ((props.referenceMin - props.min) / range) * 100
  const width = ((props.referenceMax - props.referenceMin) / range) * 100
  return { left: `${left}%`, width: `${width}%` }
})

const markerStyle = computed(() => {
  const pos = ((props.value - props.min) / (props.max - props.min)) * 100
  return { left: `${Math.min(100, Math.max(0, pos))}%` }
})
</script>

<style scoped>
.reference-range-slider { margin-bottom: 16px; }
.range-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.item-name { font-weight: 500; font-size: 14px; }
.status-badge { font-size: 12px; padding: 2px 8px; border-radius: 12px; }
.status-badge.normal { background: #f6ffed; color: #52c41a; }
.status-badge.low { background: #e6f7ff; color: #1890ff; }
.status-badge.high { background: #fff2f0; color: #ff4d4f; }
.range-track { position: relative; height: 8px; background: #f0f0f0; border-radius: 4px; margin-bottom: 4px; }
.range-normal { position: absolute; top: 0; height: 100%; background: rgba(82,196,26,0.2); border-radius: 4px; }
.range-marker { position: absolute; top: -4px; width: 16px; height: 16px; border-radius: 50%; background: var(--primary-color); transform: translateX(-50%); border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
.range-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-hint); }
.ref-range { color: #52c41a; font-weight: 500; }
</style>
