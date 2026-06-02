<template>
  <div class="checklist-panel">
    <div class="panel-header">
      <h3>{{ checklist.name }}</h3>
      <div class="panel-actions">
        <n-button size="tiny" @click="$emit('initDefault', checklist.id)" v-if="checklist.items.length === 0">导入默认</n-button>
        <span class="progress-text">{{ checkedCount }}/{{ checklist.items.length }}</span>
      </div>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
    </div>
    <div v-for="cat in groupedItems" :key="cat.category" class="category-group">
      <div class="category-title" v-if="cat.category">{{ cat.category }}</div>
      <ChecklistItemRow
        v-for="item in cat.items"
        :key="item.id"
        :item="item"
        @toggle="$emit('toggleItem', item)"
        @delete="$emit('deleteItem', item.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import ChecklistItemRow from './ChecklistItemRow.vue'

const props = defineProps<{
  checklist: {
    id: string
    name: string
    items: Array<{
      id: string
      name: string
      category: string
      is_checked: boolean
      is_custom: boolean
    }>
  }
}>()

defineEmits<{
  initDefault: [checklistId: string]
  toggleItem: [item: any]
  deleteItem: [itemId: string]
}>()

const checkedCount = computed(() => props.checklist.items.filter(i => i.is_checked).length)

const progressPercent = computed(() => {
  if (props.checklist.items.length === 0) return 0
  return (checkedCount.value / props.checklist.items.length) * 100
})

const groupedItems = computed(() => {
  const groups: Record<string, any[]> = {}
  for (const item of props.checklist.items) {
    const cat = item.category || '其他'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }
  return Object.entries(groups).map(([category, items]) => ({ category, items }))
})
</script>

<style scoped>
.checklist-panel { background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px; box-shadow: var(--shadow-sm); }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.panel-header h3 { margin: 0; }
.panel-actions { display: flex; align-items: center; gap: 8px; }
.progress-text { font-size: 13px; color: var(--text-hint); }
.progress-bar { height: 4px; background: var(--border-color); border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--primary-color); border-radius: 2px; transition: width 0.3s; }
.category-group { margin-bottom: 8px; }
.category-title { font-weight: 600; color: var(--primary-color); margin-bottom: 4px; font-size: 14px; padding: 4px 0; }
</style>
