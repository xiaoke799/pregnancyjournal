<template>
  <div class="dashboard-view">
    <!-- ===== 信息看板（基于预产期实时修正） ===== -->
    <div class="countdown-card" :class="'stage-' + realtimeStageKey">
      <span class="orb orb-1"></span>
      <span class="orb orb-2"></span>
      <span class="orb orb-3"></span>
      <div class="countdown-top">
        <div class="countdown-label">{{ countdownLabel }}</div>
        <div class="countdown-row">
          <span class="countdown-num">{{ realtimeDaysUntilDue }}</span>
          <span class="countdown-unit">天</span>
        </div>
      </div>
      <div class="countdown-meta">
        <span>{{ realtimeAgeDisplay }}</span>
        <span class="meta-dot">·</span>
        <span>{{ realtimeTrimesterText }}</span>
        <span class="meta-dot" v-if="realtimeDueDate">·</span>
        <span v-if="realtimeDueDate">预产期 {{ realtimeDueDate }}</span>
      </div>
    </div>

    <!-- ===== 提醒看板（未来一个月） ===== -->
    <div class="section reminder-board">
      <div class="section-header">
        <h3>📌 提醒看板</h3>
        <div class="header-actions">
          <span class="section-hint" v-if="todayTodos.length">未来30天 · {{ todayTodos.length }} 项</span>
          <n-button size="tiny" :loading="pushing" @click="pushToWecom" v-if="todayTodos.length">推送微信</n-button>
        </div>
      </div>
      <div v-if="todayTodos.length === 0" class="empty-hint">暂无提醒，快添加一条吧</div>
      <div v-else class="plan-list">
        <div v-for="item in todayTodos" :key="item.id" class="plan-item" :class="{ 'is-today': item.days_until === 0, 'is-past': (item.days_until || 0) < 0 }">
          <span class="plan-icon">{{ todoIcon(item) }}</span>
          <div class="plan-body">
            <span class="plan-title">{{ item.name || item.title || '提醒' }}</span>
            <span class="plan-meta" v-if="item.trigger_date || item.days_until != null">
              <template v-if="item.days_until != null">
                {{ formatDaysUntil(item.days_until) }}
              </template>
              <template v-else>{{ formatCountdown(item.trigger_date) }}</template>
              <template v-if="item.trigger_date && item.days_until !== 0"> · {{ item.trigger_date.slice(5) }}</template>
            </span>
          </div>
          <n-button size="tiny" quaternary type="primary" @click="completeTodo(item)">完成</n-button>
        </div>
      </div>
      <div class="quick-add-row">
        <n-input
          v-model:value="newTodoTitle"
          placeholder="添加提醒..."
          size="small"
          @keyup.enter="quickAddReminder"
          :disabled="adding"
        />
        <n-date-picker
          v-model:formatted-value="newTodoDate"
          type="date"
          value-format="YYYY-MM-DD"
          size="small"
          style="width: 130px"
        />
        <n-time-picker
          v-model:formatted-value="newTodoTime"
          format="HH:mm"
          size="small"
          style="width: 100px"
          placeholder="--:--"
        />
        <n-button type="primary" size="small" :loading="adding" @click="quickAddReminder" :disabled="!newTodoTitle.trim()">添加</n-button>
      </div>
    </div>

    <!-- ===== 今日记录 ===== -->
    <div class="section record-section">
      <div class="section-header">
        <h3>📊 今日记录</h3>
        <router-link :to="{ path: '/record', query: { date: todayStr } }" class="view-all">
          {{ dashboardData?.has_today_record ? '查看详情 →' : '去记录 →' }}
        </router-link>
      </div>
      <div v-if="todayRecord && Object.keys(todayRecord).length > 1" class="record-content">
        <div class="record-primary">
          <div class="rg-cell primary" v-if="todayRecord.weight != null">
            <span class="rg-icon">⚖️</span>
            <span class="rg-val">{{ todayRecord.weight }}<small>kg</small></span>
            <span class="rg-label">体重</span>
          </div>
          <div class="rg-cell primary" v-if="todayRecord.mood != null">
            <span class="rg-icon">{{ moodEmoji(todayRecord.mood) }}</span>
            <span class="rg-val">{{ moodLabel(todayRecord.mood) }}</span>
            <span class="rg-label">心情</span>
          </div>
          <div class="rg-cell primary" v-if="todayRecord.fetal_heart_rate != null">
            <span class="rg-icon">💓</span>
            <span class="rg-val">{{ todayRecord.fetal_heart_rate }}<small>bpm</small></span>
            <span class="rg-label">胎心</span>
          </div>
          <div class="rg-cell primary" v-if="todayRecord.sleep_hours != null">
            <span class="rg-icon">😴</span>
            <span class="rg-val">{{ todayRecord.sleep_hours }}<small>h</small></span>
            <span class="rg-label">睡眠</span>
          </div>
        </div>
        <div class="record-secondary">
          <!-- 生命体征组 -->
          <template v-if="hasVitals">
            <div class="rs-group-label">🫀 生命体征</div>
            <div class="rs-row">
              <div class="rs-item" v-if="todayRecord.blood_pressure_systolic">
                <span class="rs-icon">❤️</span>
                <span>血压 {{ todayRecord.blood_pressure_systolic }}/{{ todayRecord.blood_pressure_diastolic }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.body_temperature">
                <span class="rs-icon">🌡️</span>
                <span>体温 {{ todayRecord.body_temperature }}°C</span>
              </div>
            </div>
          </template>
          <!-- 血糖组 -->
          <template v-if="hasGlucose">
            <div class="rs-group-label">🩸 血糖</div>
            <div class="rs-row">
              <div class="rs-item" v-if="todayRecord.blood_glucose_fasting">
                <span>空腹 {{ todayRecord.blood_glucose_fasting }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.blood_glucose_1h">
                <span>餐后1h {{ todayRecord.blood_glucose_1h }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.blood_glucose_2h">
                <span>餐后2h {{ todayRecord.blood_glucose_2h }}</span>
              </div>
            </div>
          </template>
          <!-- 运动饮水组 -->
          <template v-if="todayRecord.exercise_type || todayRecord.water_intake || todayRecord.diet_note">
            <div class="rs-group-label">🏃 生活习惯</div>
            <div class="rs-row">
              <div class="rs-item" v-if="todayRecord.exercise_type">
                <span class="rs-icon">🏃</span>
                <span>{{ todayRecord.exercise_type }}{{ todayRecord.exercise_duration ? ' ' + todayRecord.exercise_duration + 'min' : '' }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.water_intake">
                <span class="rs-icon">💧</span>
                <span>饮水 {{ todayRecord.water_intake }}ml</span>
              </div>
              <div class="rs-item" v-if="todayRecord.diet_note">
                <span class="rs-icon">🍽️</span>
                <span class="rs-note">{{ todayRecord.diet_note }}</span>
              </div>
            </div>
          </template>
          <!-- 检查数据组 -->
          <template v-if="hasCheckData">
            <div class="rs-group-label">🔬 检查数据</div>
            <div class="rs-row">
              <div class="rs-item" v-if="todayRecord.fetal_movement_count">
                <span class="rs-icon">👶</span>
                <span>胎动 {{ todayRecord.fetal_movement_count }}次{{ todayRecord.fetal_movement_duration ? ' ·' + todayRecord.fetal_movement_duration + 'min' : '' }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.contraction_duration">
                <span class="rs-icon">⏱️</span>
                <span>宫缩 {{ todayRecord.contraction_duration }}s{{ todayRecord.contraction_interval ? ' ·间隔' + todayRecord.contraction_interval + 'min' : '' }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.uric_acid != null">
                <span class="rs-icon">🧪</span>
                <span>尿酸 {{ todayRecord.uric_acid }} μmol/L</span>
              </div>
              <div class="rs-item" v-if="todayRecord.hcg_value != null">
                <span class="rs-icon">🧬</span>
                <span>HCG {{ todayRecord.hcg_value }}</span>
              </div>
            </div>
          </template>
          <!-- 其他记录 -->
          <template v-if="hasOtherRecords">
            <div class="rs-group-label">📋 其他</div>
            <div class="rs-row">
              <div class="rs-item" v-if="todayRecord.edema_level && todayRecord.edema_level !== 'none'">
                <span class="rs-icon">🦶</span>
                <span>水肿 {{ edemaLabel(todayRecord.edema_level) }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.plan_text">
                <span class="rs-icon">📌</span>
                <span class="rs-note">{{ todayRecord.plan_text }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.habit_text">
                <span class="rs-icon">✅</span>
                <span>{{ todayRecord.habit_text }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.sleep_quality && todayRecord.sleep_quality !== 'fair'">
                <span class="rs-icon">😴</span>
                <span>睡眠质量 {{ sleepQualityLabel(todayRecord.sleep_quality) }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.medication">
                <span class="rs-icon">💊</span>
                <span class="rs-note">{{ parseJsonText(todayRecord.medication) }}</span>
              </div>
              <div class="rs-item" v-if="todayRecord.intimacy_record || todayRecord.intimacy_note">
                <span class="rs-icon">💑</span>
                <span>爱爱 {{ todayRecord.intimacy_record || todayRecord.intimacy_note }}</span>
              </div>
            </div>
          </template>
        </div>
        <div class="record-symptoms" v-if="parseSymptoms(todayRecord.symptoms).length">
          <span class="symptom-tag" v-for="s in parseSymptoms(todayRecord.symptoms)" :key="s">{{ s }}</span>
        </div>
        <div class="record-note" v-if="todayRecord.note">
          <span class="note-label">📝 备注：</span>{{ todayRecord.note }}
        </div>
      </div>
      <router-link v-else :to="{ path: '/record', query: { date: todayStr } }" class="empty-record">
        <span class="empty-icon">📝</span>
        <span>今天还没有记录</span>
        <span class="empty-cta">点击去记录 →</span>
      </router-link>
    </div>

    <!-- ===== 宝宝成长曲线 ===== -->
    <div class="section" v-if="fetalCurveData.length > 0">
      <div class="section-header">
        <h3>👶 宝宝成长曲线</h3>
        <span class="section-hint">第 {{ gestationalAge?.weeks }} 周</span>
      </div>
      <div class="dev-brief" v-if="development">
        <span class="dev-chip">{{ development.size }}</span>
        <span class="dev-chip">{{ development.weight }}</span>
        <span class="dev-chip" v-if="development.length_cm">{{ development.length_cm }}cm</span>
      </div>
      <div class="chart-wrap">
        <v-chart :option="growthChartOption" :autoresize="true" style="height: 260px" />
      </div>
    </div>

    <!-- ===== 产检建议 ===== -->
    <div class="section" v-if="recommendedTodos.length > 0">
      <div class="section-header">
        <h3>🏥 产检建议</h3>
        <router-link to="/checkup-schedule" class="view-all">全部 →</router-link>
      </div>
      <div class="checkup-list">
        <div v-for="item in recommendedTodos" :key="item.id" class="checkup-item">
          <div class="ci-week">{{ item.week_range }}周</div>
          <div class="ci-body">
            <div class="ci-name">
              {{ item.name }}
              <n-tag v-if="item.is_mandatory" size="tiny" type="error" :bordered="false">必检</n-tag>
              <n-tag v-else size="tiny" type="warning" :bordered="false">选检</n-tag>
            </div>
            <div class="ci-meta">{{ item.due_hint }}</div>
          </div>
          <div class="ci-status" :class="item.days_until != null && item.days_until < 0 ? 'past' : item.days_until <= 14 ? 'soon' : ''">
            {{ formatDaysUntil(item.days_until) }}
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 准备清单 ===== -->
    <div class="section" v-if="checklistProgress && checklistProgress.total > 0">
      <div class="section-header">
        <h3>📋 准备清单</h3>
        <router-link to="/checklist" class="view-all">查看全部 →</router-link>
      </div>
      <div class="cl-bar-outer mandatory">
        <div class="cl-bar-fill" :style="{ width: (checklistProgress.mandatory_percentage || 0) + '%' }"></div>
      </div>
      <div class="cl-summary">
        🔥 必备 {{ checklistProgress.mandatory_checked || 0 }}/{{ checklistProgress.mandatory_total || 0 }}
        <strong>{{ checklistProgress.mandatory_percentage || 0 }}%</strong>
        <span class="cl-sub"> · 全部 {{ checklistProgress.checked }}/{{ checklistProgress.total }}</span>
      </div>
    </div>

    <!-- ===== 最近产检 ===== -->
    <div class="section" v-if="lastCheckup">
      <div class="section-header">
        <h3>🏥 最近产检</h3>
        <router-link to="/checkup-schedule" class="view-all">全部 →</router-link>
      </div>
      <div class="lc-row">
        <div>
          <span class="lc-type">{{ lastCheckup.checkup_type }}</span>
          <span class="lc-date">{{ formatDate(lastCheckup.checkup_date) }}</span>
        </div>
        <span class="lc-week">孕{{ lastCheckup.gestational_week }}周</span>
      </div>
    </div>

    <!-- ===== 核心功能入口（底部） ===== -->
    <div class="section core-features">
      <div class="section-header">
        <h3>🎯 核心功能</h3>
      </div>
      <div class="core-grid">
        <router-link to="/record" class="core-card core-record">
          <span class="core-icon">📝</span>
          <span class="core-label">记录</span>
          <span class="core-desc" v-if="dashboardData?.has_today_record">今日已记录</span>
          <span class="core-desc" v-else>今日未记录</span>
        </router-link>
        <router-link to="/diet" class="core-card core-diet">
          <span class="core-icon">🍎</span>
          <span class="core-label">饮食</span>
          <span class="core-desc">今日吃什么</span>
        </router-link>
        <router-link to="/diary" class="core-card core-diary">
          <span class="core-icon">📖</span>
          <span class="core-label">日记</span>
          <span class="core-desc">记录孕期点滴</span>
        </router-link>
        <router-link to="/checkup-schedule" class="core-card core-checkup">
          <span class="core-icon">🏥</span>
          <span class="core-label">产检</span>
          <span class="core-desc" v-if="upcomingCheckupCount">{{ upcomingCheckupCount }}项待完成</span>
          <span class="core-desc" v-else>查看产检计划</span>
        </router-link>
        <router-link to="/settings" class="core-card core-settings">
          <span class="core-icon">⚙️</span>
          <span class="core-label">设置</span>
          <span class="core-desc">数据与管理</span>
        </router-link>
      </div>
    </div>

    <div style="height: 80px"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NInput, NButton, NTag, NDatePicker, NTimePicker, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useGestationalAge } from '@/composables/useGestationalAge'
import { getDashboard } from '@/api/dashboard'
import { reminderApi } from '@/api/reminder'
import { wecomApi } from '@/api/wecom'
import { calculateGestationalAge } from '@/utils/gestational'
import dayjs from 'dayjs'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer])
const pregnancyStore = usePregnancyStore()
const message = useMessage()

// ====== 实时孕周数据（基于预产期自动修正） ======
const {
  age: realtimeAge,
  daysUntilDue: realtimeDaysUntilDue,
  dueDate: realtimeDueDate,
  trimesterText: realtimeTrimesterText,
  stageKey: realtimeStageKey,
} = useGestationalAge()

/** 倒计时标签文字（根据状态动态变化）。 */
const countdownLabel = computed(() => {
  if (!realtimeAge.value) return '距离预产期'
  if (realtimeAge.value.isPrePregnancy) return '距预产期'
  if (realtimeAge.value.isOverdue) return '已过预产期'
  return '距离预产期'
})

/** 孕周显示文字（处理负数/边界情况）。 */
const realtimeAgeDisplay = computed(() => {
  if (!realtimeAge.value) return '--周--天'
  const a = realtimeAge.value
  if (a.isPrePregnancy) {
    // 备孕期：显示距离末次月经天数
    const absDays = Math.abs(a.totalDays)
    return `备孕期 · 距末次月经约${absDays}天`
  }
  if (a.isOverdue) {
    return `已过预产期 ${Math.abs(a.daysUntilDue)} 天`
  }
  return `${a.weeks}周${a.days}天`
})

const dashboardData = ref<any>(null)
const loading = ref(false)
const newTodoTitle = ref('')
const newTodoDate = ref<string>(dayjs().format('YYYY-MM-DD'))
const newTodoTime = ref<string>('')
const adding = ref(false)
const pushing = ref(false)

function toStageKey(trimester?: string): 'early' | 'mid' | 'late' {
  if (trimester === 'early' || trimester === '孕早期') return 'early'
  if (trimester === 'mid' || trimester === '孕中期') return 'mid'
  return 'late'
}

function isValidAge(age: { weeks: number; days: number } | null | undefined): boolean {
  return !!age && (age.weeks > 0 || age.days > 0)
}

const gestationalAge = computed(() => {
  const storeAge = pregnancyStore.gestationalAge
  if (isValidAge(storeAge)) {
    return { weeks: storeAge!.weeks, days: storeAge!.days, trimester: storeAge!.trimester }
  }
  const ga = dashboardData.value?.gestational_age
  if (isValidAge(ga)) {
    return { weeks: ga.weeks, days: ga.days, trimester: ga.trimester }
  }
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  if (lmp) {
    const local = calculateGestationalAge(lmp)
    return { weeks: local.weeks, days: local.days, trimester: local.trimester }
  }
  return null
})

const dueDate = computed(() => {
  const p = pregnancyStore.currentPregnancy
  return p?.due_date || p?.dueDate || null
})
const daysUntilDue = computed(() => {
  if (dashboardData.value?.gestational_age?.days_until_due != null) {
    return dashboardData.value.gestational_age.days_until_due
  }
  if (pregnancyStore.gestationalAge?.daysUntilDue != null) {
    return pregnancyStore.gestationalAge.daysUntilDue
  }
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  if (lmp) {
    return calculateGestationalAge(lmp).daysUntilDue
  }
  return 0
})

const stageKey = computed<'early' | 'mid' | 'late'>(() => {
  if (dashboardData.value?.gestational_age?.stage_key) {
    return dashboardData.value.gestational_age.stage_key
  }
  return toStageKey(gestationalAge.value?.trimester)
})

const trimesterText = computed(() => {
  const t = gestationalAge.value?.trimester
  if (t === 'early' || t === '孕早期') return '孕早期'
  if (t === 'mid' || t === '孕中期') return '孕中期'
  if (t === 'late' || t === '孕晚期') return '孕晚期'
  return '孕早期'
})

const todayRecord = computed(() => dashboardData.value?.today_record)
const development = computed(() => dashboardData.value?.development)
const lastCheckup = computed(() => dashboardData.value?.last_checkup)
const checklistProgress = computed(() => dashboardData.value?.checklist_progress)

const todayTodos = computed(() => dashboardData.value?.today_todos || [])
const recommendedTodos = computed(() => dashboardData.value?.recommended_todos || [])
const upcomingCheckupCount = computed(() => recommendedTodos.value.filter((t: any) => t.days_until == null || t.days_until >= 0).length)

const fetalCurveData = computed(() => dashboardData.value?.fetal_development_curve || [])
const weightHistory = computed(() => dashboardData.value?.weight_history || [])

const growthChartOption = computed(() => {
  const currentWeek = gestationalAge.value?.weeks || 0
  const curve = fetalCurveData.value as any[]
  const weeks = curve.map((d: any) => d.week + '周')
  const fetalWeights = curve.map((d: any) => d.weight_g)

  const motherData: any[] = []
  const wh = weightHistory.value as any[]
  if (wh.length > 0 && lmpDate.value) {
    const lmp = dayjs(lmpDate.value)
    wh.forEach((r: any) => {
      const recDate = dayjs(r.date)
      const diffDays = recDate.diff(lmp, 'day')
      if (diffDays >= 0) {
        const w = Math.floor(diffDays / 7)
        motherData.push({ week: w, weight: r.weight })
      }
    })
  }

  const motherWeights: (number | null)[] = weeks.map((_: string, i: number) => {
    const wk = curve[i]?.week
    const match = motherData.find((m: any) => m.week === wk)
    return match ? match.weight : null
  })

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#eee',
      textStyle: { fontSize: 12 },
      formatter: (params: any) => {
        let tip = params[0]?.axisValue || ''
        params.forEach((p: any) => {
          if (p.value != null) {
            const unit = p.seriesName === '宝宝体重' ? 'g' : 'kg'
            tip += `<br/>${p.marker} ${p.seriesName}：${p.value}${unit}`
          }
        })
        return tip
      },
    },
    legend: {
      bottom: 0,
      textStyle: { fontSize: 11, color: '#888' },
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 45, right: 45, top: 16, bottom: 36 },
    xAxis: {
      type: 'category',
      data: weeks,
      axisLabel: {
        fontSize: 10,
        color: '#999',
        interval: (i: number) => i % 4 === 0 || curve[i]?.week === currentWeek,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: [
      {
        type: 'value',
        name: '宝宝(g)',
        nameTextStyle: { fontSize: 10, color: '#AB47BC' },
        axisLabel: { fontSize: 10, color: '#AB47BC' },
        splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } },
      },
      {
        type: 'value',
        name: '妈妈(kg)',
        nameTextStyle: { fontSize: 10, color: '#E8A0BF' },
        axisLabel: { fontSize: 10, color: '#E8A0BF' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '宝宝体重',
        type: 'line',
        yAxisIndex: 0,
        data: fetalWeights,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#AB47BC', width: 2 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(171,71,188,0.2)' },
              { offset: 1, color: 'rgba(171,71,188,0.02)' },
            ],
          },
        },
        markLine: currentWeek > 0 ? {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#E8A0BF', type: 'dashed', width: 1.5 },
          data: [{ xAxis: (currentWeek - 1) + '周' }],
          label: { show: true, formatter: '当前', fontSize: 10, color: '#E8A0BF' },
        } : undefined,
      },
      {
        name: '妈妈体重',
        type: 'line',
        yAxisIndex: 1,
        data: motherWeights,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#E8A0BF', width: 2 },
        itemStyle: { color: '#E8A0BF' },
      },
    ],
  }
})

function moodEmoji(mood: number): string {
  const emojis = ['', '😢', '😕', '😐', '🙂', '😄']
  return emojis[mood] || '😐'
}

function moodLabel(mood: number): string {
  const labels = ['', '很差', '不好', '一般', '不错', '很好']
  return labels[mood] || '--'
}

function formatDate(d: string | undefined): string {
  if (!d) return '--'
  return dayjs(d).format('MM-DD')
}

function formatShortDate(d: string | undefined): string {
  if (!d) return ''
  return dayjs(d).format('M/D')
}

/** 倒计时格式化：还有X天 / 今天 / 已过X天 */
function formatCountdown(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const d = dayjs(dateStr)
  const today = dayjs().startOf('day')
  const diff = d.diff(today, 'day')
  if (diff === 0) return '📍 今天'
  if (diff === 1) return '⏰ 明天'
  if (diff > 1 && diff <= 7) return `还有 ${diff} 天`
  if (diff > 7) return d.format('MM/DD') + ` (还有${diff}天)`
  if (diff < 0) return `已过 ${Math.abs(diff)} 天`
  return d.format('MM/DD')
}

function formatDaysUntil(days: number | null | undefined): string {
  if (days == null) return ''
  if (days < 0) return `已过${Math.abs(days)}天`
  if (days === 0) return '今天'
  if (days <= 7) return `${days}天后`
  return `${Math.ceil(days / 7)}周后`
}

function todoIcon(item: any): string {
  const t = item.type || item.source_type || ''
  if (t === 'checkup_reminder') return '🏥'
  if (t === 'custom_checkup') return '🏥'
  if (t === 'plan' || item.id === 'plan_today') return '📋'
  const icons: Record<string, string> = { manual: '📌', medication: '💊', exercise: '🏃', custom: '📌' }
  return icons[t] || '⏰'
}

const todayStr = dayjs().format('YYYY-MM-DD')

function parseSymptoms(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch { return raw ? [raw] : [] }
}

function parseJsonText(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(Boolean).join('、') : raw
  } catch { return raw }
}

function edemaLabel(level: string | undefined): string {
  const map: Record<string, string> = { mild: '轻度', moderate: '中度', severe: '重度' }
  return map[level || ''] || level || ''
}

function sleepQualityLabel(q: string): string {
  return q === 'good' ? '好' : q === 'poor' ? '差' : '一般'
}

// 分组可见性计算
const hasVitals = computed(() => {
  const r = todayRecord.value
  return !!(r?.blood_pressure_systolic || r?.body_temperature)
})
const hasGlucose = computed(() => {
  const r = todayRecord.value
  return !!(r?.blood_glucose_fasting || r?.blood_glucose_1h || r?.blood_glucose_2h)
})
const hasCheckData = computed(() => {
  const r = todayRecord.value
  return !!(r?.fetal_movement_count || r?.contraction_duration || r?.uric_acid != null || r?.hcg_value != null)
})
const hasOtherRecords = computed(() => {
  const r = todayRecord.value
  return !!((r?.edema_level && r.edema_level !== 'none') || r?.plan_text || r?.habit_text ||
    (r?.sleep_quality && r.sleep_quality !== 'fair') || r?.medication ||
    r?.intimacy_record || r?.intimacy_note)
})

const lmpDate = computed(() => pregnancyStore.currentPregnancy?.last_period_date)

async function completeTodo(item: any) {
  try {
    // 产检提醒和自定义产检不支持通过此按钮完成，跳转到产检页面
    if (item.type === 'checkup_reminder' || item.type === 'custom_checkup') {
      message.info('请前往产检页面标记完成')
      return
    }
    if (item.type === 'plan' || item.id === 'plan_today') {
      message.info('请在记录页完成计划')
      return
    }
    await reminderApi.complete(item.id)
    await loadDashboard()
    message.success('已完成')
  } catch { message.error('操作失败') }
}

async function quickAddReminder() {
  const title = newTodoTitle.value.trim()
  if (!title || !pregnancyStore.currentPregnancy) return
  adding.value = true
  try {
    // 组合日期和时间
    let triggerDate = newTodoDate.value || dayjs().format('YYYY-MM-DD')
    if (newTodoTime.value) {
      triggerDate = triggerDate + ' ' + newTodoTime.value
    }
    await reminderApi.create({
      pregnancy_id: pregnancyStore.currentPregnancy.id,
      title,
      trigger_date: triggerDate,
      priority: 'normal',
      source_type: 'manual',
    })
    newTodoTitle.value = ''
    newTodoTime.value = ''
    await loadDashboard()
    message.success('已添加')
  } catch { message.error('添加失败') }
  finally { adding.value = false }
}

async function pushToWecom() {
  if (!pregnancyStore.currentPregnancy) return
  pushing.value = true
  try {
    const res: any = await wecomApi.dailyPush(pregnancyStore.currentPregnancy.id)
    if (res.code === 0) message.success('每日看板已推送到微信')
    else if (res.code === 1002) message.warning(res.message || '推送失败')
    else message.info(res.message || '已发送请求')
  } catch (e: any) {
    message.error(e?.message || '推送失败，请检查企业微信配置')
  } finally { pushing.value = false }
}

async function loadDashboard() {
  if (!pregnancyStore.currentPregnancy) return
  loading.value = true
  try {
    const res: any = await getDashboard(pregnancyStore.currentPregnancy.id)
    if (res.code === 0) dashboardData.value = res.data
  } finally { loading.value = false }
}

onMounted(async () => {
  if (!pregnancyStore.currentPregnancy) {
    await pregnancyStore.fetchActivePregnancy()
  }
  loadDashboard()
})
watch(() => pregnancyStore.currentPregnancy?.id, (pid) => { if (pid) loadDashboard() })
</script>

<style scoped>
.dashboard-view { max-width: 680px; margin: 0 auto; padding: 16px; }

.countdown-card {
  position: relative;
  border-radius: var(--radius-2xl, 28px);
  padding: 32px 26px 24px;
  color: white;
  text-align: center;
  overflow: hidden;
  isolation: isolate;
  box-shadow: 0 10px 30px rgba(31, 23, 48, 0.14);
}
.countdown-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 28%, rgba(255, 255, 255, 0.22) 0%, transparent 42%),
    radial-gradient(circle at 82% 78%, rgba(255, 255, 255, 0.14) 0%, transparent 48%);
  pointer-events: none;
  z-index: 0;
}
.countdown-card > * {
  position: relative;
  z-index: 1;
}
.orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
}
.orb-1 {
  width: 140px; height: 140px;
  top: -50px; right: -40px;
  background: rgba(255, 255, 255, 0.2);
  filter: blur(2px);
  animation: drift 9s ease-in-out infinite;
}
.orb-2 {
  width: 90px; height: 90px;
  bottom: -28px; left: -16px;
  background: rgba(255, 255, 255, 0.14);
  filter: blur(2px);
  animation: drift 11s ease-in-out infinite reverse;
}
.orb-3 {
  width: 28px; height: 28px;
  top: 22%; left: 12%;
  background: rgba(255, 255, 255, 0.32);
  animation: drift 6s ease-in-out infinite;
  animation-delay: -3s;
}
@keyframes drift {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(8px, -10px); }
}

