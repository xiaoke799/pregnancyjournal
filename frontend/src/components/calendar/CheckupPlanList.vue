<template>
  <div class="checkup-plan-list">
    <h3>产检计划</h3>
    <div v-if="plans.length === 0" class="empty-hint">暂无产检计划</div>
    <div v-for="plan in plans" :key="plan.week_range" class="plan-item">
      <div class="plan-left">
        <span class="plan-week">孕{{ plan.week_range }}周</span>
        <span class="plan-date" v-if="plan.estimated_date">{{ plan.estimated_date }}</span>
      </div>
      <div class="plan-right">
        <span v-for="item in plan.items" :key="item" class="plan-tag">{{ item }}</span>
      </div>
      <span class="plan-status" :class="plan.is_done ? 'done' : 'pending'">
        {{ plan.is_done ? '✅' : '⏳' }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  plans: Array<{
    week_range: string
    items: string[]
    estimated_date?: string
    is_done?: boolean
  }>
}>()
</script>

<style scoped>
.checkup-plan-list { padding: 20px 0; }
.checkup-plan-list h3 { margin-bottom: 12px; }
.empty-hint { text-align: center; padding: 20px 0; color: var(--text-hint); }
.plan-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border-color); }
.plan-item:last-child { border-bottom: none; }
.plan-left { display: flex; flex-direction: column; min-width: 100px; }
.plan-week { font-weight: 600; color: var(--primary-color); font-size: 14px; }
.plan-date { font-size: 12px; color: var(--text-hint); }
.plan-right { flex: 1; display: flex; flex-wrap: wrap; gap: 4px; }
.plan-tag { padding: 2px 8px; border-radius: 12px; font-size: 12px; background: rgba(232,160,191,0.1); color: var(--primary-color); }
.plan-status { font-size: 16px; flex-shrink: 0; }
</style>
