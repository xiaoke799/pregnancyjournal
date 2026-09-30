<template>
  <!--
    「胎动 / 宫缩 · 每次明细」弹窗。

    为什么用它替换页面内铺开的明细块：此前这批明细在记录页顶部整块铺开
    （「今天每次的记录」），用户反馈「上面放多了、显示不好操作」。
    现在记录页只留主要数据，想看每次的会话明细：点记录列表里的「胎动」「宫缩」
    条目弹出本框。数据源不变（/daily-records/session-detail 一次取回当日全部会话）。
  -->
  <n-modal
    v-model:show="showModel"
    class="session-detail-dialog"
    preset="card"
    :title="isFm ? '胎动明细' : '宫缩明细'"
    style="max-width: 420px; width: 92vw;"
    :mask-closable="true"
  >
    <div class="sdd-meta">
      <span>{{ date || '' }}</span>
      <span class="sdd-hint">来自计数器 / 计时器 · 汇总已计入当天记录</span>
    </div>

    <div v-if="sessions.length === 0" class="sdd-empty">
      这一天还没有{{ isFm ? '胎动' : '宫缩' }}会话记录
    </div>
    <template v-else>
      <div class="sdd-summary">共 {{ sessions.length }} 次会话</div>
      <div v-for="s in sessions" :key="s.id" class="sdd-row">
        <span class="sdd-time">{{ fmtRange(s.start_time, s.end_time) }}</span>
        <template v-if="isFm">
          <span class="sdd-main">{{ s.count }} 次</span>
          <span class="sdd-sub">{{ s.duration_minutes != null ? s.duration_minutes + ' 分钟' : '未计时' }}</span>
        </template>
        <template v-else>
          <span class="sdd-main">{{ s.count }} 条</span>
          <span class="sdd-sub">
            <template v-if="s.avg_duration != null">{{ s.avg_duration }} 秒/次</template>
            <template v-else>未计时</template>
            <template v-if="s.avg_interval_minutes != null"> · 间隔 {{ s.avg_interval_minutes }} 分钟</template>
          </span>
        </template>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { NModal } from 'naive-ui'
import { dailyRecordApi } from '@/api/daily-record'

const props = defineProps<{
  show: boolean
  /** 看哪一类的明细 */
  type: 'fetal_movement' | 'contraction'
  pregnancyId?: string
  /** YYYY-MM-DD；为空则后端按今天取 */
  date?: string
}>()

const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const showModel = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

const isFm = computed(() => props.type === 'fetal_movement')

const fm = ref<any[]>([])
const ct = ref<any[]>([])
// 🔴 空壳会话（进了计数器/计时器但一条没记 ⇒ count=0）不上屏：
//    daily-rollup 的口径是「空会话不代表这一天」，写回、首页「今日 N 次会话」、
//    记录页「有没有会话」的判据都已排除它；明细里再列一行「0 次」只会让用户困惑
//    「我明明只记了 2 次，怎么冒出 3 次会话」。与那三处保持同一口径。
const sessions = computed(() =>
  (isFm.value ? fm.value : ct.value).filter((s: any) => Number(s && s.count) > 0)
)

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

// 打开时取数；日期/孕期变化且开着时也刷新
watch(() => props.show, (v) => { if (v) load() })
watch([() => props.pregnancyId, () => props.date], () => { if (props.show) load() })

// 弹窗开着时「记一笔」/计数器写回会发 record-added —— 跟着刷新
function onRecordAdded() { if (props.show) load() }
onMounted(() => window.addEventListener('record-added', onRecordAdded))
onUnmounted(() => window.removeEventListener('record-added', onRecordAdded))
</script>

<style scoped>
.sdd-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}
.sdd-hint { font-size: 11px; color: var(--text-hint, #94a3b8); }
.sdd-summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin-bottom: 2px;
}
.sdd-empty {
  padding: 18px 8px;
  text-align: center;
  color: var(--text-hint, #94a3b8);
  font-size: 13px;
}
.sdd-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
  color: var(--text-color, #1e293b);
  border-top: 1px dashed var(--border-color, #e2e8f0);
}
.sdd-time {
  font-variant-numeric: tabular-nums;
  color: var(--text-hint, #94a3b8);
  flex-shrink: 0;
  min-width: 84px;
}
.sdd-main { font-weight: 600; flex-shrink: 0; }
.sdd-sub { color: var(--text-secondary, #64748b); font-size: 12px; }

@media (max-width: 768px) {
  .sdd-time { min-width: 76px; }
}
</style>
