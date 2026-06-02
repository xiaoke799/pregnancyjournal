<template>
  <div class="quick-record-grid">
    <h3>✏️ 今日快速记录</h3>
    <div class="grid">
      <div
        v-for="item in items"
        :key="item.key"
        class="grid-item"
        @click="$emit('select', item.key)"
      >
        <span class="item-icon">{{ item.icon }}</span>
        <span class="item-label">{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  select: [key: string]
}>()

const items = [
  { key: 'weight', icon: '⚖️', label: '体重' },
  { key: 'fetal_movement', icon: '🦶', label: '胎动' },
  { key: 'contraction', icon: '⏱️', label: '宫缩' },
  { key: 'mood', icon: '😊', label: '心情' },
  { key: 'fetal_heart_rate', icon: '❤️', label: '胎心' },
  { key: 'symptom', icon: '📋', label: '症状' },
]
</script>

<style scoped>
.quick-record-grid {
  background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.quick-record-grid h3 { margin-bottom: 12px; color: var(--text-color); }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.grid-item {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 12px; background: var(--bg-color); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;
}
.grid-item:hover { border-color: var(--primary-color); background: rgba(232,160,191,0.05); transform: translateY(-2px); }
.item-icon { font-size: 28px; }
.item-label { font-size: 13px; color: var(--text-secondary); }
</style>
