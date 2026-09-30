<template>
  <div class="record-list">
    <div class="category-list">
      <div
        v-for="cat in displayCategories"
        :key="cat.type"
        class="category-item"
        :class="{ 'has-data': cat.hasData }"
      >
        <div class="category-row" @click="onCategoryClick(cat)">
          <div class="row-left">
            <span
              class="row-icon"
              :style="{ background: cat.color + '15', color: cat.color }"
            ><AppIcon :name="cat.icon" :size="20" /></span>
            <span class="row-label">{{ cat.label }}</span>
            <span v-if="cat.badge" class="row-badge" :style="{ background: cat.badgeColor || '#ff6b35', color: '#fff' }">{{ cat.badge }}</span>
          </div>
          <div class="row-right">
            <template v-if="cat.hasData">
              <span class="row-preview">{{ getPreview(cat.type) }}</span>
              <!-- 「查看」只在**真有会话**时给：只手填过、一次会话都没有的日子没有明细可看，
                   那时点条目的去向是编辑（与其它类型一致），提示符也得跟着是编辑图标 -->
              <span v-if="isSessionType(cat.type) && hasSessions(cat.type)" class="row-view-hint">查看</span>
              <span v-else class="row-edit-icon"><AppIcon name="edit" :size="14" /></span>
            </template>
            <template v-else>
              <span class="add-circle" :style="{ color: cat.color, borderColor: cat.color }">+</span>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, watch, onMounted, onUnmounted } from 'vue'
import { dailyRecordApi } from '@/api/daily-record'
import { usePregnancyStore } from '@/stores/pregnancy'
import { getMoodEmoji as moodEmojiOf, normalizeSleepQuality, sleepQualityLabel, normalizeContractionPain } from '@/utils/format'
import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{
  date: string
  records?: any[]
  /** 「计划」类型的待办（reminder_type='plan'）。计划存在待办表里而不是当天记录里：
   *  记录一天一条放不下多个时间点的安排，待办一条一记录且已在推送链路中。 */
  plans?: any[]
}>()

/** 选中日期当天的计划（可能多条，按时间排序） */
const dayPlans = computed(() => {
  const list = (props.plans || []).filter((p: any) => p.trigger_date === props.date)
  return list.slice().sort((a: any, b: any) =>
    String(a.trigger_time || '99:99').localeCompare(String(b.trigger_time || '99:99')))
})

const emit = defineEmits<{
  'add': []
  'add-type': [type: string]
  'edit': [payload: { type: string; record: any }]
  /** 胎动/宫缩：点条目 → 打开「每次明细」弹窗（明细不再在记录页上铺开） */
  'detail': [type: string]
}>()

const pregnancyStore = usePregnancyStore()
const internalRecords = ref<any[]>([])

async function fetchRecords() {
  if (!pregnancyStore.currentPregnancy?.id) return
  try {
    const res: any = await dailyRecordApi.getByDate(
      pregnancyStore.currentPregnancy.id,
      props.date
    )
    if (res.code === 0) {
      internalRecords.value = res.data ? [res.data] : []
    }
  } catch {}
}

/**
 * 当天**真的有会话**的两类计数。
 *
 * ⚠️ 为什么不能只看条目上「有没有数据」：那个判据读的是当天记录的**汇总列**
 *    （用户在本页小弹窗里**手填**也会写这里），而「每次明细」读的是 `*_session` 表
 *    （只有计数器 / 计时器才写）。两者可以不一致 —— 手填过、却一次会话都没有的日子，
 *    条目上有数据，但没有明细可看。若此时仍一律跳明细弹窗，用户看到的是**空明细框**，
 *    而且**再也点不开编辑表单**（其它二十几个类型点条目都是编辑）⇒ 数据看得见、改不了。
 * 所以去向按「有没有会话」定：有会话 → 看明细；只有手填值 → 照旧走编辑。
 *
 * 口径与后端 `daily-rollup` 对齐：**一次都没数的空会话不代表这一天**（点开计数器、
 * 没记就按结束），所以只认 `count > 0` 的会话。
 *
 * ⚠️ 取数失败时保持空 ⇒ 退回「编辑」这条路。编辑是用户显式操作、不会静默覆盖什么；
 *    反过来（误判成有会话）会把用户送进一个同样取不到数据的空明细框，又成了死路。
 *
 * ⚠️ 本块必须声明在下方 `immediate: true` 的 watch **之前**：那个 watch 在 setup 期就会跑，
 *    若 `sessionCounts` 还在下面，就成了 TDZ（Cannot access before initialization）。
 */
const sessionCounts = ref<Record<string, number>>({})
function hasSessions(type: string) { return (sessionCounts.value[type] || 0) > 0 }

async function fetchSessionCounts() {
  if (!pregnancyStore.currentPregnancy?.id) { sessionCounts.value = {}; return }
  try {
    const res: any = await dailyRecordApi.getSessionDetail(pregnancyStore.currentPregnancy.id, props.date)
    const d = (res && res.code === 0 && res.data) || {}
    const positive = (list: any) =>
      Array.isArray(list) ? list.filter((s: any) => Number(s && s.count) > 0).length : 0
    sessionCounts.value = {
      fetal_movement: positive(d.fetal_movement),
      contraction: positive(d.contraction),
    }
  } catch {
    sessionCounts.value = {}
  }
}

