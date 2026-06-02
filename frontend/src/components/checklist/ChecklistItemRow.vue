<template>
  <div class="checklist-item-row" :class="{ checked: !!item.is_checked }">
    <input type="checkbox" :checked="!!item.is_checked" @change="$emit('toggle', item)" class="item-checkbox" />
    <span class="item-name">{{ item.name }}</span>
    <button v-if="item.is_custom" class="delete-btn" @click="$emit('delete', item.id)">✕</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  item: {
    id: string
    name: string
    is_checked: boolean
    is_custom: boolean
  }
}>()

defineEmits<{
  toggle: [item: any]
  delete: [itemId: string]
}>()
</script>

<style scoped>
.checklist-item-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.item-checkbox { accent-color: var(--primary-color); width: 16px; height: 16px; cursor: pointer; }
.item-name { flex: 1; font-size: 14px; transition: all 0.2s; }
.checked .item-name { text-decoration: line-through; color: var(--text-hint); }
.delete-btn { background: none; border: none; color: var(--text-hint); cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 4px; }
.delete-btn:hover { color: #FF4D4F; background: #fff2f0; }
</style>
