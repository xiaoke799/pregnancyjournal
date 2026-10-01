<template>
  <div class="fetal-counter">
    <div class="counter-header">
      <button class="close-btn" @click="goBack">关闭</button>
      <h2>胎动计数</h2>
    </div>

    <div class="counter-main">
      <div class="count-display">{{ kickCount }}</div>
      <p class="count-label">胎动次数</p>

      <button class="kick-button" @click="onKick" :disabled="!isRunning">
        记录胎动
      </button>

      <div class="session-info" v-if="startTime">
        <span>开始时间：{{ startTime }}</span>
      </div>
    </div>

    <div class="counter-actions">
      <button v-if="!isRunning" class="start-btn" @click="startCounting" :disabled="starting">
        {{ starting ? '正在开始…' : '开始计数' }}
      </button>
      <button v-else class="end-btn" @click="endCounting">结束计数</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useFetalMovementCounter } from '@/composables/useFetalMovementCounter'

const router = useRouter()
const pregnancyStore = usePregnancyStore()
const message = useMessage()

/**
 * 🔴 必须**解构**取用，不能写 `const counter = useFetalMovementCounter()` 再在模板里用
 *    `counter.isRunning` —— Vue 只对**顶层** ref 自动解包，嵌套在普通对象里的 ref
 *    拿到的是 Ref 对象本身，而对象永远是「真值」。
 *    结果就是：`v-if="!counter.isRunning"` 恒为假 ⇒ 永远显示「结束计数」、
 *    「开始计数」按钮根本不出现；点「结束计数」又因为 session 从未创建而静默返回，
 *    最后被 router.push 踢回首页 —— 用户看到的就是「点了没反应 / 点了就退出」。
 *    解构后每个 ref 都是顶层绑定，模板里自动解包，行为才正确。
 */
const {
  kickCount, isRunning, startTime,
  startSession, recordKick, endSession, reset,
} = useFetalMovementCounter()

const starting = ref(false)

function goBack() { router.push('/') }

/** 孕期档案由 App.vue 壳层异步预取（不 await）⇒ 刚进页面时可能还没到，这里主动等一下。 */
async function ensurePregnancy(): Promise<boolean> {
  if (pregnancyStore.currentPregnancy) return true
  await pregnancyStore.fetchActivePregnancy()
  if (pregnancyStore.currentPregnancy) return true
  message.error('还没取到孕期信息，请先在「设置」里完成初始设置')
  return false
}

async function startCounting() {
  if (starting.value) return
  if (!(await ensurePregnancy())) return
  starting.value = true
  try {
    const ok = await startSession(pregnancyStore.currentPregnancy!.id)
    // 以前这里失败是静默的：按钮纹丝不动也不报错，用户只会觉得「点了没反应」
    if (!ok) message.error('开始计数失败，请检查网络后重试')
  } finally {
    starting.value = false
  }
}

async function onKick() {
  const ok = await recordKick()
  if (!ok) message.error('记录胎动失败，请重试')
}

async function endCounting() {
  // 只在真的开过一次计数时才结束；否则点了就直接被 router.push 踢回首页，
  // 看起来就像「点了一下就自己结束了」
  if (!isRunning.value) {
    message.warning('还没开始计数')
    return
  }
  const ok = await endSession()
  if (!ok) { message.error('结束计数失败，请重试'); return }
  message.success(`已记录 ${kickCount.value} 次胎动`)
  router.push('/')
}

onUnmounted(() => { reset() })
</script>

<style scoped>
.fetal-counter {
  min-height: 100vh; padding: 20px; background: var(--bg-color);
  display: flex; flex-direction: column; align-items: center;
}
.counter-header { width: 100%; display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
.close-btn { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--text-secondary); }
.counter-main { text-align: center; flex: 1; }
.count-display { font-size: 96px; font-weight: 800; color: var(--primary-color); }
.count-label { font-size: 18px; color: var(--text-secondary); margin-bottom: 32px; }
.kick-button {
  width: 160px; height: 160px; border-radius: 50%; border: 4px solid var(--primary-color);
  background: var(--bg-card, white); font-size: 20px; font-weight: 600; color: var(--primary-color);
  cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-lg);
}
.kick-button:active { transform: scale(0.95); }
.kick-button:disabled { opacity: 0.5; cursor: not-allowed; }
.session-info { margin-top: 24px; color: var(--text-hint); font-size: 14px; }
.counter-actions { margin-top: 24px; display: flex; gap: 16px; }
.start-btn, .end-btn {
  padding: 12px 32px; border: none; border-radius: var(--radius-lg); cursor: pointer;
  font-size: 16px; font-weight: 600;
}
.start-btn { background: var(--primary-color); color: white; }
.end-btn { background: var(--accent-color); color: white; }
</style>