watch([() => props.date, () => pregnancyStore.currentPregnancy?.id], ([date, pid]) => {
  if (date && pid) { fetchRecords(); fetchSessionCounts() }
}, { immediate: true })

onMounted(() => {
  window.addEventListener('record-added', onRecordAdded)
})
onUnmounted(() => {
  window.removeEventListener('record-added', onRecordAdded)
})

/** 记录/会话写回后：行上的汇总与「有没有会话」必须一起刷新，否则会出现
 *  「汇总已更新、却还按旧状态决定点条目去哪儿」的错位。 */
function onRecordAdded() { fetchRecords(); fetchSessionCounts() }

const record = computed(() => {
  if (props.records && props.records.length > 0) return props.records[0]
  return internalRecords.value.length > 0 ? internalRecords.value[0] : {}
})

type DisplayCategory = CategoryDef & { hasData: boolean }

function onCategoryClick(cat: DisplayCategory) {
  // 「计划」存在待办表里（不在当天记录），且一天可以有多条 ⇒ 点击一律走「添加计划」小弹窗。
  // 不能走通用大弹窗：那读的是当天记录，里面根本没有计划数据（会打开一张空表单）。
  if (cat.type === 'plan') { emit('add-type', 'plan'); return }

  // 胎动 / 宫缩：**有会话** ⇒ 点条目看每次明细（弹窗）。
  // 用户反馈「明细在页面上铺开、上面放多了不好操作」⇒ 明细统一收进弹窗，页面只留主要数据。
  // ⚠️ 判据是「有没有会话」而**不是**「当天记录有没有值」：只手填过、一次会话都没有的日子
  //    没有明细可看，落进弹窗就是空框，且编辑入口被堵死 —— 此时必须继续往下走编辑分支。
  if (isSessionType(cat.type) && hasSessions(cat.type)) {
    emit('detail', cat.type)
    return
  }

  if (cat.hasData) {
    // 有数据 → 编辑（使用大弹窗）
    emit('edit', { type: cat.type, record: record.value })
  } else if (cat.addable) {
    // 无数据 + 可添加 → 打开对应类型的快捷小弹窗
    emit('add-type', cat.type)
  }
}

/** 有会话明细的两类：明细走弹窗（点条目「查看」） */
const SESSION_TYPES = ['fetal_movement', 'contraction']
function isSessionType(t: string) { return SESSION_TYPES.indexOf(t) >= 0 }

interface CategoryDef {
  type: string
  icon: string
  label: string
  color: string
  addable: boolean
  badge?: string
  badgeColor?: string
}

const allCategories: CategoryDef[] = [
  { type: 'weight', icon: 'weight', label: '体重', color: '#a78bfa', addable: true },
  { type: 'blood_pressure', icon: '🩺', label: '血压', color: '#ef4444', addable: true },
  { type: 'fetal_movement', icon: '🦶', label: '胎动', color: '#a78bfa', addable: true },
  { type: 'contraction', icon: 'timer', label: '宫缩', color: '#f43f5e', addable: true },
  { type: 'fetal_heart_rate', icon: 'heart', label: '测胎心', color: '#f472b6', addable: true },
  { type: 'temperature', icon: 'thermometer', label: '体温', color: '#ef4444', addable: true },
  // 三围（胸/腰/臀）：与 RecordView 顶部「＋ 添加记录」菜单保持一致。
  // 【历史问题】腰围当初只加进了那个小菜单，没加到本列表，用户在记录页主入口根本看不到它。
  { type: 'waist', icon: '📏', label: '三围', color: '#14b8a6', addable: true },
  { type: 'edema', icon: '🦵', label: '水肿', color: '#0ea5e9', addable: true },
  { type: 'symptoms', icon: 'clipboard', label: '症状', color: '#34d399', addable: true },
  { type: 'discharge', icon: '💧', label: '分泌物', color: '#06b6d4', addable: true },
  { type: 'skin', icon: '✨', label: '皮肤状况', color: '#d946ef', addable: true },
  { type: 'urination', icon: '🚻', label: '排尿情况', color: '#22d3ee', addable: true },
  { type: 'stool', icon: '💩', label: '便便', color: '#a3e635', addable: true },
  { type: 'sleep', icon: '😴', label: '睡眠', color: '#818cf8', addable: true },
  { type: 'water', icon: '💧', label: '饮水', color: '#38bdf8', addable: true },
  { type: 'diet', icon: '🍎', label: '饮食备注', color: '#fb923c', addable: true },
  { type: 'exercise', icon: '🏃', label: '运动', color: '#22c55e', addable: true },
  { type: 'supplement', icon: '💊', label: '营养补充', color: '#06b6d4', addable: true },
  // 用药：2026-09-29 补。此前这一类**完全没有入口**（顶部菜单/记录列表/quickAdd 三处都漏了），
  // 而它的数据通路一直是齐的 —— 列表里本就有 hasDataForType/getPreview 的 medication 分支，
  // 只是永远没有类别能命中它，那两段代码等于死代码。
  { type: 'medication', icon: '💊', label: '用药', color: '#9333ea', addable: true },
  { type: 'habit', icon: '✅', label: '好习惯', color: '#6366f1', addable: true },
  { type: 'blood_glucose', icon: '🩸', label: '孕期血糖', color: '#f59e0b', addable: true },
  { type: 'hcg', icon: '🧬', label: 'hCG', color: '#8b5cf6', addable: true },
  { type: 'uric_acid', icon: '🧪', label: '尿酸', color: '#ec4899', addable: true },
  { type: 'mood', icon: '😊', label: '心情', color: '#f87171', addable: true },
  { type: 'plan', icon: '📌', label: '计划', color: '#14b8a6', addable: true },
  { type: 'intimacy', icon: '💑', label: '爱爱', color: '#f43f5e', addable: true },
]

