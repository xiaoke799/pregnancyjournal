<template>
  <div class="event-stream" v-if="events.length > 0">
    <div class="stream-header">
      <h3>� 重要事件</h3>
      <span v-if="summary" class="summary-badge">
        {{ summary.high_priority > 0 ? `⚡ ${summary.high_priority} 项紧急` : '' }}
        共 {{ summary.total }} 项
      </span>
    </div>

    <!-- 按日期分组 -->
    <div v-for="group in groupedEvents" :key="group.date" class="date-group">
      <div class="date-label">{{ group.label }}</div>

      <div
        v-for="event in group.items"
        :key="event.id"
        class="event-card"
        :class="[`priority-${event.priority}`, `source-${event.source_type}`]"
        @click="handleEventClick(event)"
      >
        <div class="event-icon">{{ event.icon }}</div>
        <div class="event-content">
          <div class="event-title">{{ event.title }}</div>
          <div v-if="event.subtitle" class="event-subtitle">{{ event.subtitle }}</div>
          <div class="event-meta">
            <span v-if="event.event_type === 'checkup_schedule' && event.gestational_week" class="meta-tag week">
              📅 孕{{ event.gestational_week }}周
            </span>
            <span v-if="event.days_until !== undefined && event.days_until >= 0" class="meta-tag days" :class="{ urgent: event.days_until <= 7 }">
              {{ event.days_until === 0 ? '今天' : event.days_until === 1 ? '明天' : `${event.days_until}天后` }}
            </span>
            <span class="meta-tag source" :class="event.source_type">
              {{ sourceLabel(event) }}
            </span>
          </div>
          <!-- 产检项目列表 -->
          <div v-if="event.schedule_items?.length" class="schedule-items">
            <span v-for="(item, idx) in event.schedule_items.slice(0, 4)" :key="idx" class="schedule-item-tag">
              {{ item }}
            </span>
            <span v-if="event.schedule_items.length > 4" class="more">+{{ event.schedule_items.length - 4 }}</span>
          </div>
        </div>
        <div v-if="!event.is_completed" class="event-action">
          <n-button size="tiny" quaternary @click.stop="handleComplete(event)">✓</n-button>
        </div>
      </div>
    </div>
  </div>

  <!-- 空状态 -->
  <div v-else class="empty-state">
    <div class="empty-icon">🎉</div>
    <div class="empty-text">暂无待办事项</div>
    <div class="empty-hint">近期产检和提醒会显示在这里</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import dayjs from 'dayjs'
import isToday from 'dayjs/plugin/isToday'
import isTomorrow from 'dayjs/plugin/isTomorrow'

dayjs.extend(isToday)
dayjs.extend(isTomorrow)

interface DashboardEvent {
  id: string
  event_type: string
  source_type: string
  source_id?: string
  title: string
  subtitle?: string
  date: string
  time?: string
  icon: string
  priority: string
  action_url?: string
  is_completed: boolean
  gestational_week?: number
  days_until?: number
  schedule_items?: string[]
  alert_details?: string[]
}

const props = defineProps<{
  events: DashboardEvent[]
  summary?: {
    total: number
    high_priority: number
    today: number
  }
}>()

const emit = defineEmits<{
  (e: 'eventClick', event: DashboardEvent): void
  (e: 'complete', event: DashboardEvent): void
}>()

/** 按日期分组 */
const groupedEvents = computed(() => {
  const groups: Record<string, { date: string; label: string; items: DashboardEvent[] }> = {}
  const today = dayjs().format('YYYY-MM-DD')

  for (const event of props.events) {
    const dateKey = event.date || '9999-12-31'
    let label: string

    if (!dateKey || dateKey === '9999-12-31') {
      label = '未定日期'
    } else if (dayjs(dateKey).isToday()) {
      label = '📍 今天'
    } else if (dayjs(dateKey).isTomorrow()) {
      label = '� 明天'
    } else {
      const d = dayjs(dateKey)
      const diff = d.diff(dayjs(), 'day')
      if (diff <= 7) {
        label = d.format('dddd') // 本周内显示星期几
      } else {
        label = d.format('M月D日')
      }
    }

    if (!groups[dateKey]) {
      groups[dateKey] = { date: dateKey, label, items: [] }
    }
    groups[dateKey].items.push(event)
  }

  return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date))
})

/** 来源标签 */
function sourceLabel(event: DashboardEvent): string {
  const labels: Record<string, string> = {
    checkup_schedule: '产检计划',
    checkup: '产检',
    manual: '自定义',
    daily_record: '记录关联',
  }
  return labels[event.source_type] || event.source_type
}

/** 点击事件 */
function handleEventClick(event: DashboardEvent) {
  emit('eventClick', event)
}

/** 标记完成 */
function handleComplete(event: DashboardEvent) {
  emit('complete', event)
}
</script>

<style scoped>
.event-stream {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.stream-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.stream-header h3 { margin: 0; color: var(--text-color); font-size: 16px; }
.summary-badge {
  font-size: 12px;
  color: var(--text-hint);
  background: var(--bg-color);
  padding: 2px 8px;
  border-radius: 10px;
}

.date-group { margin-bottom: 14px; }
.date-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 8px;
  padding-left: 4px;
}

.event-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 6px;
  border-radius: 10px;
  background: var(--bg-color);
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}
.event-card:hover {
  background: #fef3c7;
  transform: translateX(2px);
}
.event-card.priority-high {
  border-left-color: #ef4444;
  background: linear-gradient(90deg, #fef2f2 0%, transparent 100%);
}
.event-card.source-checkup_schedule .event-icon { font-size: 20px; }

.event-icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 28px;
  text-align: center;
  line-height: 28px;
}
.event-content { flex: 1; min-width: 0; }
.event-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1.4;
}
.event-subtitle {
  font-size: 12px;
  color: var(--text-hint);
  margin-top: 2px;
  line-height: 1.3;
}

.event-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.meta-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
}
.meta-tag.week { background: #dbeafe; color: #2563eb; }
.meta-tag.days { background: #dcfce7; color: #16a34a; }
.meta-tag.days.urgent { background: #fee2e2; color: #dc2626; font-weight: 600; }
.meta-tag.source {
  background: #f3e8ff;
  color: #9333ea;
  font-size: 10px;
}

.schedule-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.schedule-item-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: #fff7ed;
  color: #c2410c;
  border-radius: 4px;
}
.more { font-size: 11px; color: #94a3b8; }

.event-action {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s;
}
.event-card:hover .event-action { opacity: 1; }

.empty-state {
  text-align: center;
  padding: 32px 20px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
}
.empty-icon { font-size: 40px; margin-bottom: 8px; }
.empty-text { font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.empty-hint { font-size: 13px; color: var(--text-hint); }

@media (max-width: 600px) {
  .event-stream { padding: 14px; }
  .event-card { padding: 8px 10px; }
  .event-title { font-size: 13px; }
}
</style>
