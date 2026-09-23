<template>
  <div class="loading-skeleton">
    <div v-for="i in lines" :key="i" class="skeleton-line" :style="{ width: widths[i - 1] || '100%' }" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  lines?: number
  widths?: string[]
}>(), {
  lines: 3,
  widths: () => ['60%', '100%', '80%'],
})
</script>

<style scoped>
.loading-skeleton { padding: 16px 0; }
.skeleton-line {
  height: 16px; margin-bottom: 12px; border-radius: 8px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
</style>
