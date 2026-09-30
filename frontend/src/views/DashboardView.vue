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

    <!-- ===== 本周变化（简洁入口卡，摘要随当前孕周变化；详情在独立页 /weekly-detail） ===== -->
    <router-link :to="weeklyDetailTarget" class="weekly-entry">
      <div class="weekly-entry-head">
        <h3>本周变化</h3>
        <span class="weekly-entry-week" v-if="weeklyCurrentWeek">第 {{ weeklyCurrentWeek }} 周</span>
      </div>
      <template v-if="weeklyCurrentWeek">
        <p class="weekly-entry-teaser"><span class="teaser-icon">👶</span>宝宝：{{ weeklyBabyTeaser }}</p>
        <p class="weekly-entry-teaser"><span class="teaser-icon">🤰</span>妈妈：{{ weeklyMomTeaser }}</p>
      </template>
      <p class="weekly-entry-teaser" v-else>设置孕周后自动定位到当前周 · 点击可浏览各周变化</p>
      <span class="weekly-entry-more">查看详情 ›</span>
    </router-link>

    <!-- ===== 今日用药 / 补充打卡（按医嘱计划提醒，打卡记今天；打完卡当天不再推） ===== -->
    <DoseTodayCard />

    <!-- ===== 提醒看板（未来一个月） ===== -->
    <div class="section reminder-board">
      <div class="section-header">
        <h3>提醒看板</h3>
        <div class="header-actions">
          <span class="section-hint" v-if="todayTodos.length">
            <template v-if="todayCount">今日 {{ todayCount }} 项</template>
            <template v-if="todayCount && upcomingCount"> · </template>
            <template v-if="upcomingCount">孕期计划 {{ upcomingCount }} 项</template>
          </span>
          <n-button size="tiny" :loading="pushing" @click="pushToWecom" v-if="todayTodos.length">推送消息</n-button>
        </div>
      </div>
      <!-- 三态而非两态：以前只有「有数据 / 暂无提醒」两种，数据还没回来时
           会先闪一下「暂无提醒，快添加一条吧」，等接口返回才变成真实列表，
           看着像凭空冒出来。先把「正在加载」这一步单独表示出来。 -->
      <div v-if="loading && !dashboardData" class="empty-hint">正在加载…</div>
      <div v-else-if="todayTodos.length === 0" class="empty-hint">暂无提醒，快添加一条吧</div>
      <div v-else class="plan-list">
        <div v-for="item in todayTodos" :key="item.id" class="plan-item" :class="{ 'is-today': item.days_until === 0, 'is-past': (item.days_until || 0) < 0, 'is-completed': item.is_completed }">
          <span class="plan-icon">{{ todoIcon(item) }}</span>
          <div class="plan-body">
            <span class="plan-title" :class="{ 'completed-text': item.is_completed }">
              <span v-if="isPlanItem(item)" class="plan-tag">计划</span>{{ item.name || item.title || '提醒' }}
            </span>
            <span class="plan-meta" v-if="item.trigger_date || item.days_until != null">
              <template v-if="item.days_until != null">
                {{ formatDaysUntil(item.days_until) }}
              </template>
              <template v-else>{{ formatCountdown(item.trigger_date) }}</template>
              <template v-if="item.trigger_date && item.days_until !== 0"> · {{ item.trigger_date.slice(5) }}</template>
              <!-- 执行时间（几点）：计划与带时间的提醒都会显示 -->
              <template v-if="item.trigger_time"> · {{ String(item.trigger_time).slice(0, 5) }}</template>
            </span>
          </div>
          <!-- 完成按钮：只对"计划"和"手动提醒"显示，产检去产检页完成 -->
          <n-button v-if="!item.is_completed && canCompleteOnDashboard(item)" size="tiny" quaternary type="primary" @click="completeTodo(item)">完成</n-button>
          <span v-else-if="item.is_completed" class="completed-badge">已完成</span>
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
          value-format="yyyy-MM-dd"
          size="small"
          style="width: 130px"
        />
        <n-select
          v-model:value="newTodoTime"
          :options="timeOptions"
          size="small"
          style="width: 110px; flex-shrink: 0"
          placeholder="时间"
          clearable
        />
        <n-button type="primary" size="small" :loading="adding" @click="quickAddReminder" :disabled="!newTodoTitle.trim()">添加</n-button>
      </div>
    </div>

    <!-- ===== 运动建议入口 ===== -->
    <router-link to="/exercise-guide" class="eg-entry-card">
      <span class="eg-entry-icon">🤸</span>
      <div class="eg-entry-body">
        <strong>孕期运动指南</strong>
        <span>根据孕周推荐适合的运动 · 科学助力顺产</span>
      </div>
      <span class="eg-entry-arrow">→</span>
    </router-link>

    <!-- ===== 胎动 / 宫缩：展示今日真实数据 + 就地快捷记录 =====
         以前这里两张卡是**纯跳转**（点了直接进计数器全屏页），既看不到今天记了多少、
         也没法随手补一笔 —— 用户反馈「首页相关功能是展示和快捷记录啊」。
         现在：卡上直接显示今天的数字（读 daily_record 的汇总，计数器/计时器结束会话
         或每记一次都会写回），并提供「记一笔」就地弹出小弹窗；
         想用实时计数/计时器再点标题行右侧的箭头进全屏页。 -->
    <div class="tool-row">
      <div class="tool-card">
        <div class="tool-card-head">
          <span class="tool-card-icon"><AppIcon name="timer" :size="18" /></span>
          <router-link to="/contraction-timer" class="tool-card-title">宫缩计时器</router-link>
          <router-link to="/contraction-timer" class="tool-card-more" aria-label="进入宫缩计时器">›</router-link>
        </div>
        <div class="tool-card-stat" :class="{ 'is-live': contractionActive, 'is-empty': contractionStatEmpty }">
          {{ contractionStatText }}
        </div>
        <n-button size="tiny" type="primary" secondary @click="openQuickLog('contraction')">记一笔</n-button>
      </div>

      <div class="tool-card">
        <div class="tool-card-head">
          <span class="tool-card-icon">🦶</span>
          <router-link to="/fetal-movement-counter" class="tool-card-title">胎动计数器</router-link>
          <router-link to="/fetal-movement-counter" class="tool-card-more" aria-label="进入胎动计数器">›</router-link>
        </div>
        <div class="tool-card-stat" :class="{ 'is-empty': fetalMovementStatEmpty }">
          {{ fetalMovementStatText }}
        </div>
        <n-button size="tiny" type="primary" secondary @click="openQuickLog('fetal_movement')">记一笔</n-button>
      </div>
    </div>

    <!-- 胎动 / 宫缩「快捷记一笔」——与记录页共用同一份小弹窗组件 -->
    <QuickLogDialog
      v-model:show="showFmQuickLog"
      type="fetal_movement"
      :pregnancy-id="pregnancyStore.currentPregnancy?.id"
      :date="todayStr"
      :note="todayRecord?.note || ''"
    />
    <QuickLogDialog
      v-model:show="showContrQuickLog"
      type="contraction"
      :pregnancy-id="pregnancyStore.currentPregnancy?.id"
      :date="todayStr"
      :note="todayRecord?.note || ''"
    />

    <!-- ===== 今日记录 ===== -->
    <div class="section record-section">
      <div class="section-header">
        <h3>今日记录</h3>
        <router-link :to="{ path: '/record', query: { date: todayStr } }" class="view-all">
          {{ dashboardData?.has_today_record ? '查看详情 →' : '去记录 →' }}
        </router-link>
      </div>
      <div v-if="healthCards.length > 0" class="record-content">
        <!-- 健康数据宫格：只显示健康指标，统一卡片样式。
             ⚠️ 由 healthCards 计算属性数据驱动。这里以前是 9 条并列的 v-if，
                而外层判据却是 `Object.keys(todayRecord).length > 1`（只看「有没有任意一列」），
                两者口径不一致 ⇒ 只记了饮水/运动/备注、或只用过一次胎动计数器
                （daily-rollup 会补建当天记录行）时，外层判据为真、宫格一张卡都没有，
                于是渲染出一块 **0px 高的空盒子**，连「今天还没有记录」的空态也被 v-else 挡掉。
                （实测见 tools/verify/probe_dashboard_record_coverage.js） -->
        <div class="health-grid">
          <div class="hg-card" v-for="c in healthCards" :key="c.key">
            <span class="hg-icon" v-if="c.icon">{{ c.icon }}</span>
            <span class="hg-val">{{ c.value }}<small v-if="c.unit">{{ c.unit }}</small></span>
            <span class="hg-label">{{ c.label }}</span>
          </div>
        </div>
      </div>
      <!-- 有记录、但没有任何「健康指标」能上宫格（饮水/运动/便便/症状/备注…，或只用过计数器）：
           说清楚「今天已经记了什么」，而不是给一个空盒子，也不能谎称「今天还没有记录」。 -->
      <div v-else-if="hasTodayRecord" class="record-content">
        <div class="other-recorded">
          <span class="or-lead">今天已记录</span>
          <span class="or-chip" v-for="t in otherRecordedItems" :key="t">{{ t }}</span>
          <span class="or-hint">健康数据（体重 / 血压 / 胎心…）还没填，点右上角去补 →</span>
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
        <h3>宝宝成长曲线</h3>
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
        <h3>产检建议</h3>
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
        <h3>准备清单</h3>
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
        <h3>最近产检</h3>
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
        <h3>核心功能</h3>
      </div>
      <div class="core-grid">
        <router-link to="/record" class="core-card core-record">
          <span class="core-label">记录</span>
          <span class="core-desc" v-if="dashboardData?.has_today_record">今日已记录</span>
          <span class="core-desc" v-else>今日未记录</span>
        </router-link>
        <router-link to="/diet" class="core-card core-diet">
          <span class="core-label">饮食</span>
          <span class="core-desc">今日吃什么</span>
        </router-link>
        <router-link to="/diary" class="core-card core-diary">
          <span class="core-label">日记</span>
          <span class="core-desc">记录孕期点滴</span>
        </router-link>
        <router-link to="/checkup-schedule" class="core-card core-checkup">
          <span class="core-label">产检</span>
          <span class="core-desc" v-if="upcomingCheckupCount">{{ upcomingCheckupCount }}项待完成</span>
          <span class="core-desc" v-else>查看产检计划</span>
        </router-link>
        <router-link to="/settings" class="core-card core-settings">
          <span class="core-label">设置</span>
          <span class="core-desc">数据与管理</span>
        </router-link>
      </div>
    </div>

    <div style="height: 80px"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { NInput, NButton, NTag, NDatePicker, NSelect, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useGestationalAge } from '@/composables/useGestationalAge'
