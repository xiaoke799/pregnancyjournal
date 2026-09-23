<template>
  <div class="contraction-timer" :class="{ alert: alert511 }">
    <div class="timer-header">
      <button class="close-btn" @click="goBack">✕ 关闭</button>
      <h2>⏱️ 宫缩计时</h2>
    </div>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button :class="['mode-tab', { active: mode === 'auto' }]" @click="mode = 'auto'">
        ⏱️ 自动计时
      </button>
      <button :class="['mode-tab', { active: mode === 'manual' }]" @click="mode = 'manual'">
        ✏️ 手动输入
      </button>
    </div>

    <!-- 自动计时模式 -->
    <template v-if="mode === 'auto'">
      <div class="timer-main">
        <button
          class="big-button"
          :class="{ running: isRunning }"
          @click="isRunning ? endContraction() : startContraction()"
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { NDatePicker, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useContractionTimer } from '@/composables/useContractionTimer'
import dayjs from 'dayjs'

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
  startSession,
} = useContractionTimer()

const currentElapsed = computed(() => {
  if (!currentStartTime.value) return ''
  const diff = (Date.now() - new Date(currentStartTime.value).getTime()) / 1000
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

function formatTime(isoStr?: string): string {
  if (!isoStr) return '--'
  return dayjs(isoStr).format('HH:mm:ss')
}

async function handleSaveManual() {
  if (!canSaveManual.value) return
  const start = dayjs(manualStartTime.value).toISOString()
  const end = dayjs(manualEndTime.value).toISOString()
  await recordManual(start, end)
  message.success('已保存')
  manualStartTime.value = null
  manualEndTime.value = null
}

async function handleEndSession() {
  await endSession()
  router.push('/')
}

function goBack() {
  router.push('/')
}

onMounted(async () => {
  if (pregnancyStore.currentPregnancy) {
    await startSession(pregnancyStore.currentPregnancy.id)
  }
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
.contraction-timer.alert { background: #fff2f0; }
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
  background: white; color: var(--primary-color); font-weight: 600;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

/* 自动计时 */
.timer-main { text-align: center; display: flex; flex-direction: column; align-items: center; min-height: 200px; justify-content: center; }
.big-button {
  width: 180px; height: 180px; border-radius: 50%; border: 4px solid var(--primary-color);
  background: white; font-size: 30px; font-weight: 700; color: var(--primary-color);
  cursor: pointer; transition: background-color 0.3s, border-color 0.3s, color 0.3s; box-shadow: var(--shadow-lg);
}
.big-button.running { border-color: #FF4D4F; color: #FF4D4F; background: #fff2f0; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,77,79,0.3); } 50% { box-shadow: 0 0 0 20px rgba(255,77,79,0); } }
.timer-stats { display: flex; gap: 28px; margin-top: 28px; flex-wrap: wrap; justify-content: center; }
.stat { text-align: center; min-width: 70px; }
.stat-label { display: block; font-size: 12px; color: var(--text-hint); margin-bottom: 4px; }
.stat-value { font-size: 18px; font-weight: 600; }
.stat-value.live { color: #FF4D4F; font-size: 22px; }

/* 手动输入 */
.manual-input-section {
  width: 100%; max-width: 400px; background: white;
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
  background: #fff5f7; border-radius: 8px;
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
