<template>
  <div class="empty-state">
    <div class="empty-icon">{{ icon }}</div>
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <slot name="action" />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description?: string
}>()
</script>

<style scoped>
.empty-state { text-align: center; padding: 80px 20px; }
.empty-icon { font-size: 64px; margin-bottom: 16px; }
.empty-state h2 { margin-bottom: 8px; color: var(--text-color); }
.empty-state p { color: var(--text-secondary); margin-bottom: 24px; }
</style>
