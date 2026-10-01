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
      <span class="sdd-empty-hint">下面可以直接补记一笔，或进{{ isFm ? '计数器' : '计时器' }}现数现记</span>
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

    <!-- 参考标准（**不是诊断**）：把「正常长什么样」放在用户正在看明细的地方，
         比藏进设置页有用得多 —— 他此刻正拿着自己的数字准备对照。 -->
    <div class="sdd-std">{{ stdText }}</div>

    <!-- 🔴 明细原本是条死路：只能看，看完既不能补记、也回不去编辑。
         以前「有会话就跳明细」意味着**这一天的数据看得见、改不了**，
         而其它二十几个类型点条目都是编辑 —— 唯独这两类进了死胡同。 -->
    <div class="sdd-actions">
      <n-button size="small" @click="emit('quick-log', props.type)">再记一笔</n-button>
      <router-link :to="isFm ? '/fetal-movement-counter' : '/contraction-timer'" class="sdd-link">
        去{{ isFm ? '胎动计数器' : '宫缩计时器' }} →
      </router-link>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { dailyRecordApi } from '@/api/daily-record'
import { FM_STANDARD, CT_STANDARD } from '@/utils/clinical-standards'

const props = defineProps<{
  show: boolean
  /** 看哪一类的明细 */
  type: 'fetal_movement' | 'contraction'
  pregnancyId?: string
  /** YYYY-MM-DD；为空则后端按今天取 */
  date?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  /** 点「再记一笔」：由外层打开对应的快捷弹窗（本弹窗自己不持有那套表单） */
  'quick-log': [type: 'fetal_movement' | 'contraction']
}>()

const showModel = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

const isFm = computed(() => props.type === 'fetal_movement')

// ⚠️ 必须声明在 isFm **之后**：computed 的工厂函数虽是惰性求值，
//    但模板首次渲染就会用到它，写上面就成了 TDZ（Cannot access before initialization）。
/** 参考标准文案（数字全部来自 utils/clinical-standards.ts，不在这里硬写） */
const stdText = computed(() =>
  isFm.value
    ? `参考：孕 ${FM_STANDARD.startWeek} 周起每天早、中、晚各数 1 小时，正常每小时 ≥${FM_STANDARD.perHourNormal} 次（12 小时累计 ≥${FM_STANDARD.per12hNormal} 次）。`
    : `参考：规律宫缩为持续 ≥${CT_STANDARD.laborDurationSec} 秒、间隔 ${CT_STANDARD.laborIntervalMin} 分钟内；不规律且休息后缓解多为假宫缩。`
)

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
.sdd-empty-hint {
  display: block;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-hint, #94a3b8);
}
/* 参考标准：压在次要底色上，不与数据行抢视觉 */
.sdd-std {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-color-2, #f8fafc);
  border: 1px solid var(--border-color-soft, #efe7ef);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-secondary, #64748b);
}
.sdd-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color, #e2e8f0);
}
.sdd-link {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rose-ink, #c44680);
  text-decoration: none;
}

@media (max-width: 768px) {
  .sdd-time { min-width: 76px; }
}
</style>
