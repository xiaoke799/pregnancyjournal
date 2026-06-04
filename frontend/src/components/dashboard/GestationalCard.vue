<template>
  <div class="gestational-card">
    <div class="card-bg" :class="'stage-' + (age?.stageKey ?? 'unknown')">
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

const { age, displayText, countdownText, trimesterText } = useGestationalAge()
</script>

<style scoped>
.gestational-card { margin-bottom: 20px; }
.card-bg {
  border-radius: 20px; padding: 32px; color: white; text-align: center;
  box-shadow: 0 4px 20px rgba(232, 160, 191, 0.3);
  background: linear-gradient(135deg, #E8A0BF, #7C3AED);
}
.card-bg.stage-early { background: linear-gradient(135deg, #43A047, #66BB6A); }
.card-bg.stage-mid { background: linear-gradient(135deg, #1E88E5, #42A5F5); }
.card-bg.stage-late { background: linear-gradient(135deg, #8E24AA, #AB47BC); }
.card-bg.stage-preparing { background: linear-gradient(135deg, #FF7043, #FFA726); }
.card-bg.stage-nursing { background: linear-gradient(135deg, #5C6BC0, #7986CB); }
.card-content { display: flex; flex-direction: column; align-items: center; }
.week-display { font-size: 36px; font-weight: 800; margin-bottom: 8px; }
.countdown { font-size: 16px; opacity: 0.9; margin-bottom: 12px; }
.trimester-badge {
  display: inline-block; background: rgba(255,255,255,0.2);
  padding: 4px 16px; border-radius: 20px; font-size: 14px;
}
</style>
