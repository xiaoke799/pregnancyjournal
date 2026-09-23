<template>
  <div class="development-summary" v-if="data">
    <div class="summary-header">
      <span class="icon">🌱</span>
      <h3>本周发育参考</h3>
    </div>
    <div class="summary-body">
      <div class="metaphor">{{ data.size_metaphor }}</div>
      <div class="size-info">
        <span>身长约 {{ data.length_cm }}cm</span>
        <span class="dot">·</span>
        <span>约 {{ data.weight_g }}g</span>
      </div>
      <p class="development-text">{{ data.development }}</p>
    </div>
    <div class="tips">
      <span class="tips-icon">💡</span>
      <span>{{ data.tips }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  data: {
    size_metaphor: string
    length_cm: number
    weight_g: number
    development: string
    tips: string
  } | null
}>()
</script>

<style scoped>
.development-summary {
  background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.summary-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.summary-header h3 { margin: 0; color: var(--text-color); }
.summary-header .icon { font-size: 20px; }
.metaphor { font-size: 18px; font-weight: 600; color: var(--primary-color); margin-bottom: 4px; }
.size-info { color: var(--text-secondary); font-size: 14px; margin-bottom: 8px; }
.dot { margin: 0 4px; }
.development-text { font-size: 14px; color: var(--text-color); line-height: 1.6; margin-bottom: 12px; }
.tips {
  display: flex; align-items: flex-start; gap: 6px;
  background: rgba(124, 58, 237, 0.05); border-radius: var(--radius-md);
  padding: 10px 12px; font-size: 13px; color: var(--accent-color);
}
.tips-icon { flex-shrink: 0; }
</style>