import { weekBabyTeaser, weekMomTeaser } from '@/data/weekly-development'
import { getDashboard } from '@/api/dashboard'
import { reminderApi } from '@/api/reminder'
import { pushApi } from '@/api/push'
import { markCheckupCompleted } from '@/api/checkup-schedule'
import { checkupApi } from '@/api/checkup'
import client from '@/api/client'
import { calculateGestationalAge } from '@/utils/gestational'
import { getMoodEmoji as moodEmojiOf, sleepQualityLabel } from '@/utils/format'
import dayjs from 'dayjs'
import DoseTodayCard from '@/components/dose/DoseTodayCard.vue'
import QuickLogDialog from '@/components/record/QuickLogDialog.vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import AppIcon from '@/components/common/AppIcon.vue'

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

// ====== 本周变化入口卡（简洁摘要，详情页 /weekly-detail） ======
/** 当前实际孕周（钳制 4~40）；备孕期无孕周，返回 null 显示引导文案 */
const weeklyCurrentWeek = computed(() => {
  const a = realtimeAge.value
  if (!a || a.isPrePregnancy) return null
  return Math.min(Math.max(a.weeks, 4), 40)
})
const weeklyDetailTarget = computed(() =>
  weeklyCurrentWeek.value
    ? { path: '/weekly-detail', query: { week: String(weeklyCurrentWeek.value) } }
    : '/weekly-detail'
)
const weeklyBabyTeaser = computed(() =>
  weeklyCurrentWeek.value ? weekBabyTeaser(weeklyCurrentWeek.value) : ''
)
const weeklyMomTeaser = computed(() =>
  weeklyCurrentWeek.value ? weekMomTeaser(weeklyCurrentWeek.value) : ''
)

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

