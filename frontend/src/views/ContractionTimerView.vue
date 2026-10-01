<template>
  <div class="contraction-timer" :class="{ alert: alert511 }">
    <div class="timer-header">
      <button class="close-btn" @click="goBack">关闭</button>
      <h2>宫缩计时</h2>
    </div>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button :class="['mode-tab', { active: mode === 'auto' }]" @click="mode = 'auto'">
        <AppIcon name="timer" :size="15" /> 自动计时
      </button>
      <button :class="['mode-tab', { active: mode === 'manual' }]" @click="mode = 'manual'">
        <AppIcon name="edit" :size="15" /> 手动输入
      </button>
    </div>

    <!-- 自动计时模式 -->
    <template v-if="mode === 'auto'">
      <div class="timer-main">
        <button
          class="big-button"
          :class="{ running: isRunning }"
          @click="onToggleContraction"
        >
          {{ isRunning ? '停止' : '开始' }}
        </button>

        <div class="timer-stats" v-if="contractions.length > 0 || isRunning">
          <div class="stat" v-if="isRunning">
            <span class="stat-label">正在计时</span>
            <span class="stat-value live">{{ currentElapsed }}</span>
          </div>
          <div class="stat" v-if="lastDuration && !isRunning">
            <span class="stat-label">本次持续</span>
            <span class="stat-value">{{ formatDuration(lastDuration) }}</span>
          </div>
          <div class="stat" v-if="lastInterval">
            <span class="stat-label">距上次间隔</span>
            <span class="stat-value">{{ formatDuration(lastInterval) }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">总次数</span>
            <span class="stat-value">{{ totalCount }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 手动输入模式 -->
    <template v-else>
      <div class="manual-input-section">
        <div class="input-group">
          <label>开始时间</label>
          <n-date-picker
            v-model:value="manualStartTime"
            type="datetime"
            format="yyyy-MM-dd HH:mm:ss"
            value-format="yyyy-MM-ddTHH:mm:ss"
            style="width: 100%"
            placeholder="选择或输入开始时间"
            clearable
          />
        </div>

        <div class="input-arrow">→</div>

        <div class="input-group">
          <label>结束时间</label>
          <n-date-picker
            v-model:value="manualEndTime"
            type="datetime"
            format="yyyy-MM-dd HH:mm:ss"
            value-format="yyyy-MM-ddTHH:mm:ss"
            style="width: 100%"
            placeholder="选择或输入结束时间"
            clearable
          />
        </div>

        <div class="manual-duration" v-if="manualStartTime && manualEndTime && manualEndTime > manualStartTime">
          持续 {{ formatManualDuration }}
        </div>

        <button
          class="save-manual-btn"
          :disabled="!canSaveManual"
          @click="handleSaveManual"
        >
          保存记录
        </button>
      </div>
    </template>

    <!-- 对照参考（**不是诊断**）：拿本次的持续 / 间隔按指南口径给结论。
         放在两个模式都能看到的位置 —— 手动补记的人同样需要知道这个数字意味着什么。 -->
    <div v-if="ctJudge.level !== 'unknown'" class="ct-judge">
      <span class="ctj-text" :style="{ color: LEVEL_TOKEN[ctJudge.level] }">{{ ctJudge.text }}</span>
      <span class="ctj-detail">{{ ctJudge.detail }}</span>
    </div>
    <div class="ct-std">
      参考：规律宫缩为持续 ≥{{ CT_STANDARD.laborDurationSec }} 秒、间隔 {{ CT_STANDARD.laborIntervalMin }} 分钟内；
      不规律、时强时弱且休息后能缓解的多为假宫缩。是否临产以产科检查为准。
    </div>

    <!-- 宫缩记录列表 -->
    <div class="contraction-list" v-if="contractions.length > 0">
      <h3>宫缩记录</h3>
      <div v-for="(c, i) in contractions" :key="i" class="contraction-item">
        <span class="item-index">第{{ i + 1 }}次</span>
        <span>{{ formatTime(c.startTime) }} ~ {{ formatTime(c.endTime) }}</span>
        <span class="item-duration">持续 {{ formatDuration(c.duration) }}</span>
        <span v-if="c.interval" class="item-interval">间隔 {{ formatDuration(c.interval) }}</span>
      </div>
    </div>

    <div class="alert-banner" v-if="alert511">
      ⚠️ 已满足5-1-1法则！建议立即前往医院！
    </div>

    <button class="end-session-btn" @click="handleEndSession" v-if="sessionId">
      结束本次会话
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { NDatePicker, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useContractionTimer } from '@/composables/useContractionTimer'
import { contractionApi } from '@/api/contraction'
import { pickResumableSession } from '@/utils/session-resume'
import { judgeContraction, CT_STANDARD, LEVEL_TOKEN } from '@/utils/clinical-standards'
import dayjs from 'dayjs'
import AppIcon from '@/components/common/AppIcon.vue'

const router = useRouter()
const pregnancyStore = usePregnancyStore()
const message = useMessage()

const mode = ref<'auto' | 'manual'>('auto')
const manualStartTime = ref<number | null>(null)
const manualEndTime = ref<number | null>(null)

const {
  sessionId, isRunning, contractions, lastDuration, lastInterval,
  alert511, totalCount, currentStartTime,
  startContraction, endContraction, recordManual, endSession, reset,
  startSession, resumeSession,
} = useContractionTimer()

/**
 * 「本次已持续」要能走字，必须有一个每秒变化的**响应式**值参与计算。
 *
 * 之前这里直接用 `Date.now()`：它不是响应式依赖，而 computed 只在响应式依赖
 * 变化时才重新求值 —— 于是只有「开始计时」和「结束计时」两个瞬间各算一次，
 * 中间一直是同一个值，页面上的时长纹丝不动（diff≈0 时还会一直显示 '--'）。
 * 现在用一个每秒更新的 nowTick 驱动，并在计时结束后停掉它、卸载时清理。
 */
const nowTick = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null }
}

