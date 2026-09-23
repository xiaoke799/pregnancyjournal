<template>
  <div class="record-icon-grid">
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
</template>

<script setup lang="ts">
defineEmits<{
  select: [key: string]
}>()

const items = [
  { key: 'weight', icon: '⚖️', label: '体重' },
  { key: 'fetal_movement', icon: '🦶', label: '胎动' },
  { key: 'contraction', icon: '⏱️', label: '宫缩' },
  { key: 'fetal_heart_rate', icon: '❤️', label: '胎心' },
  { key: 'body_temperature', icon: '🌡️', label: '体温' },
  { key: 'blood_glucose', icon: '🩸', label: '血糖' },
  { key: 'symptom', icon: '📋', label: '症状' },
  { key: 'mood', icon: '😊', label: '心情' },
  { key: 'habit', icon: '✅', label: '好习惯' },
  { key: 'supplement', icon: '💊', label: '营养补充' },
  { key: 'stool', icon: '💩', label: '便便' },
  { key: 'diary', icon: '📝', label: '日记' },
]
</script>

<style scoped>
.record-icon-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px 0; }
.grid-item {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 20px 12px; background: var(--bg-card); border-radius: var(--radius-lg);
  cursor: pointer; transition: all 0.2s; border: 1px solid transparent;
}
.grid-item:hover { border-color: var(--primary-color); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.item-icon { font-size: 28px; }
.item-label { font-size: 13px; color: var(--text-secondary); }
</style>
