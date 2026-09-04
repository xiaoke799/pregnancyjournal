<template>
  <div class="development-detail" v-if="data">
    <div class="detail-header">
      <div class="week-badge">第{{ data.week }}周</div>
      <div class="metaphor">{{ data.size_metaphor }}</div>
    </div>
    <div class="detail-body">
      <div class="size-info">
        <div class="size-item">
          <span class="size-label">📏 身长</span>
          <span class="size-value">{{ data.length_cm }} cm</span>
        </div>
        <div class="size-item">
          <span class="size-label">⚖️ 体重</span>
          <span class="size-value">{{ data.weight_g }} g</span>
        </div>
      </div>
      <div class="development-text">
        <h4>发育特征</h4>
        <p>{{ data.development }}</p>
      </div>
      <div class="tips">
        <h4>💡 孕期提示</h4>
        <p>{{ data.tips }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  data: {
    week: number
    size_metaphor: string
    length_cm: number
    weight_g: number
    development: string
    tips: string
  } | null
}>()
</script>

<style scoped>
.development-detail { background: var(--bg-card); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.detail-header {
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  color: white; padding: 20px; text-align: center;
}
.week-badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 16px; border-radius: 20px; font-size: 14px; margin-bottom: 8px; }
.metaphor { font-size: 24px; font-weight: 700; }
.detail-body { padding: 20px; }
.size-info { display: flex; gap: 20px; margin-bottom: 16px; }
.size-item { flex: 1; display: flex; flex-direction: column; gap: 4px; background: var(--bg-color); padding: 12px; border-radius: var(--radius-md); }
.size-label { font-size: 12px; color: var(--text-secondary); }
.size-value { font-size: 20px; font-weight: 700; color: var(--primary-color); }
.development-text, .tips { margin-bottom: 12px; }
.development-text h4, .tips h4 { font-size: 14px; color: var(--text-color); margin-bottom: 6px; }
.development-text p { font-size: 14px; line-height: 1.6; color: var(--text-secondary); }
.tips p { font-size: 13px; line-height: 1.6; color: var(--accent-color); }
</style>
