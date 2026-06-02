<template>
  <div class="checkup-list">
    <div class="section-header">
      <h3>产检记录</h3>
      <n-button type="primary" size="small" @click="$emit('add')">+ 新增</n-button>
    </div>
    <div v-if="checkups.length === 0" class="empty-hint">暂无产检记录，点击新增开始记录</div>
    <div v-else class="list-content">
      <div v-for="c in checkups" :key="c.id" class="checkup-item" @click="$emit('view', c.id)">
        <div class="checkup-left">
          <div class="checkup-date">{{ c.checkup_date }}</div>
          <div class="checkup-type">{{ c.checkup_type }}</div>
        </div>
        <div class="checkup-right">
          <span class="week-badge">孕{{ c.gestational_week }}周</span>
          <span class="status-badge" :class="c.is_completed ? 'completed' : 'pending'">
            {{ c.is_completed ? '已完成' : '待检查' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NButton } from 'naive-ui'

defineProps<{
  checkups: Array<{
    id: string
    checkup_date: string
    checkup_type: string
    gestational_week: number
    is_completed: number | boolean
  }>
}>()

defineEmits<{
  add: []
  view: [id: string]
}>()
</script>

<style scoped>
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-header h3 { margin: 0; }
.empty-hint { text-align: center; padding: 40px 0; color: var(--text-hint); }
.checkup-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 0; border-bottom: 1px solid var(--border-color); cursor: pointer;
}
.checkup-item:hover { background: rgba(232,160,191,0.03); }
.checkup-left { display: flex; flex-direction: column; gap: 4px; }
.checkup-date { color: var(--text-secondary); font-size: 14px; }
.checkup-type { font-weight: 500; }
.checkup-right { display: flex; align-items: center; gap: 8px; }
.week-badge {
  background: rgba(232,160,191,0.1); color: var(--primary-color);
  padding: 2px 8px; border-radius: 12px; font-size: 12px;
}
.status-badge { font-size: 12px; padding: 2px 8px; border-radius: 12px; }
.status-badge.completed { background: #f6ffed; color: #52c41a; }
.status-badge.pending { background: #fffbe6; color: #faad14; }
</style>
