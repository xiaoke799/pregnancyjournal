<template>
  <div class="app-header">
    <div class="header-left">
      <button v-if="showBack" class="back-btn" @click="$router.back()">←</button>
      <h1 class="header-title">{{ title }}</h1>
    </div>
    <div class="header-right">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  showBack?: boolean
}>()
</script>

<style scoped>
.app-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 0; margin-bottom: 16px;
}
.header-left { display: flex; align-items: center; gap: 8px; }
.back-btn {
  background: none; border: none; font-size: 20px; cursor: pointer;
  color: var(--text-secondary); padding: 4px 8px;
}
.header-title { font-size: 20px; font-weight: 700; color: var(--text-color); margin: 0; }
.header-right { display: flex; align-items: center; gap: 8px; }
</style>