watch(isRunning, (running) => {
  if (running && !ticker) {
    ticker = setInterval(() => { nowTick.value = Date.now() }, 1000)
  } else if (!running) {
    stopTicker()
  }
}, { immediate: true })

onUnmounted(stopTicker)

const currentElapsed = computed(() => {
  if (!currentStartTime.value) return ''
  const diff = (nowTick.value - new Date(currentStartTime.value).getTime()) / 1000
  return formatDuration(diff)
})

const canSaveManual = computed(() => {
  if (!manualStartTime.value || !manualEndTime.value) return false
  return manualEndTime.value > manualStartTime.value
})

const formatManualDuration = computed(() => {
  if (!manualStartTime.value || !manualEndTime.value) return ''
  const diff = (manualEndTime.value - manualStartTime.value) / 1000
  return formatDuration(diff)
})

function formatDuration(seconds: number): string {
  if (!seconds) return '--'
  const min = Math.floor(seconds / 60)
  const sec = Math.round(seconds % 60)
  return min > 0 ? `${min}分${sec}秒` : `${sec}秒`
}

/**
 * 本次宫缩的**临床参考判读**（不是诊断）。
 *
 * ⚠️ `lastInterval` 在 composable 里是**秒**（`formatDuration` 也是按秒算的），
 *    而判读函数要的是**分钟** —— 差 60 倍，是本模块最容易写错的一处
 *    （daily-rollup 里同样栽过：会话表 avg_interval 是秒，记录列是分）。
 */
const ctJudge = computed(() =>
  judgeContraction({
    durationSec: lastDuration.value || null,
    intervalMin: lastInterval.value ? lastInterval.value / 60 : null,
    weeks: pregnancyStore.gestationalAge?.weeks ?? null,
  })
)

function formatTime(isoStr?: string): string {
  if (!isoStr) return '--'
  return dayjs(isoStr).format('HH:mm:ss')
}

async function handleSaveManual() {
  if (!canSaveManual.value) return
  if (!sessionId.value) { message.error('会话还没就绪，请返回后重新进入'); return }
  const start = dayjs(manualStartTime.value).toISOString()
  const end = dayjs(manualEndTime.value).toISOString()
  // ⚠️ 以前不看返回值，sessionId 为空时 recordManual 直接 return，
  //    这里却照样弹「已保存」—— 用户以为记下了，其实什么都没写。
  const ok = await recordManual(start, end)
  if (!ok) { message.error('保存失败，请重试'); return }
  message.success('已保存')
  manualStartTime.value = null
  manualEndTime.value = null
}

/** 开始 / 结束一次宫缩。会话没建起来时明确提示，不再静默什么都不做。 */
async function onToggleContraction() {
  if (!sessionId.value) { message.error('会话还没就绪，请返回后重新进入'); return }
  if (isRunning.value) {
    const ok = await endContraction()
    if (!ok) message.error('结束这次宫缩失败，请重试')
  } else {
    const ok = await startContraction()
    if (!ok) message.error('开始计时失败，请重试')
  }
}