function hasDataForType(type: string): boolean {
  const r = record.value
  switch (type) {
    case 'weight': return !!r.weight
    // 三围：任一项有值就算有记录
    case 'waist': return (r.bust != null && r.bust !== '') || (r.waist != null && r.waist !== '') || (r.hip != null && r.hip !== '')
    case 'edema': return r.edema_level != null && r.edema_level !== ''
    case 'discharge': return r.vaginal_discharge != null && r.vaginal_discharge !== ''
    case 'skin': return r.skin_condition != null && r.skin_condition !== ''
    case 'urination': return r.urination_frequency != null && r.urination_frequency !== ''
    case 'blood_pressure': return !!(r.blood_pressure_systolic || r.blood_pressure_diastolic)
    case 'blood_glucose': return !!(r.blood_glucose_fasting || r.blood_glucose_1h || r.blood_glucose_2h)
    case 'symptoms': {
      try {
        const s = JSON.parse(r.symptoms || '[]')
        return Array.isArray(s) && s.length > 0
      } catch { return false }
    }
    case 'sleep': return !!(r.sleep_hours || r.sleep_quality)
    case 'exercise': return !!(r.exercise_type || r.exercise_duration || r.exercise_intensity)
    case 'diet': return !!r.diet_note
    case 'medication': {
      try {
        const m = JSON.parse(r.medication || '[]')
        return Array.isArray(m) && m.length > 0
      } catch { return false }
    }
    case 'mood': return !!r.mood
    case 'fetal_heart_rate': return !!r.fetal_heart_rate
    case 'water': return !!r.water_intake
    case 'stool': return !!r.stool_record
    case 'contraction': return !!(r.contraction_duration || r.contraction_interval)
    case 'fetal_movement': return !!(r.fetal_movement_count || r.fetal_movement_duration)
    case 'temperature': return !!r.body_temperature
    case 'hcg': return !!r.hcg_value
    case 'uric_acid': return !!r.uric_acid
    case 'habit': return !!r.habit_text
    case 'supplement': return !!r.supplement_record
    case 'intimacy': return !!(r.intimacy_record || r.intimacy_note)
    // 计划现在存在「待办」表里（见 dayPlans）；历史数据仍可能在当天记录的 plan_text 里
  case 'plan': return !!r.plan_text || dayPlans.value.length > 0
    default: return false
  }
}

const displayCategories = computed(() => {
  return allCategories.map(cat => ({
    ...cat,
    hasData: hasDataForType(cat.type),
  }))
})

