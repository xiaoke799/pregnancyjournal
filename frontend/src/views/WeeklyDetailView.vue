<template>
  <div class="weekly-detail-view">
    <!-- ===== 周导航 ===== -->
    <div class="wd-nav">
      <button class="wd-nav-btn" @click="shiftWeek(-1)" :disabled="displayWeek <= MIN_WEEK" aria-label="上一周">‹</button>
      <div class="wd-week-label">
        <span class="wd-week-num">第 {{ displayWeek }} 周</span>
        <button v-if="!isCurrentWeek" class="wd-back-btn" @click="goCurrentWeek">回到本周</button>
      </div>
      <button class="wd-nav-btn" @click="shiftWeek(1)" :disabled="displayWeek >= MAX_WEEK" aria-label="下一周">›</button>
    </div>

    <div v-if="!hasGestationalAge && isCurrentWeek" class="wd-hint">
      设置孕周后将自动定位到当前周 · 可先用左右按钮浏览
    </div>

    <!-- ===== 生理数据 ===== -->
    <div class="wd-stats">
      <div class="wd-stat">
        <span class="wd-stat-value">{{ entry.size }}</span>
        <span class="wd-stat-label">大小类比（趣味参考）</span>
      </div>
      <div class="wd-stat">
        <span class="wd-stat-value">{{ entry.lengthText }}</span>
        <span class="wd-stat-label">{{ entry.lengthLabel }}</span>
      </div>
      <div class="wd-stat" v-if="entry.weightText">
        <span class="wd-stat-value">{{ entry.weightText }}</span>
        <span class="wd-stat-label">平均体重</span>
      </div>
    </div>

    <!-- ===== 宝宝变化 ===== -->
    <section class="wd-block baby">
      <div class="wd-block-title">
        <span class="wd-block-icon">👶</span>
        <strong>宝宝变化</strong>
      </div>
      <p class="wd-text">{{ entry.baby }}</p>
      <ul class="wd-points">
        <li v-for="(p, i) in entry.babyPoints" :key="'b' + i">{{ p }}</li>
      </ul>
    </section>

    <!-- ===== 妈妈变化 ===== -->
    <section class="wd-block mom">
      <div class="wd-block-title">
        <span class="wd-block-icon">🤰</span>
        <strong>妈妈变化</strong>
      </div>
      <p class="wd-text">{{ entry.mom }}</p>
      <ul class="wd-points">
        <li v-for="(p, i) in entry.momPoints" :key="'m' + i">{{ p }}</li>
      </ul>
    </section>

    <!-- ===== 本周小贴士 ===== -->
    <section class="wd-block tip">
      <div class="wd-block-title">
        <span class="wd-block-icon">💡</span>
        <strong>本周小贴士</strong>
      </div>
      <p class="wd-text">{{ entry.tip }}</p>
    </section>

    <div class="wd-footnote">
      身长体重为人群平均值，个体差异较大（孕20周前为头臀长、20周起为头脚长）；发育进度以产检超声评估为准。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useGestationalAge } from '@/composables/useGestationalAge'
import { MIN_WEEK, MAX_WEEK, getWeekEntry } from '@/data/weekly-development'

const route = useRoute()
const { age } = useGestationalAge()
const hasGestationalAge = computed(() => !!age.value && !age.value.isPrePregnancy && !age.value.isOverdue)

/** 当前实际孕周（钳制在 4~40）；浏览用的周数，默认跟随实际孕周 */
const currentRealWeek = computed(() => {
  const w = age.value?.weeks ?? 0
  return Math.min(Math.max(w, MIN_WEEK), MAX_WEEK)
})

/** 入口卡带 ?week=N 进来时定位到该周，否则跟随实际孕周 */
const queryWeek = (() => {
  const q = Number(route.query.week)
  if (Number.isFinite(q) && q >= MIN_WEEK && q <= MAX_WEEK) return Math.round(q)
  return null
})()
const browsingWeek = ref<number | null>(queryWeek)
const displayWeek = computed(() => browsingWeek.value ?? currentRealWeek.value)
const isCurrentWeek = computed(() => browsingWeek.value === null)

// 孕周变化时（跨天/数据加载）清掉浏览态，回到本周
watch(currentRealWeek, () => { browsingWeek.value = null })

function shiftWeek(delta: number) {
  const next = displayWeek.value + delta
  if (next < MIN_WEEK || next > MAX_WEEK) return
  browsingWeek.value = next
}
function goCurrentWeek() { browsingWeek.value = null }

const entry = computed(() => getWeekEntry(displayWeek.value))
</script>

<style scoped>
.weekly-detail-view {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--space-4) 0 var(--space-8);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 周导航 ===== */
.wd-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  border: 1px solid var(--border-color-soft);
  border-radius: 14px;
  padding: 12px 16px;
}
.wd-week-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.wd-week-num {
  font-size: 17px;
  font-weight: 800;
  color: var(--primary-color);
}
.wd-back-btn {
  border: none;
  background: none;
  color: var(--info-color);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
}
.wd-nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--border-color-soft);
  background: var(--bg-tint-pink);
  color: var(--primary-color);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--transition-fast);
}
.wd-nav-btn:not(:disabled):active { transform: scale(0.92); }
.wd-nav-btn:disabled { opacity: 0.35; cursor: default; }

.wd-hint {
  font-size: 12px;
  color: var(--text-hint);
  background: var(--bg-tint-cream);
  border-radius: 8px;
  padding: 8px 12px;
}

/* ===== 生理数据 ===== */
.wd-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.wd-stat {
  flex: 1;
  min-width: 140px;
  background: var(--bg-card);
  border: 1px solid var(--border-color-soft);
  border-radius: 12px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wd-stat-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--primary-color);
}
.wd-stat-label {
  font-size: 11px;
  color: var(--text-hint);
}

/* ===== 内容块 ===== */
.wd-block {
  border-radius: 12px;
  padding: 14px 16px;
}
.wd-block.baby { background: var(--bg-tint-blue); border-left: 4px solid var(--info-color); }
.wd-block.mom  { background: var(--bg-tint-pink); border-left: 4px solid var(--primary-color); }
.wd-block.tip  { background: var(--bg-tint-cream); border-left: 4px solid var(--warning-color); }

.wd-block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.wd-block-title strong {
  font-size: 15px;
  color: var(--text-color);
}
.wd-block-icon { font-size: 17px; }

.wd-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color);
  margin: 0 0 8px;
}

.wd-points {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wd-points li {
  position: relative;
  padding-left: 18px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.wd-points li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 0.62em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary-color);
}
.wd-block.baby .wd-points li::before { background: var(--info-color); }
.wd-block.tip  .wd-points li::before { background: var(--warning-color); }
.wd-block.tip .wd-text { margin-bottom: 0; }

.wd-footnote {
  font-size: 11px;
  color: var(--text-hint);
  line-height: 1.6;
  padding: 0 4px;
}
</style>
