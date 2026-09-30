<template>
  <!--
    「今天每次的记录」明细列表。

    为什么要有它：用户在胎动计数器 / 宫缩计时器里认认真真记了一整轮，
    结束后回到记录页只能看到一个**合并后的汇总数字**（几次、多少分钟），
    看不到「9:10 数了 12 次、用时 22 分钟」这种过程。用户明确要求「都要记录下来」。
    数据源是 daily_record 之外的 *_session / * 明细表，由后端 /daily-records/session-detail 一次取回。
  -->
  <div v-if="hasAny" class="session-detail">
    <div class="sd-head">
      <span class="sd-title">今天每次的记录</span>
      <span class="sd-hint">来自计数器 / 计时器 · 汇总已计入当天记录</span>
    </div>

    <!-- 胎动 -->
    <div v-if="fm.length" class="sd-group">
      <div class="sd-group-head">
        <span class="sd-dot sd-dot-fm">🦶</span>
        <span>胎动 · {{ fm.length }} 次会话</span>
      </div>
      <div v-for="s in fm" :key="s.id" class="sd-row">
        <span class="sd-time">{{ fmtRange(s.start_time, s.end_time) }}</span>
        <span class="sd-main">{{ s.count }} 次</span>
        <span class="sd-sub">{{ s.duration_minutes != null ? s.duration_minutes + ' 分钟' : '未计时' }}</span>
      </div>
    </div>

    <!-- 宫缩 -->
    <div v-if="ct.length" class="sd-group">
      <div class="sd-group-head">
        <span class="sd-dot sd-dot-ct">⏱</span>
        <span>宫缩 · {{ ct.length }} 次会话</span>
      </div>
      <div v-for="s in ct" :key="s.id" class="sd-row">
        <span class="sd-time">{{ fmtRange(s.start_time, s.end_time) }}</span>
        <span class="sd-main">{{ s.count }} 条</span>
        <span class="sd-sub">
          <template v-if="s.avg_duration != null">{{ s.avg_duration }} 秒/次</template>
          <template v-else>未计时</template>
          <template v-if="s.avg_interval_minutes != null"> · 间隔 {{ s.avg_interval_minutes }} 分钟</template>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { dailyRecordApi } from '@/api/daily-record'

const props = defineProps<{
  pregnancyId?: string
  /** YYYY-MM-DD；为空则后端按今天取 */
  date?: string
}>()

const fm = ref<any[]>([])
const ct = ref<any[]>([])

const hasAny = computed(() => fm.value.length > 0 || ct.value.length > 0)

/** 'HH:MM:SS' → 'HH:MM'；end 缺失（会话还在进行）时只显示开始时间 + 进行中 */
function hhmm(t?: string | null) {
  return t ? String(t).slice(0, 5) : ''
}
function fmtRange(start?: string | null, end?: string | null) {
  const s = hhmm(start)
  if (!s) return '--:--'
  return end ? `${s}–${hhmm(end)}` : `${s} · 进行中`
}

async function load() {
  if (!props.pregnancyId) { fm.value = []; ct.value = []; return }
  try {
    const res: any = await dailyRecordApi.getSessionDetail(props.pregnancyId, props.date || '')
    if (res && res.code === 0 && res.data) {
      fm.value = Array.isArray(res.data.fetal_movement) ? res.data.fetal_movement : []
      ct.value = Array.isArray(res.data.contraction) ? res.data.contraction : []
    }
  } catch (e) {
    // 明细取不到不该影响整页：静默留空（汇总数字仍在其它区域正常显示）
    fm.value = []
    ct.value = []
  }
}

watch([() => props.pregnancyId, () => props.date], () => { load() }, { immediate: true })

// 快捷记一笔 / 计数器结束会话后都会发这个事件，明细跟着刷新
onMounted(() => window.addEventListener('record-added', load))
onUnmounted(() => window.removeEventListener('record-added', load))
</script>

<style scoped>
.session-detail {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  padding: 10px 12px;
  margin-bottom: 10px;
}

.sd-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.sd-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.sd-hint {
  font-size: 11px;
  color: var(--text-hint, #94a3b8);
}

.sd-group + .sd-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color, #e2e8f0);
}

.sd-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin-bottom: 4px;
}

.sd-dot {
  font-size: 13px;
  line-height: 1;
}

.sd-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: 12.5px;
  color: var(--text-color, #1e293b);
}

.sd-time {
  font-variant-numeric: tabular-nums;
  color: var(--text-hint, #94a3b8);
  flex-shrink: 0;
  min-width: 84px;
}

.sd-main {
  font-weight: 600;
  flex-shrink: 0;
}

.sd-sub {
  color: var(--text-secondary, #64748b);
  font-size: 12px;
}

@media (max-width: 768px) {
  .sd-time { min-width: 76px; }
}
</style>
