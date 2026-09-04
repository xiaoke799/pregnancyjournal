<template>
  <div class="checkup-knowledge" v-if="data">
    <div class="knowledge-card">
      <div class="knowledge-header">
        <h3>{{ data.full_name }}</h3>
        <span class="knowledge-type">{{ data.short_name }}</span>
      </div>
      <div class="knowledge-meta">
        <span class="meta-item">🕐 {{ data.timing }}</span>
        <span class="meta-item">⏱️ {{ data.duration }}</span>
      </div>
      <p class="knowledge-desc">{{ data.description }}</p>
      <div class="knowledge-prep" v-if="data.preparation">
        <h4>检查准备</h4>
        <p>{{ data.preparation }}</p>
      </div>
      <div class="knowledge-notes" v-if="data.notes">
        <h4>注意事项</h4>
        <p>{{ data.notes }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  data: {
    type: string
    full_name: string
    short_name: string
    timing: string
    duration: string
    description: string
    preparation?: string
    notes?: string
  } | null
}>()
</script>

<style scoped>
.knowledge-card { background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px; box-shadow: var(--shadow-sm); }
.knowledge-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.knowledge-header h3 { color: var(--primary-color); margin: 0; font-size: 18px; }
.knowledge-type { background: rgba(232,160,191,0.1); color: var(--primary-color); padding: 4px 12px; border-radius: 12px; font-size: 13px; }
.knowledge-meta { display: flex; gap: 16px; margin-bottom: 12px; color: var(--text-secondary); font-size: 13px; }
.knowledge-desc { font-size: 14px; line-height: 1.6; margin-bottom: 12px; }
.knowledge-prep, .knowledge-notes { margin-bottom: 8px; }
.knowledge-prep h4, .knowledge-notes h4 { font-size: 14px; color: var(--accent-color); margin-bottom: 4px; }
.knowledge-prep p, .knowledge-notes p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
</style>