async function handleEndSession() {
  const ok = await endSession()
  if (!ok) { message.error('结束记录失败，请重试'); return }
  router.push('/')
}

function goBack() {
  router.push('/')
}

/** 孕期档案由 App.vue 壳层异步预取（不 await）⇒ 挂载时可能还没到，这里主动等一次。 */
async function ensurePregnancy(): Promise<boolean> {
  if (pregnancyStore.currentPregnancy) return true
  await pregnancyStore.fetchActivePregnancy()
  if (pregnancyStore.currentPregnancy) return true
  message.error('还没取到孕期信息，请先在「设置」里完成初始设置')
  return false
}

/**
 * 进页面前先看今天有没有**还没结束**的会话：有就接着用它。
 *
 * 🔴 修的是「计到一半退出 = 会话永远挂着」：本页 onMounted 会建会话、onUnmounted 只做本地
 *    reset（不结束服务端会话），而以前进来**无条件新建** ⇒ 每退一次就多一条 end_time=NULL 的
 *    会话，首页一直显示「计时中…」，回来又新建一条，之前那几条宫缩在页面上再也接不上。
 * 今天遗留多条时：留**最晚**的那条继续用，更早的顺手收尾（它们的明细早已汇总进当天记录，
 * 收尾只是把 end_time 补上，不会再凭空产生数据）。
 */
async function resumeTodayIfAny(pregnancyId: string): Promise<boolean> {
  const today = dayjs().format('YYYY-MM-DD')
  try {
    const res: any = await contractionApi.listSessions(pregnancyId, today)
    const { keep, stale } = pickResumableSession(res && res.code === 0 ? res.data : [], today)
    if (!keep) return false
    for (const s of stale) {
      try { await contractionApi.endSession(s.id as string) } catch (e) { /* 收尾失败不影响恢复 */ }
    }
    const ok = await resumeSession(keep)
    if (ok) {
      message.info(`已恢复今天 ${String(keep.start_time || '').slice(0, 5)} 开始的会话，可以接着计时`)
    }
    return ok
  } catch (e) {
    return false
  }
}

onMounted(async () => {
  // ⚠️ 以前是 `if (currentPregnancy) startSession(...)`：孕期没取回时会话根本没建，
  //    而所有按钮又都是「sessionId 为空就静默返回」⇒ 整个页面点了全没反应。
  if (!(await ensurePregnancy())) return
  const pid = pregnancyStore.currentPregnancy!.id
  if (await resumeTodayIfAny(pid)) return
  const ok = await startSession(pid)
  if (!ok) message.error('初始化失败，计时可能不可用，请返回后重新进入')
})

onUnmounted(() => {
  reset()
})
</script>

