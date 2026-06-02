<template>
  <div class="gestational-card">
    <div class="card-bg">
      <div class="card-content">
        <div class="week-display">{{ displayText }}</div>
        <div class="countdown">{{ countdownText }}</div>
        <div class="trimester-badge">{{ trimesterText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGestationalAge } from '@/composables/useGestationalAge'

const { displayText, countdownText, trimesterText } = useGestationalAge()
</script>

<style scoped>
.gestational-card { margin-bottom: 20px; }
.card-bg {
  background: linear-gradient(135deg, #E8A0BF, #7C3AED);
  border-radius: 20px; padding: 32px; color: white; text-align: center;
  box-shadow: 0 4px 20px rgba(232, 160, 191, 0.3);
}
.card-content { display: flex; flex-direction: column; align-items: center; }
.week-display { font-size: 36px; font-weight: 800; margin-bottom: 8px; }
.countdown { font-size: 16px; opacity: 0.9; margin-bottom: 12px; }
.trimester-badge {
  display: inline-block; background: rgba(255,255,255,0.2);
  padding: 4px 16px; border-radius: 20px; font-size: 14px;
}
</style>