function getPreview(type: string): string {
  const r = record.value
  switch (type) {
    case 'weight':
      return r.weight ? r.weight + ' kg' : ''
    case 'waist': {
      // 三围：只显示已填的那些，顺序固定为 胸/腰/臀
      const parts: string[] = []
      if (r.bust) parts.push('胸 ' + r.bust)
      if (r.waist) parts.push('腰 ' + r.waist)
      if (r.hip) parts.push('臀 ' + r.hip)
      return parts.length ? parts.join(' ') + ' cm' : ''
    }
    case 'edema': {
      const map: Record<string, string> = { none: '无水肿', mild: '轻度水肿', moderate: '中度水肿', severe: '重度水肿' }
      return map[r.edema_level as string] || ''
    }
    case 'discharge': {
      const map: Record<string, string> = { normal: '分泌物正常', more: '分泌物偏多', abnormal: '分泌物异常' }
      return map[r.vaginal_discharge as string] || ''
    }
    case 'skin': {
      const map: Record<string, string> = { normal: '皮肤正常', stretch_marks: '妊娠纹', itchy: '皮肤瘙痒', melasma: '色素沉着' }
      return map[r.skin_condition as string] || ''
    }
    case 'urination': {
      const map: Record<string, string> = { normal: '排尿正常', frequent: '尿频', painful: '尿痛' }
      return map[r.urination_frequency as string] || ''
    }
    case 'blood_pressure':
      return (r.blood_pressure_systolic || '--') + '/' + (r.blood_pressure_diastolic || '--') + ' mmHg'
    case 'blood_glucose': {
      const parts: string[] = []
      if (r.blood_glucose_fasting) parts.push('空腹 ' + r.blood_glucose_fasting)
      if (r.blood_glucose_1h) parts.push('1h ' + r.blood_glucose_1h)
      if (r.blood_glucose_2h) parts.push('2h ' + r.blood_glucose_2h)
      return parts.join('  ') + ' mmol/L'
    }
    case 'fetal_heart_rate':
      return r.fetal_heart_rate ? r.fetal_heart_rate + ' bpm' : ''
    case 'symptoms': {
      const s = getSymptoms()
      return s.length > 0 ? s.length + ' 项' : ''
    }
    case 'sleep':
      return r.sleep_hours ? r.sleep_hours + 'h' + (r.sleep_quality ? ' · ' + getSleepQualityLabel() : '') : ''
    case 'exercise': {
      // 强度感受是可选项，只有用户真的选了才拼进去（不显示「未填」占位）
      const ex = (r.exercise_type || '运动') + (r.exercise_duration ? ' ' + r.exercise_duration + 'min' : '')
      return r.exercise_intensity ? ex + ' · ' + r.exercise_intensity : ex
    }
    case 'diet':
      if (!r.diet_note) return ''
      try {
        const meals = JSON.parse(r.diet_note)
        if (Array.isArray(meals)) return meals.map((m: any) => m.type + ': ' + (m.content || '').slice(0, 10)).join(' | ')
      } catch { /* old format */ }
      return r.diet_note.slice(0, 30) + (r.diet_note.length > 30 ? '…' : '')
    case 'medication': {
      const meds = getMedications()
      return meds.length > 0 ? meds.map((m: any) => m.name).join('、') : ''
    }
    case 'mood':
      return getMoodEmoji() + (r.mood_note ? ' ' + r.mood_note.slice(0, 10) : '')
    case 'water':
      return r.water_intake ? r.water_intake + ' ml' : ''
    case 'stool':
      return getStoolPreview()
    case 'contraction': {
      // 🔴 三段各自独立拼接，不再嵌在「有没有 duration」的三元里：
      //    旧写法只填了间隔、没填持续时（hasData 判「有数据」），预览却是空串。
      //    疼痛程度走 utils/format 的唯一真源（历史『中度』→『明显』读时归一）。
      let t = r.contraction_duration != null && r.contraction_duration !== '' ? r.contraction_duration + 's' : ''
      if (r.contraction_interval != null && r.contraction_interval !== '') t += (t ? ' · ' : '') + r.contraction_interval + 'min间隔'
      const pain = normalizeContractionPain(r.contraction_pain)
      if (pain) t += (t ? ' · ' : '') + pain
      return t
    }
    case 'fetal_movement': {
      // 同宫缩：次数与用时各自独立拼接（只填用时不填次数的日子，预览不再是空串）
      let t = r.fetal_movement_count != null && r.fetal_movement_count !== '' ? r.fetal_movement_count + '次' : ''
      if (r.fetal_movement_duration != null && r.fetal_movement_duration !== '') t += (t ? ' · ' : '') + r.fetal_movement_duration + 'min'
      return t
    }
    case 'temperature':
      return r.body_temperature ? r.body_temperature + '℃' : ''
    case 'hcg':
      return r.hcg_value ? `${r.hcg_value} mIU/mL${r.hcg_weeks ? ' · 孕'+r.hcg_weeks+'周' : ''}` : ''
    case 'uric_acid':
      return r.uric_acid ? `${r.uric_acid} μmol/L${r.uric_acid_period ? '('+r.uric_acid_period+')' : ''}` : ''
    case 'habit':
      return r.habit_text ? String(r.habit_text).slice(0, 30) : ''
    case 'supplement':
      return getSupplementPreview()
    case 'intimacy':
      return getIntimacyPreview()
    case 'plan': {
      // 优先展示当天的计划（待办）：带上时间，多条时给个总数
      if (dayPlans.value.length > 0) {
        const first = dayPlans.value[0]
        const time = first.trigger_time ? String(first.trigger_time).slice(0, 5) + ' ' : ''
        const title = String(first.title || '').slice(0, 22)
        const more = dayPlans.value.length > 1 ? ` 等 ${dayPlans.value.length} 项` : ''
        return time + title + more
      }
      // 历史数据：计划曾写在当天记录的 plan_text 里
      return r.plan_text ? r.plan_text.slice(0, 30) + (r.plan_text.length > 30 ? '…' : '') : ''
    }
    default:
      return ''
  }
}