// 时间选项（每30分钟一个）
const timeOptions = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = (i % 2) * 30
  const v = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  return { value: v, label: v }
})
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
  return p?.due_date || null
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

// 心情 emoji 统一取自 utils/format 的唯一真源。
// 以前这里自己抄了一份数组，字符与其它页面不一致（😕🙂 vs 😔😊），
// 导致同一天的心情在首页和日记页显示的脸不一样。
function moodEmoji(mood: number): string {
  return moodEmojiOf(mood, '😐')
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

// ===== 胎动 / 宫缩卡片的「展示 + 快捷记录」=====
// 数值一律读 today_record（daily_record 的汇总列）。口径说明：
//   · 计数器/计时器：每记一次以及结束会话时，后端 daily-rollup 都会把当天所有会话汇总写回
//     ⇒ 汇总列拿到的就是「今天一共数了多少」；
//   · 只手填、没用过计数器的用户：汇总列就是他自己填的值，同样正确。
// 所以不需要在前端再调会话接口求和，少一次请求也不会两处数字打架。
const showFmQuickLog = ref(false)
const showContrQuickLog = ref(false)

function openQuickLog(type: 'fetal_movement' | 'contraction') {
  if (type === 'fetal_movement') showFmQuickLog.value = true
  else showContrQuickLog.value = true
}

/** 宫缩正在进行（计时器还没点结束）——后端 dashboard 已算好这个标志，此前前端 0 处引用 */
const contractionActive = computed(() => !!dashboardData.value?.contraction_active)

const fetalMovementStatText = computed(() => {
  const r: any = todayRecord.value
  const c = r?.fetal_movement_count
  if (c == null || c === '') return '今天还没记 · 点「记一笔」或右侧进计数器'
  const d = r?.fetal_movement_duration
  const n = Number(dashboardData.value?.fetal_movement_sessions || 0)
  // 会话数写出来：统计曲线一天只取次数最高的那一次，首页写清「几次会话 · 共几次」，
  // 用户拿去跟曲线比时不会以为有一边算错了
  const head = n > 1 ? `今日 ${n} 次会话 · 共 ${c} 次` : `今日 ${c} 次`
  return head + (d ? ` · 用时 ${d} 分钟` : '')
})
const fetalMovementStatEmpty = computed(() => {
  const c: any = todayRecord.value?.fetal_movement_count
  return c == null || c === ''
})

const contractionStatText = computed(() => {
  if (contractionActive.value) return '计时中…（点右侧继续）'
  const r: any = todayRecord.value
  const c = r?.contraction_count
  if (c == null || c === '') return '今天还没记 · 点「记一笔」或右侧进计时器'
  const n = Number(dashboardData.value?.contraction_sessions || 0)
  let t = n > 1 ? `今日 ${n} 次会话 · 共 ${c} 次` : `今日 ${c} 次`
  if (r?.contraction_duration) t += ` · 持续 ${r.contraction_duration} 秒`
  if (r?.contraction_interval) t += ` · 间隔 ${r.contraction_interval} 分`
  return t
})
const contractionStatEmpty = computed(() => {
  const c: any = todayRecord.value?.contraction_count
  return c == null || c === ''
})

// 快捷记一笔保存后，本页的「今日」数字要立刻跟着变
onMounted(() => window.addEventListener('record-added', loadDashboard))
onUnmounted(() => window.removeEventListener('record-added', loadDashboard))


// ⚠️ 这里曾有第三份睡眠质量映射（中文↔英文），且兜底返回 '一般' ——
//    于是「没记质量」会被显示成「一般」，而记录列表/统计面板的兜底各不相同。
//    现已收口到 utils/format 的唯一真源（铁律 #34），本页直接用共享函数。

// 分组可见性计算（仅保留健康数据相关）
const hasGlucose = computed(() => {
  const r = todayRecord.value
  return !!(r?.blood_glucose_fasting || r?.blood_glucose_1h || r?.blood_glucose_2h)
})

/** 血糖显示文本：合并多值为一行 */
const glucoseDisplayText = computed(() => {
  const r = todayRecord.value
  const parts: string[] = []
  if (r?.blood_glucose_fasting) parts.push(`空腹${r.blood_glucose_fasting}`)
  if (r?.blood_glucose_1h) parts.push(`1h${r.blood_glucose_1h}`)
  if (r?.blood_glucose_2h) parts.push(`2h${r.blood_glucose_2h}`)
  return parts.join(' / ') || '--'
})

const lmpDate = computed(() => pregnancyStore.currentPregnancy?.last_period_date)

/** 今天到底有没有记录行（后端按 `today_record.id` 判的，前端只读同一个标志，不自己再判一次）。 */
const hasTodayRecord = computed(() => !!dashboardData.value?.has_today_record)

/**
 * 首页「今日记录」宫格要显示的卡片 —— **数据驱动，唯一真源**。
 *
 * 这里以前是模板里 9 条并列的 `v-if="todayRecord.xxx != null"`，和外层判据各说各话；
 * 现在收成一份数组，卡片数量 = 数组长度，模板不再自己判断。
 * 判定条件逐条照搬原来的写法（含 `!= null` 与真值判断的区别），行为不变。
 *
 * ⚠️ 只放「健康指标」。其余类别（饮水/运动/症状/…）不上宫格，
 *    但必须在这块板块里露名字，见 otherRecordedItems —— 否则板块会变成空盒子。
 */
const healthCards = computed<Array<{ key: string; icon?: string; value: any; unit?: string; label: string }>>(() => {
  const r: any = todayRecord.value
  if (!r) return []
  const cards: Array<{ key: string; icon?: string; value: any; unit?: string; label: string }> = []
  if (r.weight != null) {
    cards.push({ key: 'weight', value: r.weight, unit: 'kg', label: '体重' })
  }
  if (r.mood != null) {
    cards.push({ key: 'mood', icon: moodEmoji(r.mood), value: moodLabel(r.mood), label: '心情' })
  }
  if (r.fetal_heart_rate != null) {
    cards.push({ key: 'fetal_heart_rate', value: r.fetal_heart_rate, unit: 'bpm', label: '胎心' })
  }
  if (r.sleep_hours != null || r.sleep_quality) {
    const q = sleepQualityLabel(r.sleep_quality)
    cards.push({ key: 'sleep', value: r.sleep_hours ?? '--', unit: 'h', label: q ? '睡眠 ' + q : '睡眠' })
  }
  if (r.blood_pressure_systolic) {
    cards.push({ key: 'blood_pressure', value: `${r.blood_pressure_systolic}/${r.blood_pressure_diastolic || '--'}`, label: '血压' })
  }
  if (r.body_temperature) {
    cards.push({ key: 'body_temperature', value: r.body_temperature, unit: '°C', label: '体温' })
  }
  if (hasGlucose.value) {
    cards.push({ key: 'blood_glucose', value: glucoseDisplayText.value, label: '血糖' })
  }
  if (r.uric_acid != null) {
    cards.push({ key: 'uric_acid', value: r.uric_acid, unit: 'μmol/L', label: '尿酸' })
  }
  if (r.hcg_value != null) {
    cards.push({ key: 'hcg', value: r.hcg_value, label: 'HCG' })
  }
  return cards
})

function parseJsonArray(v: any): any[] {
  try {
    const a = JSON.parse(v || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

/**
 * 「非健康指标」的记录类别里，今天哪些有数据 —— 给空宫格时兜底展示用。
 *
 * ⚠️ label 逐字抄自记录页 `RecordList.allCategories`（饮水/饮食备注/皮肤状况/排尿情况…），
 *    两边必须一一对应，否则首页写的名字和记录页对不上。
 *    `verify_record_entrypoints.js` 有断言盯着这件事：记录页每新增一个类别，
 *    这里不跟上就会红（防止首页悄悄漏掉一整类）。
 *
 * 不在这里列的：9 个健康指标（上面宫格）；计划（在「今日待办」板块里，且它的"完成」
 * 是待办语义，不适合当普通记录列出来）。
 *
 * 胎动 / 宫缩虽然下面各有一张工具卡，也照样列 —— 它们确实写回了当天的 daily_record
 * （见后端 services/daily-rollup.js），只说「今天已记录」却不说是哪两类，读起来是断的。
 */
const OTHER_RECORD_CATEGORIES: Array<{ label: string; has: (r: any) => boolean }> = [
  { label: '胎动', has: r => !!(r.fetal_movement_count || r.fetal_movement_duration) },
  { label: '宫缩', has: r => !!(r.contraction_duration || r.contraction_interval) },
  { label: '三围', has: r => (r.bust != null && r.bust !== '') || (r.waist != null && r.waist !== '') || (r.hip != null && r.hip !== '') },
  { label: '水肿', has: r => r.edema_level != null && r.edema_level !== '' },
  { label: '症状', has: r => parseJsonArray(r.symptoms).length > 0 },
  { label: '分泌物', has: r => r.vaginal_discharge != null && r.vaginal_discharge !== '' },
  { label: '皮肤状况', has: r => r.skin_condition != null && r.skin_condition !== '' },
  { label: '排尿情况', has: r => r.urination_frequency != null && r.urination_frequency !== '' },
  { label: '便便', has: r => !!r.stool_record },
  { label: '饮水', has: r => !!r.water_intake },
  { label: '饮食备注', has: r => !!r.diet_note },
  { label: '运动', has: r => !!(r.exercise_type || r.exercise_duration || r.exercise_intensity) },
  { label: '营养补充', has: r => !!r.supplement_record },
  { label: '用药', has: r => parseJsonArray(r.medication).length > 0 },
  { label: '好习惯', has: r => !!r.habit_text },
  { label: '爱爱', has: r => !!(r.intimacy_record || r.intimacy_note) },
  { label: '备注', has: r => !!r.note },
]

const otherRecordedItems = computed<string[]>(() => {
  const r: any = todayRecord.value
  if (!r) return []
  return OTHER_RECORD_CATEGORIES.filter(c => c.has(r)).map(c => c.label)
})

/**
 * 是不是「计划」条目。
 * 两种来源：① 新的计划存在待办表（reminder_type='plan'）；② 历史计划曾是当天记录的
 * plan_text，后端会以 type='plan' 的形式合并进来。两者都要认得。
 */
function isPlanItem(item: any): boolean {
  return item?.reminder_type === 'plan' || item?.type === 'plan'
}

/** 今日要做的（计划 + 提醒 + 今天的产检），供看板标题分区显示 */
const todayCount = computed(() => todayTodos.value.filter((t: any) => t.days_until === 0).length)
/** 孕期计划：今天之后的（含产检安排） */
const upcomingCount = computed(() => todayTodos.value.filter((t: any) => t.days_until !== 0).length)

/**
 * 判断该条目是否可在首页看板直接完成（计划+手动提醒可以，产检不行）。
 *
 * ⚠️ **历史计划**（存在 `daily_record.plan_text` 里的那些）只有"今天这一条"能在首页完成：
 *    它的完成态是当天记录上的一列 `is_plan_done` —— **一天一个布尔**，不是待办表里的一行。
 *    所以在未来/过去那几天的历史计划上点「完成」，实际只会把**今天**标成已完成（语义是错的）。
 *    新计划都已存进待办表（`reminder_type='plan'`）、一条一状态，不受这个限制。
 */
function canCompleteOnDashboard(item: any): boolean {
  const t = item.type || ''
  // 历史计划（plan_text）：只有今天这条能在首页完成
  if (t === 'plan') return item.trigger_date === todayStr || item.id === 'plan_today'
  // 待办表里的条目（新计划 reminder_type='plan' / 手动提醒）：一条一状态，随时可完成
  if (!t || t === 'manual' || t === 'reminder') return true
  // 产检相关（产检提醒 / 自定义产检）：去产检页完成
  return false
}

async function completeTodo(item: any) {
  const type = item.type || ''
  // 1) 历史计划 → 写当天记录的 is_plan_done
  if (type === 'plan') {
    const recordId = dashboardData.value?.today_record?.id
    if (!recordId) {
      // 🔴 以前这里是 `if (recordId) { … }`：不成立时**什么都不写**，却照样走到下面提示「已完成」
      //    —— 纯假成功（用户以为标上了、刷新一下又回来了）。现在直接告诉他为什么不行。
      message.error('今天还没有任何记录，暂时无法标记计划完成')
      return
    }
    try {
      await client.put(`/daily-records/${recordId}`, { is_plan_done: 1 })
    } catch (e: any) {
      message.error('操作失败: ' + (e?.message || ''))
      return
    }
  }
  // 2) 待办表条目（手动提醒 / 新计划）→ 标记这一条完成
  //    ⚠️ 只认待办表的两种；自定义产检的 id 是 `custom_xxx`，拿它去 PUT /reminders 必然失败，
  //    所以判据与 canCompleteOnDashboard 保持一致（不再用 `!type.startsWith('checkup')` 这种松条件）。
  else if (type === 'reminder' || type === 'manual' || !type) {
    if (!item.id) { message.error('这条待办缺少 id，无法完成'); return }
    try {
      await reminderApi.complete(item.id)
    } catch (e: any) {
      message.error('操作失败: ' + (e?.message || ''))
      return
    }
  }
  // 3) 产检类型 → 不在首页处理（去产检页完成）
  else { return }

  await loadDashboard()
  message.success('已完成')
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
    // 推到所有已启用的渠道（企业微信 / 飞书）
    const res: any = await pushApi.dailyPushAll(pregnancyStore.currentPregnancy.id)
    if (res.code === 0) {
      if (res.data && res.data.partial_failed) message.warning(res.message || '部分渠道推送失败')
      else message.success(res.message || '每日看板已推送')
    }
    else if (res.code === 1002) message.warning(res.message || '推送失败')
    else message.info(res.message || '已发送请求')
  } catch (e: any) {
    message.error(e?.message || '推送失败，请先在设置页检查推送配置')
  } finally { pushing.value = false }
}

async function loadDashboard() {
  if (!pregnancyStore.currentPregnancy) return
  loading.value = true
  try {
    const res: any = await getDashboard(pregnancyStore.currentPregnancy.id)
    if (res.code === 0) dashboardData.value = res.data
  } catch (e: any) { console.error('加载看板失败:', e?.message || e) }
  finally { loading.value = false }
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

/* ===== 本周变化入口卡（简洁，详情在独立页） ===== */
.weekly-entry {
  display: block;
  background: var(--bg-card);
  border: 1px solid var(--border-color-soft);
  border-radius: 14px;
  padding: 14px 18px;
  margin-bottom: 16px;
  text-decoration: none;
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
}
.weekly-entry:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.weekly-entry-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}
.weekly-entry-head h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: var(--text-color);
}
.weekly-entry-week {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary-color);
}
.weekly-entry-teaser {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0 0 6px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.teaser-icon { flex-shrink: 0; font-size: 13px; }
.weekly-entry-more {
  font-size: 12.5px;
  color: var(--primary-color);
  font-weight: 600;
}

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
.plan-item.is-completed { opacity: 0.55; background: #f1f5f9; }
.plan-item.is-completed .plan-icon { filter: grayscale(0.5); }
.completed-text { text-decoration: line-through; color: #94a3b8 !important; }
.completed-badge { font-size: 11px; color: #16a34a; font-weight: 500; }
.plan-icon { font-size: 18px; }
.plan-body { flex: 1; min-width: 0; }
.plan-title { font-size: 13px; font-weight: 600; color: var(--text-color, #1e293b); display: block; }
.plan-meta { font-size: 11px; color: var(--text-hint, #94a3b8); }
/* 「计划」小标签：与产检提醒、手动待办区分开 */
.plan-tag {
  display: inline-block; margin-right: 5px; padding: 0 5px;
  border-radius: 4px; font-size: 10px; line-height: 16px;
  background: var(--bg-tint-pink, #fdf1f5); color: var(--primary-color, #7c5cbf);
  vertical-align: 1px;
}
.header-actions { display: flex; align-items: center; gap: 8px; }

.quick-add-row { display: flex; gap: 8px; margin-top: 4px; }

/* 运动建议入口 */
.eg-entry-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #f0ebfb, #e8f2fb);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  margin-top: 16px;
  transition: transform .15s, box-shadow .15s;
}
.eg-entry-card:active { transform: scale(0.98); }
.eg-entry-icon { font-size: 28px; flex-shrink: 0; }
.eg-entry-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.eg-entry-body strong { font-size: 15px; color: #333; }
.eg-entry-body span { font-size: 12px; color: #888; margin-top: 2px; }
.eg-entry-arrow { font-size: 18px; color: #7c5cbf; font-weight: 700; }

/* ===== 胎动 / 宫缩卡片：展示今日数据 + 快捷记录 =====
   ⚠️ 卡片不再是整体 router-link（里面有按钮，套一层链接会变成嵌套可点区域）。
      进全屏计数器/计时器改由标题右侧的「›」承担。配色沿用原卡片（浅粉→浅紫渐变）。 */
.tool-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, #fdf1f5, #f2f0fd);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: var(--shadow-sm);
  min-width: 0;
}
.tool-card-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tool-card-icon { font-size: 20px; line-height: 1; flex-shrink: 0; }
.tool-card-title {
  font-size: 14px;
  font-weight: 700;
  color: #333;
  text-decoration: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-card-title:hover { color: var(--primary-color, #c44680); }
.tool-card-more {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 18px;
  line-height: 1;
  font-weight: 700;
  color: #7c5cbf;
  text-decoration: none;
  padding: 0 4px;
}
.tool-card-more:hover { color: var(--primary-color, #c44680); }
.tool-card-stat {
  font-size: 12px;
  line-height: 1.35;
  color: #4b5563;
  /* 留最小高度：没数据时卡片不至于比有数据时矮一截、两卡高度不一致 */
  min-height: 32px;
}
.tool-card-stat.is-empty { color: #9aa3af; }
.tool-card-stat.is-live { color: var(--primary-color, #c44680); font-weight: 600; }
.tool-card :deep(.n-button) { align-self: flex-start; }

.record-content { display: flex; flex-direction: column; gap: 10px; }

/* ====== 健康数据宫格（统一卡片样式）====== */
.health-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.hg-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border-radius: 10px;
  background: #fdf4ff;
  gap: 4px;
}
.hg-icon { font-size: 20px; }
.hg-val { font-size: 16px; font-weight: 700; color: var(--text-color, #1e293b); }
.hg-val small { font-size: 11px; font-weight: 500; color: var(--text-hint, #94a3b8); margin-left: 1px; }
.hg-label { font-size: 11px; color: var(--text-hint, #94a3b8); text-align: center; }

/* 有记录、但没填任何健康指标时的兜底：把「今天记了什么」列出来，不留空盒子 */
.other-recorded {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 12px; border-radius: 10px; background: #fdf4ff;
}
.or-lead { font-size: 12px; color: var(--text-secondary, #64748b); font-weight: 600; }
.or-chip {
  font-size: 12px; padding: 2px 9px; border-radius: 999px;
  background: #fff; color: var(--primary-color, #c44680); border: 1px solid #f5d0e6;
}
.or-hint { flex-basis: 100%; font-size: 11px; color: var(--text-hint, #94a3b8); margin-top: 2px; }

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
  .health-grid { grid-template-columns: repeat(2, 1fr); }
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
  .health-grid { grid-template-columns: repeat(2, 1fr); }
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