.countdown-card.stage-early {
  background: linear-gradient(135deg, #ffc784 0%, #ff9a52 100%);
  box-shadow: 0 12px 32px rgba(255, 154, 82, 0.32);
}
.countdown-card.stage-mid {
  background: linear-gradient(135deg, #7dd0f4 0%, #2196d4 100%);
  box-shadow: 0 12px 32px rgba(33, 150, 212, 0.3);
}
.countdown-card.stage-late {
  background: linear-gradient(135deg, #ff9ec0 0%, #c44680 100%);
  box-shadow: 0 12px 32px rgba(196, 70, 128, 0.3);
}
.countdown-card.stage-preparing {
  background: linear-gradient(135deg, #cbb8e0 0%, #8a7bb3 100%);
  box-shadow: 0 12px 32px rgba(138, 123, 179, 0.3);
}
.countdown-card.stage-nursing {
  background: linear-gradient(135deg, #97e3a8 0%, #5bbe70 100%);
  box-shadow: 0 12px 32px rgba(91, 190, 112, 0.3);
}
.countdown-top { margin-bottom: 10px; }
.countdown-label {
  font-size: 12.5px;
  opacity: 0.88;
  margin-bottom: 6px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: 600;
}
.countdown-row { display: flex; align-items: baseline; justify-content: center; gap: 6px; }
.countdown-num {
  font-size: 68px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.14);
  font-variant-numeric: tabular-nums;
}
.countdown-unit { font-size: 22px; font-weight: 600; opacity: 0.9; }
.countdown-meta {
  font-size: 13px;
  opacity: 0.92;
  margin-bottom: 4px;
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  letter-spacing: 0.2px;
}
.meta-dot { opacity: 0.5; }

.section {
  background: var(--bg-card, white);
  border-radius: var(--radius-lg, 16px);
  padding: 20px;
  margin-top: 14px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color-soft);
  transition: box-shadow var(--transition-base);
}
.section:hover {
  box-shadow: var(--shadow-md);
}
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.section-header h3 { font-size: 15.5px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.section-hint { font-size: 12px; color: var(--text-hint, #94a3b8); }
.view-all {
  font-size: 13px;
  color: var(--primary-color, #c44680);
  text-decoration: none;
  font-weight: 600;
  transition: opacity var(--transition-fast);
}
.view-all:hover { opacity: 0.75; }
.chart-wrap { margin: 0 -4px; }

/* 核心功能网格 */
.core-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}
.core-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 8px 16px;
  border-radius: var(--radius-lg, 16px);
  text-decoration: none;
  transition: transform var(--transition-base), box-shadow var(--transition-base);
  cursor: pointer;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid rgba(255, 255, 255, 0.5);
}
.core-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
}
.core-card > * {
  position: relative;
  z-index: 1;
}
.core-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}
.core-card:active {
  transform: translateY(-1px) scale(0.98);
}
.core-icon {
  font-size: 32px;
  line-height: 1;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.08));
  transition: transform var(--transition-base);
}
.core-card:hover .core-icon {
  transform: scale(1.12) rotate(-4deg);
}
.core-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
  letter-spacing: -0.01em;
}
.core-desc {
  font-size: 11px;
  color: var(--text-hint, #94a3b8);
  text-align: center;
}
.core-record { background: linear-gradient(135deg, #ffe8f0 0%, #ffc4d8 100%); }
.core-diet { background: linear-gradient(135deg, #fff3e0 0%, #ffd9a6 100%); }
.core-diary { background: linear-gradient(135deg, #ece7ff 0%, #c8c0f0 100%); }
.core-checkup { background: linear-gradient(135deg, #e0f5f1 0%, #a8e0d0 100%); }
.core-settings { background: linear-gradient(135deg, #f5e8ff 0%, #dcc0f0 100%); }

.dev-brief { display: flex; gap: 8px; margin-bottom: 10px; }
.dev-chip {
  padding: 4px 10px; border-radius: 8px; background: #f3e8ff; color: #7c3aed;
  font-size: 12px; font-weight: 600;
}

.empty-hint { text-align: center; color: var(--text-hint, #94a3b8); font-size: 13px; padding: 16px 0; }

.checkup-list { display: flex; flex-direction: column; gap: 8px; }
.checkup-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border-radius: 10px; background: #f0f9ff; border-left: 3px solid #3b82f6;
}
.ci-week {
  font-size: 12px; font-weight: 700; color: #3b82f6; white-space: nowrap;
  min-width: 48px; text-align: center; background: #dbeafe; padding: 4px 6px;
  border-radius: 6px;
}
.ci-body { flex: 1; min-width: 0; }
.ci-name { font-size: 13px; font-weight: 600; color: var(--text-color, #1e293b); display: flex; align-items: center; gap: 6px; }
.ci-meta { font-size: 11px; color: var(--text-hint, #94a3b8); margin-top: 2px; }
.ci-status { font-size: 11px; font-weight: 600; color: #94a3b8; white-space: nowrap; }
.ci-status.soon { color: #f59e0b; }
.ci-status.past { color: #ef4444; }

.plan-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.plan-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-radius: 10px; background: #f8fafc; transition: background .15s;
}
.plan-item:hover { background: #f1f5f9; }
.plan-item.is-today { background: #fef3c7; border-left: 3px solid #f59e0b; }
.plan-item.is-past { opacity: 0.6; }
.plan-icon { font-size: 18px; }
.plan-body { flex: 1; min-width: 0; }
.plan-title { font-size: 13px; font-weight: 600; color: var(--text-color, #1e293b); display: block; }
.plan-meta { font-size: 11px; color: var(--text-hint, #94a3b8); }
.header-actions { display: flex; align-items: center; gap: 8px; }

.quick-add-row { display: flex; gap: 8px; margin-top: 4px; }

.record-content { display: flex; flex-direction: column; gap: 10px; }
.record-primary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.rg-cell {
  display: flex; flex-direction: column; align-items: center; padding: 12px 8px;
  border-radius: 10px; background: #f8fafc; gap: 4px;
}
.rg-cell.primary { background: #fdf4ff; }
.rg-icon { font-size: 20px; }
.rg-val { font-size: 16px; font-weight: 700; color: var(--text-color, #1e293b); }
.rg-val small { font-size: 11px; font-weight: 500; color: var(--text-hint, #94a3b8); margin-left: 1px; }
.rg-label { font-size: 11px; color: var(--text-hint, #94a3b8); }

.record-secondary { display: flex; flex-direction: column; gap: 10px; }
.rs-group-label {
  font-size: 11px; font-weight: 600; color: var(--text-hint, #94a3b8);
  text-transform: uppercase; letter-spacing: 0.5px;
  padding-bottom: 2px; border-bottom: 1px solid #f1f5f9;
}
.rs-row { display: flex; flex-wrap: wrap; gap: 6px; }
.rs-item {
  display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px;
  border-radius: 8px; background: #f1f5f9; font-size: 12px; color: var(--text-color, #1e293b);
}
.rs-icon { font-size: 13px; }
.rs-note { font-size: 12px; color: var(--text-secondary, #64748b); }

.record-symptoms { display: flex; flex-wrap: wrap; gap: 5px; }
.symptom-tag {
  padding: 3px 8px; border-radius: 6px; background: #fef3c7; color: #92400e;
  font-size: 11px; font-weight: 500;
}

.record-note {
  font-size: 12px; color: var(--text-secondary, #64748b); padding: 8px 10px;
  background: #f8fafc; border-radius: 8px; line-height: 1.5;
}
.note-label { font-weight: 600; color: var(--text-color, #1e293b); }

.empty-record {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 24px; color: var(--text-hint, #94a3b8); font-size: 13px;
  text-decoration: none; border-radius: 10px; transition: background .15s;
}
.empty-record:hover { background: #f8fafc; }
.empty-icon { font-size: 28px; }
.empty-cta { color: var(--primary-color, #c44680); font-weight: 600; font-size: 13px; }

.cl-bar-outer { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
.cl-bar-outer.mandatory { background: #fecaca; }
.cl-bar-fill { height: 100%; background: linear-gradient(90deg, #66BB6A, #42A5F5); border-radius: 4px; transition: width .4s; }
.cl-bar-outer.mandatory .cl-bar-fill { background: linear-gradient(90deg, #ef4444, #f97316); }
.cl-summary { text-align: center; font-size: 13px; color: var(--text-secondary, #64748b); }
.cl-summary strong { color: var(--primary-color, #c44680); font-size: 15px; margin-left: 4px; }
.cl-sub { color: #94a3b8; font-size: 12px; margin-left: 4px; }

.lc-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f8fafc; border-radius: 10px; }
.lc-type { font-size: 14px; font-weight: 600; margin-right: 8px; }
.lc-date { font-size: 12px; color: var(--text-hint); }
.lc-week { font-size: 13px; font-weight: 600; color: var(--primary-color, #c44680); }

@media (max-width: 768px) {
  .dashboard-view { padding: 10px; }
  .countdown-card { padding: 22px 16px 16px; border-radius: 14px; }
  .countdown-num { font-size: 52px; }
  .section { padding: 14px; border-radius: 12px; }
  .record-primary { grid-template-columns: repeat(2, 1fr); }
  .quick-add-row { flex-direction: column; }
  .core-grid {
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .core-card { padding: 14px 4px 10px; }
  .core-icon { font-size: 24px; }
  .core-label { font-size: 12px; }
  .core-desc { font-size: 9px; }
}
@media (max-width: 480px) {
  .countdown-num { font-size: 44px; }
  .countdown-unit { font-size: 16px; }
  .record-primary { grid-template-columns: repeat(2, 1fr); }
  .dev-brief { flex-wrap: wrap; }
  .ci-week { min-width: 40px; font-size: 11px; }
  .core-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .core-card:nth-child(4),
  .core-card:nth-child(5) {
    grid-column: auto;
  }
}
</style>
