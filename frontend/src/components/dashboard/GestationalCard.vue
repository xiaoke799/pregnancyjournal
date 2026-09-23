<template>
  <div class="gestational-card">
    <div class="card-bg" :class="'stage-' + (age?.stageKey ?? 'unknown')">
      <span class="orb orb-1"></span>
      <span class="orb orb-2"></span>
      <span class="orb orb-3"></span>
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
  position: relative;
  border-radius: var(--radius-2xl, 28px);
  padding: 36px 28px;
  color: white;
  text-align: center;
  overflow: hidden;
  box-shadow: var(--glow-pink-strong, 0 10px 30px rgba(196, 70, 128, 0.28));
  background: linear-gradient(135deg, #ff9ec0 0%, #c44680 100%);
  isolation: isolate;
}

.card-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.2) 0%, transparent 40%),
    radial-gradient(circle at 80% 80%, rgba(255, 255, 255, 0.12) 0%, transparent 45%);
  pointer-events: none;
  z-index: 0;
}

.card-bg.stage-early {
  background: linear-gradient(135deg, #ffc784 0%, #ff9a52 100%);
  box-shadow: 0 10px 30px rgba(255, 154, 82, 0.28);
}
.card-bg.stage-mid {
  background: linear-gradient(135deg, #7dd0f4 0%, #2196d4 100%);
  box-shadow: 0 10px 30px rgba(33, 150, 212, 0.28);
}
.card-bg.stage-late {
  background: linear-gradient(135deg, #ff9ec0 0%, #c44680 100%);
  box-shadow: 0 10px 30px rgba(196, 70, 128, 0.28);
}
.card-bg.stage-preparing {
  background: linear-gradient(135deg, #cbb8e0 0%, #8a7bb3 100%);
  box-shadow: 0 10px 30px rgba(138, 123, 179, 0.28);
}
.card-bg.stage-nursing {
  background: linear-gradient(135deg, #97e3a8 0%, #5bbe70 100%);
  box-shadow: 0 10px 30px rgba(91, 190, 112, 0.28);
}

/* 装饰光球 */
.orb {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  filter: blur(2px);
  pointer-events: none;
  z-index: 0;
}
.orb-1 {
  width: 120px;
  height: 120px;
  top: -40px;
  right: -30px;
  background: rgba(255, 255, 255, 0.22);
  animation: drift 8s ease-in-out infinite;
}
.orb-2 {
  width: 80px;
  height: 80px;
  bottom: -20px;
  left: -10px;
  background: rgba(255, 255, 255, 0.14);
  animation: drift 10s ease-in-out infinite reverse;
}
.orb-3 {
  width: 36px;
  height: 36px;
  top: 25%;
  left: 15%;
  background: rgba(255, 255, 255, 0.3);
  animation: drift 6s ease-in-out infinite;
  animation-delay: -2s;
}

@keyframes drift {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(8px, -10px); }
}

.card-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.week-display {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 10px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  font-variant-numeric: tabular-nums;
}

.countdown {
  font-size: 15px;
  opacity: 0.92;
  margin-bottom: 14px;
  letter-spacing: 0.3px;
}

.trimester-badge {
  display: inline-block;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 5px 18px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

@media (max-width: 480px) {
  .card-bg { padding: 28px 20px; border-radius: var(--radius-xl, 20px); }
  .week-display { font-size: 32px; }
  .countdown { font-size: 14px; }
}
</style>