function getSymptoms(): string[] {
  try {
    const raw = record.value.symptoms
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function getMedications(): Array<{ name: string; dosage?: string }> {
  try {
    const raw = record.value.medication
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function getMoodEmoji(): string {
  const m = record.value.mood
  // 映射统一取自 utils/format 的唯一真源；兜底沿用本页原有的 '😊'
  return moodEmojiOf(m, '😊')
}

function getStoolPreview(): string {
  const r = record.value
  if (!r.stool_record) return ''
  try {
    const s = JSON.parse(r.stool_record)
    return `${s.count || '?'}次 · ${s.consistency || ''}`
  } catch { return r.stool_record }
}

function getSupplementPreview(): string {
  const r = record.value
  if (!r.supplement_record) return ''
  try {
    const s = JSON.parse(r.supplement_record)
    return s.map((x: any) => x.name).join('、')
  } catch { return r.supplement_record }
}

function getIntimacyPreview(): string {
  const r = record.value
  if (!r.intimacy_record) return ''
  try {
    const s = JSON.parse(r.intimacy_record)
    const parts: string[] = []
    if (s.count != null) parts.push(s.count + '次')
    if (s.has_protection === 'yes') {
      const typeMap: Record<string, string> = { condom: '避孕套', pill: '口服避孕药', other: '其他' }
      parts.push('有措施' + (s.protection_type ? '(' + (typeMap[s.protection_type] || s.protection_type) + ')' : ''))
    } else {
      parts.push('无措施')
    }
    return parts.join(' · ')
  } catch { return r.intimacy_record }
}

function getStoolData(): any {
  try {
    return JSON.parse(record.value.stool_record || '{}')
  } catch { return {} }
}

function getSupplementList(): string[] {
  try {
    const arr = JSON.parse(record.value.supplement_record || '[]')
    return Array.isArray(arr) ? arr.map((x: any) => x.name || x) : []
  } catch { return [] }
}

function getIntimacyData(): any {
  try {
    return JSON.parse(record.value.intimacy_record || '{}')
  } catch { return {} }
}

function getTempClass(): string {
  const v = record.value.body_temperature
  if (!v) return 'value-neutral'
  if (v >= 36.0 && v <= 37.3) return 'value-normal'
  if (v > 37.3 && v <= 38.0) return 'value-warning'
  return 'value-alert'
}

function getTempStatusClass(): string {
  return getTempClass() === 'value-normal' ? 'tag-normal'
    : getTempClass() === 'value-warning' ? 'tag-warning'
    : 'value-alert' === getTempClass() ? 'tag-alert'
    : 'tag-neutral'
}

function getTempStatusLabel(): string {
  const v = record.value.body_temperature
  if (!v) return '--'
  if (v >= 36.0 && v <= 37.3) return '正常'
  if (v < 36.0) return '偏低'
  return '偏高'
}

const stoolConsistencyMap: Record<string, string> = { hard: '干硬', normal: '正常', soft: '偏软', diarrhea: '腹泻' }

function getStoolConsistencyClass(c?: string): string {
  if (!c) return 'tag-neutral'
  if (c === 'normal') return 'tag-normal'
  if (c === 'hard' || c === 'diarrhea') return 'tag-alert'
  return 'tag-warning'
}

function getStoolConsistencyLabel(c?: string): string {
  return stoolConsistencyMap[c || ''] || c || ''
}

function getSystolicClass(): string {
  const v = record.value.blood_pressure_systolic
  if (!v) return 'value-neutral'
  if (v < 120) return 'value-normal'
  if (v <= 139) return 'value-warning'
  return 'value-alert'
}

function getDiastolicClass(): string {
  const v = record.value.blood_pressure_diastolic
  if (!v) return 'value-neutral'
  if (v < 80) return 'value-normal'
  if (v <= 89) return 'value-warning'
  return 'value-alert'
}

function getBpStatusClass(): string {
  const s = record.value.blood_pressure_systolic
  const d = record.value.blood_pressure_diastolic
  if (!s && !d) return 'tag-neutral'
  if ((s && s >= 140) || (d && d >= 90)) return 'tag-alert'
  if ((s && s >= 120) || (d && d >= 80)) return 'tag-warning'
  return 'tag-normal'
}

function getBpStatusLabel(): string {
  const s = record.value.blood_pressure_systolic
  const d = record.value.blood_pressure_diastolic
  if (!s && !d) return '--'
  if ((s && s >= 140) || (d && d >= 90)) return '偏高'
  if ((s && s >= 120) || (d && d >= 80)) return '正常高值'
  return '正常'
}

function getGlucoseValue(type: 'fasting' | '1h' | '2h'): number | null {
  const r = record.value
  switch (type) {
    case 'fasting': return r.blood_glucose_fasting ?? null
    case '1h': return r.blood_glucose_1h ?? null
    case '2h': return r.blood_glucose_2h ?? null
  }
}

function getGlucoseClass(type: 'fasting' | '1h' | '2h'): string {
  const v = getGlucoseValue(type)
  if (v === null) return 'value-neutral'
  if (type === 'fasting') {
    if (v < 5.1) return 'value-normal'
    if (v <= 6.9) return 'value-warning'
    return 'value-alert'
  }
  if (v < 7.8) return 'value-normal'
  if (v <= 11.0) return 'value-warning'
  return 'value-alert'
}

function getGlucoseStatusClass(type: 'fasting' | '1h' | '2h'): string {
  return getGlucoseClass(type) === 'value-normal' ? 'tag-normal'
    : getGlucoseClass(type) === 'value-warning' ? 'tag-warning'
    : getGlucoseClass(type) === 'value-alert' ? 'tag-alert'
    : 'tag-neutral'
}

function getGlucoseStatusLabel(type: 'fasting' | '1h' | '2h'): string {
  const v = getGlucoseValue(type)
  if (v === null) return '--'
  if (type === 'fasting') {
    if (v < 5.1) return '正常'
    if (v <= 6.9) return '偏高'
    return '异常'
  }
  if (v < 7.8) return '正常'
  if (v <= 11.0) return '偏高'
  return '异常'
}

function getFhrClass(): string {
  const v = record.value.fetal_heart_rate
  if (!v) return 'value-neutral'
  if (v >= 110 && v <= 160) return 'value-normal'
  return 'value-alert'
}

function getFhrStatusClass(): string {
  const v = record.value.fetal_heart_rate
  if (!v) return 'tag-neutral'
  if (v >= 110 && v <= 160) return 'tag-normal'
  return 'tag-alert'
}

function getFhrStatusLabel(): string {
  const v = record.value.fetal_heart_rate
  if (!v) return '--'
  if (v >= 110 && v <= 160) return '正常'
  if (v < 110) return '偏慢'
  return '偏快'
}

// 睡眠质量的取值归一与中文标签统一取自 utils/format 的唯一真源
// （以前这里自己抄了一份 good/fair/poor ↔ 好/一般/差的映射，首页又抄了一份，
//   统计面板干脆没抄 —— 同一个字段三处口径不一）
function getSleepQualityLabel(): string {
  return sleepQualityLabel(record.value.sleep_quality)
}

function getSleepQualityClass(): string {
  switch (normalizeSleepQuality(record.value.sleep_quality)) {
    case 'good': return 'value-normal'
    case 'fair': return 'value-warning'
    case 'poor': return 'value-alert'
    default: return 'value-neutral'
  }
}

function getSleepQualityWidth(): string {
  switch (normalizeSleepQuality(record.value.sleep_quality)) {
    case 'good': return '80%'
    case 'fair': return '50%'
    case 'poor': return '25%'
    default: return '0%'
  }
}
</script>

<style scoped>
.record-list {
  flex: 1;
  padding: 0 2px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 0 16px;
}

.category-item {
  background: var(--bg-card, #ffffff);
  border-bottom: 1px solid var(--border-color, #f5f5f5);
  transition: background 0.15s ease;
}

.category-item.has-data {
  background: var(--bg-card, #ffffff);
  border-bottom: 1px solid var(--border-color, #f5f5f5);
}

.category-item:last-child {
  border-bottom: none;
}

.category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  min-height: 52px;
  transition: background 0.15s ease;
}

.category-row:hover {
  background: rgba(248, 250, 252, 0.6);
}

.category-row:active {
  background: var(--bg-color, #f8fafc);
}

.row-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.row-icon {
  font-size: 20px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}

.row-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color, #1e293b);
}

.row-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.row-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.add-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  font-size: 16px;
  font-weight: 500;
  line-height: 1;
  transition: transform 0.15s ease;
}

.add-circle:active {
  transform: scale(0.9);
}

.row-preview {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
  text-align: right;
  font-weight: 400;
  margin-right: 6px;
}

.row-edit-icon {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 0.15s ease;
}

.category-row:hover .row-edit-icon {
  opacity: 1;
}

/* 胎动/宫缩行的「查看」提示：点整行打开「每次明细」弹窗（不是编辑，故不显示铅笔） */
.row-view-hint {
  font-size: 12px;
  flex-shrink: 0;
  color: var(--primary-color, #c44680);
  opacity: 0.75;
  transition: opacity 0.15s ease;
}

.category-row:hover .row-view-hint {
  opacity: 1;
}

.toggle-group {
  display: flex;
  gap: 4px;
  background: #f5f5f5;
  border-radius: 6px;
  padding: 2px;
}

.toggle-btn {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #999;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}

.toggle-btn.active {
  background: #ff4d6a;
  color: #fff;
}

.action-icon {
  font-size: 18px;
  color: var(--text-hint, #94a3b8);
}

.link-icon {
  font-size: 22px;
  font-weight: 300;
}

.camera-icon {
  font-size: 18px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  min-height: 52px;
  transition: background 0.15s ease;
  gap: 12px;
}

.card-header:hover {
  background: rgba(248, 250, 252, 0.5);
}

.card-header:active {
  background: var(--bg-color, #f8fafc);
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.card-icon {
  font-size: 20px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}

.card-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color, #1e293b);
}

.card-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.card-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}

.card-preview {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  text-align: right;
  font-weight: 400;
}

.card-expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--text-hint, #94a3b8);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-expand-icon.is-open {
  transform: rotate(90deg);
}

.card-content-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-content-wrapper.is-open {
  grid-template-rows: 1fr;
}

.card-content {
  padding: 0 16px 14px;
  border-top: 1px solid var(--border-color, #f1f5f9);
  overflow: hidden;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 6px;
}

.detail-value-large {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.detail-unit {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-secondary, #64748b);
}

.detail-unit-sm {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-hint, #94a3b8);
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.meta-hint {
  font-size: 11px;
  color: var(--text-hint, #94a3b8);
  margin-left: 4px;
}

.detail-text {
  padding: 8px 0;
  font-size: 14px;
  color: var(--text-color, #1e293b);
  line-height: 1.7;
  word-break: break-word;
}

.diet-meal-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diet-meal-detail {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.diet-meal-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
.diet-meal-content {
  font-size: 14px;
  color: var(--text-color, #1e293b);
  line-height: 1.6;
}

.value-neutral {
  color: var(--text-color, #1e293b);
}

.value-normal {
  color: #22c55e;
}

.value-warning {
  color: #f59e0b;
}

.value-alert {
  color: #ef4444;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.tag-normal {
  background: #dcfce7;
  color: #166534;
}

.tag-warning {
  background: #fef3c7;
  color: #92400e;
}

.tag-alert {
  background: #fee2e2;
  color: #991b1b;
}

.tag-neutral {
  background: var(--bg-color, #f1f5f9);
  color: #64748b;
}

.bp-row {
  justify-content: center;
  gap: 24px;
  padding: 12px 0 8px;
}

.bp-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.bp-label {
  font-size: 11px;
  color: var(--text-hint, #94a3b8);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.bp-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.bp-unit {
  font-size: 11px;
  color: var(--text-hint, #94a3b8);
}

.bp-divider {
  font-size: 24px;
  font-weight: 300;
  color: var(--border-color, #cbd5e1);
  padding-top: 8px;
  line-height: 1;
}

.glucose-table {
  width: 100%;
  border-collapse: collapse;
  margin: 6px 0 2px;
  font-size: 13px;
}

.glucose-table th {
  text-align: left;
  padding: 8px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-hint, #94a3b8);
  border-bottom: 1px solid var(--border-color, #f1f5f9);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.glucose-table td {
  padding: 10px 6px;
  border-bottom: 1px solid var(--border-color, #f1f5f9);
  color: var(--text-color, #1e293b);
  font-weight: 500;
}

.glucose-table td:first-child {
  color: var(--text-secondary, #64748b);
  font-size: 13px;
}

.glucose-table td:last-child {
  text-align: right;
}

.glucose-table tr:last-child td {
  border-bottom: none;
}

.glucose-period {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.fhr-row {
  justify-content: center;
  gap: 16px;
}

.fhr-icon {
  font-size: 32px;
  line-height: 1;
}

.fhr-meta {
  justify-content: center;
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  background: var(--stage-early-bg, #FFF3E0);
  color: var(--stage-early-color, #E65100);
  line-height: 1.4;
  transition: transform 0.15s ease;
}

.tag-chip:active {
  transform: scale(0.96);
}

.sleep-main {
  justify-content: center;
  padding: 12px 0 8px;
}

.sleep-quality-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0 4px;
}

.sq-label {
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
  flex-shrink: 0;
  font-weight: 500;
}

.sq-bar-track {
  flex: 1;
  height: 8px;
  background: var(--bg-color, #f1f5f9);
  border-radius: 4px;
  overflow: hidden;
}

.sq-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.sq-bar-fill.value-normal {
  background: linear-gradient(90deg, #22c55e, #4ade80);
}

.sq-bar-fill.value-warning {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

.sq-bar-fill.value-alert {
  background: linear-gradient(90deg, #ef4444, #f87171);
}

.sq-text {
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 30px;
}

.exercise-main {
  justify-content: space-between;
  align-items: baseline;
}

.exercise-type {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.exercise-duration {
  font-size: 20px;
  font-weight: 700;
  color: var(--primary-color, #6366f1);
}

.exercise-bar {
  height: 6px;
  background: var(--bg-color, #f1f5f9);
  border-radius: 3px;
  margin: 10px 0 6px;
  overflow: hidden;
}

.exercise-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #6366f1, #a78bfa);
  transition: width 0.7s cubic-bezier(0.4, 0, 0.2, 1);
}

.med-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 0;
}

.med-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-color, #f8fafc);
  border-radius: 12px;
  border: 1px solid var(--border-color, #f1f5f9);
  transition: background 0.15s ease;
}

.med-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.med-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.med-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.med-dosage {
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
  font-weight: 400;
}

.mood-main {
  justify-content: center;
  padding: 12px 0 8px;
}

.mood-emoji-large {
  font-size: 48px;
  line-height: 1;
  transition: transform 0.3s ease;
}

.mood-emoji-large:active {
  transform: scale(1.1);
}

.mood-note {
  font-size: 14px;
  color: var(--text-secondary, #64748b);
  font-style: italic;
  line-height: 1.6;
}

.diary-content {
  padding: 6px 0;
}

.diary-html {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-color, #1e293b);
  word-break: break-word;
}

.diary-html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  margin: 8px 0;
}

.diary-html :deep(p) {
  margin: 6px 0;
}

.diary-text {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-color, #1e293b);
  white-space: pre-wrap;
  word-break: break-word;
}

.weight-main {
  justify-content: center;
  gap: 16px;
}

/* ====== 饮水 ====== */
.water-main {
  justify-content: center;
  gap: 12px;
  padding: 14px 0 8px;
}
.water-icon { font-size: 32px; }

/* ====== 体温 ====== */
.temp-main {
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0 8px;
}
.temp-icon { font-size: 28px; }

/* ====== 便便 ====== */
.stool-count {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
}

/* ====== 营养补充 ====== */
.supplement-chip {
  background: var(--stage-mid-bg, #E0F2FE);
  color: var(--stage-mid-color, #0369A1);
}

/* ====== 爱爱 ====== */
.intimacy-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}
.intimacy-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  background: #fef3c7;
  color: #92400e;
}
.intimacy-badge.protected {
  background: #dcfce7;
  color: #166534;
}
.intimacy-badge.unprotected {
  background: #fee2e2;
  color: #991b1b;
}

/* ====== 宫缩 ====== */
.contr-main {
  gap: 16px;
  padding: 10px 0 6px;
}
.contr-icon { font-size: 26px; }
.contr-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
}
.contr-interval {
  display: block;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  margin-top: 2px;
}

/* ====== 胎动 ====== */
.fm-main {
  gap: 16px;
  padding: 10px 0 6px;
}
.fm-icon { font-size: 26px; }
.fm-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
}
.fm-duration {
  display: block;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  margin-top: 2px;
}

/* ====== hCG / 尿酸 ====== */
.hcg-main, .ua-main {
  justify-content: center;
  gap: 12px;
  padding: 12px 0 8px;
}
.hcg-icon, .ua-icon { font-size: 28px; }

/* ============ 电脑端适配 ============ */
@media (min-width: 769px) {
  .record-list {
    width: 100%;
    padding: 0;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: transparent;
    border-radius: 0;
    border: none;
    box-shadow: none;
    padding: 0;
    overflow: visible;
  }

  .category-item {
    background: var(--bg-card, #ffffff);
    border-radius: 14px;
    border: 1px solid var(--border-color, #f1f5f9);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    border-bottom: none;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .category-item:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .category-item:last-child {
    border-bottom: none;
  }

  .category-row {
    padding: 16px 18px;
    min-height: 56px;
  }

  .category-row:hover {
    background: transparent;
  }

  .row-icon {
    width: 40px;
    height: 40px;
    font-size: 22px;
    border-radius: 12px;
  }

  .row-label {
    font-size: 15px;
  }

  .add-circle {
    width: 28px;
    height: 28px;
    font-size: 18px;
  }

  .row-preview {
    font-size: 13px;
    max-width: 180px;
  }

  .toggle-btn {
    padding: 6px 16px;
    font-size: 14px;
  }

  .detail-value-large {
    font-size: 32px;
  }

  .bp-value {
    font-size: 36px;
  }

  .glucose-table {
    font-size: 14px;
  }

  .tag-chip {
    padding: 8px 20px;
    font-size: 14px;
  }

  .med-item {
    padding: 12px 16px;
  }

  .mood-emoji-large {
    font-size: 56px;
  }
}

/* ============ 手机端适配 ============ */
@media (max-width: 768px) {
  .record-list {
    padding: 0;
  }

  .category-list {
    padding: 0;
  }

  .category-item {
    border-bottom: 1px solid var(--border-color, #f0f0f0);
  }

  .category-row {
    padding: 12px 16px;
    min-height: 48px;
  }

  .row-icon {
    width: 34px;
    height: 34px;
    font-size: 18px;
    border-radius: 8px;
  }

  .row-label {
    font-size: 15px;
  }

  .add-circle {
    width: 26px;
    height: 26px;
    font-size: 17px;
  }

  .row-preview {
    font-size: 13px;
    max-width: 150px;
  }

  .toggle-group {
    gap: 3px;
  }

  .toggle-btn {
    padding: 5px 10px;
    font-size: 13px;
  }

  .detail-value-large {
    font-size: 26px;
  }

  .detail-unit {
    font-size: 13px;
  }

  .bp-value {
    font-size: 30px;
  }

  .bp-divider {
    font-size: 22px;
  }

  .glucose-table {
    font-size: 13px;
  }

  .glucose-table th {
    font-size: 11px;
  }

  .glucose-table td {
    padding: 8px 4px;
    font-size: 13px;
  }

  .tag-chips {
    gap: 6px;
  }

  .tag-chip {
    padding: 6px 14px;
    font-size: 13px;
  }

  .med-item {
    padding: 10px 12px;
    gap: 10px;
  }

  .med-name {
    font-size: 14px;
  }

  .mood-emoji-large {
    font-size: 44px;
  }

  .exercise-type {
    font-size: 15px;
  }

  .exercise-duration {
    font-size: 18px;
  }

  .diary-html,
  .diary-text,
  .detail-text {
    font-size: 14px;
  }
}

/* ============ 超小屏幕适配 (< 375px) ============ */
@media (max-width: 374px) {
  .category-row {
    padding: 10px 12px;
  }

  .row-icon {
    width: 30px;
    height: 30px;
    font-size: 16px;
    border-radius: 8px;
  }

  .row-label {
    font-size: 14px;
  }

  .add-circle {
    width: 22px;
    height: 22px;
    font-size: 15px;
  }

  .detail-value-large {
    font-size: 24px;
  }

  .bp-value {
    font-size: 28px;
  }
}
</style>
