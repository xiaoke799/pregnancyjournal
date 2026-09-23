<template>
  <div class="fetal-counter">
    <div class="counter-header">
      <button class="close-btn" @click="goBack">✕ 关闭</button>
      <h2>🦶 胎动计数</h2>
    </div>

    <div class="counter-main">
      <div class="count-display">{{ counter.kickCount }}</div>
      <p class="count-label">胎动次数</p>

      <button class="kick-button" @click="counter.recordKick" :disabled="!counter.isRunning">
        记录胎动
      </button>

      <div class="session-info" v-if="counter.startTime">
        <span>开始时间：{{ counter.startTime }}</span>
      </div>
    </div>

    <div class="counter-actions">
      <button v-if="!counter.isRunning" class="start-btn" @click="startCounting">开始计数</button>
      <button v-else class="end-btn" @click="endCounting">结束计数</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useFetalMovementCounter } from '@/composables/useFetalMovementCounter'

const router = useRouter()
const pregnancyStore = usePregnancyStore()
const counter = useFetalMovementCounter()

function goBack() { router.push('/') }

async function startCounting() {
  if (pregnancyStore.currentPregnancy) {
    await counter.startSession(pregnancyStore.currentPregnancy.id)
  }
}

async function endCounting() {
  await counter.endSession()
  router.push('/')
}

onUnmounted(() => { counter.reset() })
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
  background: white; font-size: 20px; font-weight: 600; color: var(--primary-color);
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