<style scoped>
.contraction-timer {
  min-height: 100vh; padding: 20px; background: var(--bg-color);
  display: flex; flex-direction: column; align-items: center;
}
.contraction-timer.alert { background: var(--bg-tint-danger, #fff2f0); }
.timer-header { width: 100%; display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.close-btn { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--text-secondary); }

/* 模式切换 */
.mode-tabs {
  display: flex; gap: 0; width: 100%; max-width: 400px;
  background: var(--border-color); border-radius: 10px; padding: 3px; margin-bottom: 24px;
}
.mode-tab {
  flex: 1; padding: 8px 0; border: none; background: transparent;
  font-size: 14px; cursor: pointer; border-radius: 8px; transition: background-color 0.25s, box-shadow 0.25s, color 0.25s;
  color: var(--text-secondary);
}
.mode-tab.active {
  background: var(--bg-card, white); color: var(--primary-color); font-weight: 600;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

/* 自动计时 */
.timer-main { text-align: center; display: flex; flex-direction: column; align-items: center; min-height: 200px; justify-content: center; }
.big-button {
  width: 180px; height: 180px; border-radius: 50%; border: 4px solid var(--primary-color);
  background: var(--bg-card, white); font-size: 30px; font-weight: 700; color: var(--primary-color);
  cursor: pointer; transition: background-color 0.3s, border-color 0.3s, color 0.3s; box-shadow: var(--shadow-lg);
}
.big-button.running { border-color: #FF4D4F; color: #FF4D4F; background: var(--bg-tint-danger, #fff2f0); animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,77,79,0.3); } 50% { box-shadow: 0 0 0 20px rgba(255,77,79,0); } }
.timer-stats { display: flex; gap: 28px; margin-top: 28px; flex-wrap: wrap; justify-content: center; }
.stat { text-align: center; min-width: 70px; }
.stat-label { display: block; font-size: 12px; color: var(--text-hint); margin-bottom: 4px; }
.stat-value { font-size: 18px; font-weight: 600; }
.stat-value.live { color: #FF4D4F; font-size: 22px; }

/* 手动输入 */
.manual-input-section {
  width: 100%; max-width: 400px; background: var(--bg-card, #ffffff);
  border-radius: 12px; padding: 24px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.input-group { margin-bottom: 16px; }
.input-group label {
  display: block; font-size: 13px; font-weight: 600;
  color: var(--text-secondary); margin-bottom: 6px;
}
.input-arrow {
  text-align: center; font-size: 20px; color: var(--primary-color);
  margin: 4px 0 16px; font-weight: bold;
}
.manual-duration {
  text-align: center; font-size: 15px; font-weight: 600;
  color: var(--primary-color); margin-bottom: 16px; padding: 8px;
  background: var(--bg-tint-pink, #fff5f7); border-radius: 8px;
}
.save-manual-btn {
  width: 100%; padding: 12px; background: var(--primary-color); color: white;
  border: none; border-radius: 10px; font-size: 16px; font-weight: 600;
  cursor: pointer; transition: opacity 0.25s;
}
.save-manual-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.save-manual-btn:not(:disabled):hover { filter: brightness(1.05); transform: translateY(-1px); }

/* 记录列表 */
.contraction-list { width: 100%; max-width: 400px; margin-top: 24px; }
.contraction-list h3 { font-size: 15px; margin-bottom: 12px; color: var(--text-color); }
.contraction-item {
  display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 10px 12px;
  border-bottom: 1px solid var(--border-color); font-size: 13px; align-items: baseline;
}
.item-index { font-weight: 600; color: var(--primary-color); min-width: 48px; }
.item-duration { font-weight: 600; color: #e74c3c; }
.item-interval { color: var(--text-hint); }

/* 临床参考判读（不是诊断）：结论 + 展开说明 */
.ct-judge {
  width: 100%; max-width: 400px; margin-top: 16px;
  padding: 10px 12px; border-radius: 10px;
  background: var(--bg-color-2, #f8fafc);
  border: 1px solid var(--border-color-soft, #efe7ef);
  display: flex; flex-direction: column; gap: 4px;
}
.ctj-text { font-size: 14px; font-weight: 700; }
.ctj-detail { font-size: 12px; line-height: 1.5; color: var(--text-secondary, #64748b); }
.ct-std {
  width: 100%; max-width: 400px; margin-top: 8px;
  font-size: 11.5px; line-height: 1.5; color: var(--text-hint, #94a3b8);
}

/* 警告 & 结束按钮 */
.alert-banner { background: #FF4D4F; color: white; padding: 14px; border-radius: 10px; margin-top: 16px; font-weight: 600; text-align: center; width: 100%; max-width: 400px; }
.end-session-btn { margin-top: 24px; padding: 12px 32px; background: var(--accent-color); color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 15px; }

/* 移动端适配 */
@media (max-width: 768px) {
  .contraction-timer { padding: 12px 10px; }
  .mode-tabs { max-width: 100%; margin-bottom: 16px; }
  .mode-tab { font-size: 13px; padding: 7px 0; }
  .big-button { width: 150px; height: 150px; font-size: 26px; border-width: 3px; }
  .timer-stats { gap: 18px; margin-top: 20px; }
  .stat-value { font-size: 16px; }
  .stat-value.live { font-size: 20px; }
  .manual-input-section { max-width: 100%; padding: 18px 14px; border-radius: 10px; }
  .input-group { margin-bottom: 12px; }
  .input-group label { font-size: 12px; }
  .save-manual-btn { padding: 11px; font-size: 15px; }
  .contraction-list { max-width: 100%; }
  .contraction-item { padding: 8px 10px; gap: 4px 8px; font-size: 12px; }
  .alert-banner { padding: 12px; font-size: 13px; }
}
@media (max-width: 480px) {
  .big-button { width: 130px; height: 130px; font-size: 22px; }
  .timer-stats { gap: 12px; }
  .stat { min-width: 55px; }
}
</style>
