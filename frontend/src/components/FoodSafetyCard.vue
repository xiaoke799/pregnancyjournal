<template>
  <div class="food-safety-card" :class="'level-' + currentSafetyLevel">
    <!-- 收起状态：紧凑展示 -->
    <div class="card-main" @click="expanded = !expanded">
      <!-- 左侧：食物名 + 当前阶段状态 -->
      <div class="card-left">
        <span class="food-name">{{ item.name }}</span>
        <span class="current-stage-badge" :class="'badge-' + currentSafetyLevel">
          {{ stageLabel(currentStage) }}: {{ safetyText(currentSafetyLevel) }}
        </span>
      </div>

      <!-- 右侧：其他阶段快速预览 -->
      <div class="stage-mini-list">
        <span
          v-for="s in otherStages"
          :key="s.key"
          class="mini-stage"
          :class="'mini-' + getSafety(s.key)"
          :title="`${s.label}: ${safetyText(getSafety(s.key))}`"
        >
          {{ s.shortLabel }}{{ miniIcon(getSafety(s.key)) }}
        </span>
      </div>

      <span class="expand-icon">{{ expanded ? '▲' : '▼' }}</span>
    </div>

    <!-- 展开状态：详细建议 -->
    <transition name="slide">
      <div v-if="expanded" class="card-detail">
        <!-- 当前阶段大卡片 -->
        <div class="detail-current-stage" :class="'bg-' + currentSafetyLevel">
          <div class="detail-current-header">
            <span class="detail-current-icon">{{ mainIcon(currentSafetyLevel) }}</span>
            <div class="detail-current-text">
              <span class="detail-current-title">{{ stageLabel(currentStage) }}结论</span>
              <span class="detail-current-verdict">{{ safetyVerdict(currentSafetyLevel) }}</span>
            </div>
          </div>
        </div>

        <!-- 分阶段详细说明 -->
        <div class="detail-stages-grid">
          <div
            v-for="s in stageList"
            :key="s.key"
            class="detail-stage-cell"
            :class="{ 'is-current': s.key === currentStage }"
          >
            <div class="cell-header">
              <span class="cell-stage">{{ s.label }}</span>
              <span class="cell-status" :class="'status-' + getSafety(s.key)">
                {{ safetyText(getSafety(s.key)) }}
              </span>
            </div>
            <p class="cell-advice">{{ stageAdvice(s.key, getSafety(s.key)) }}</p>
          </div>
        </div>

        <!-- 备注 -->
        <div class="detail-note-section" v-if="item.note">
          <span class="note-label">📝 备注</span>
          <p class="note-content">{{ item.note }}</p>
        </div>

        <!-- 食用建议 -->
        <div class="detail-tips" v-if="currentSafetyLevel !== 'safe'">
          <span class="tips-title">💡 食用建议</span>
          <ul class="tips-list">
            <li v-for="(tip, i) in eatingTips(currentSafetyLevel)" :key="i">{{ tip }}</li>
          </ul>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface FoodSafetyItem {
  name: string
  safety_by_stage: Record<string, string>
  note: string
  image: string | null
}

const props = defineProps<{
  item: FoodSafetyItem
  currentStage: string
}>()

const expanded = ref(false)

/** 阶段列表 */
const stageList = [
  { key: 'preparing', label: '备孕期', shortLabel: '备' },
  { key: 'early', label: '孕早期(0-12周)', shortLabel: '早' },
  { key: 'mid', label: '孕中期(13-27周)', shortLabel: '中' },
  { key: 'late', label: '孕晚期(28-40周)', shortLabel: '晚' },
  { key: 'nursing', label: '哺乳期', shortLabel: '哺' },
]

/** 当前阶段以外的其他阶段 */
const otherStages = computed(() => stageList.filter(s => s.key !== props.currentStage))

/** 当前安全等级 */
const currentSafetyLevel = computed(() => getSafety(props.currentStage))

function getSafety(stage: string): string {
  return props.item.safety_by_stage?.[stage] || 'caution'
}

function stageLabel(key: string): string {
  const found = stageList.find(s => s.key === key)
  return found?.label || key
}

function safetyText(level: string): string {
  switch (level) {
    case 'safe': return '可以吃'
    case 'caution': return '适量吃'
    case 'unsafe': return '不建议'
    case 'limit': return '少吃'
    default: return '谨慎'
  }
}

function safetyVerdict(level: string): string {
  switch (level) {
    case 'safe': return '✅ 可以放心食用'
    case 'caution': return '⚠️ 可以适量食用，注意控制量'
    case 'unsafe': return '❌ 建议避免食用'
    case 'limit': return '🔶 偶尔少量可以，不宜多吃'
    default: return '⚠️ 请咨询医生'
  }
}

function miniIcon(level: string): string {
  switch (level) {
    case 'safe': return '●'
    case 'caution': return '◐'
    case 'unsafe': return '✕'
    case 'limit': return '◑'
    default: return '?'
  }
}

function mainIcon(level: string): string {
  switch (level) {
    case 'safe': return '✅'
    case 'caution': return '⚠️'
    case 'unsafe': return '🚫'
    case 'limit': return '🔶'
    default: return '❓'
  }
}

/** 根据阶段和安全等级给出具体建议 */
function stageAdvice(stage: string, level: string): string {
  const name = props.item.name
  if (level === 'safe') {
    const advices: Record<string, string> = {
      preparing: `${name}营养丰富，备孕期间可正常食用。`,
      early: `孕早期${name}是很好的营养来源，有助于补充叶酸和维生素。`,
      mid: `孕中期${name}能提供优质营养，建议每周食用2-3次。`,
      late: `孕晚期${name}有助于胎儿发育和母体健康，可放心食用。`,
      nursing: `哺乳期${name}富含营养，对产后恢复和母乳质量都有帮助。`,
    }
    return advices[stage] || `${name}此阶段可以正常食用。`
  }
  if (level === 'caution') {
    const advices: Record<string, string> = {
      preparing: `备孕期间${name}可少量食用，不必完全避免。`,
      early: `孕早期建议减少${name}的摄入量，或选择替代食物。`,
      mid: `孕中期${name}可以吃，但注意不要过量，每周1-2次为宜。`,
      late: `孕晚期${name}要控制摄入量，避免影响分娩。`,
      nursing: `哺乳期${name}基本无碍，但要注意观察宝宝反应。`,
    }
    return advices[stage] || `${name}此阶段需谨慎，建议咨询医生后决定。`
  }
  if (level === 'unsafe') {
    const advices: Record<string, string> = {
      preparing: `备孕期间尽量避免${name}，选择更安全的替代品。`,
      early: `⛔ 孕早期${name}可能影响胚胎发育，强烈建议避免！`,
      mid: `孕中期${name}风险较高，建议用其他食物替代。`,
      late: `孕晚期${name}可能引发宫缩或其他问题，请勿食用。`,
      nursing: `哺乳期${name}可能通过母乳影响宝宝，建议暂停食用。`,
    }
    return advices[stage] || `${name}此阶段不建议食用，请遵医嘱。`
  }
  // limit
  const advices: Record<string, string> = {
    preparing: `备孕期间${name}偶尔少量即可，不要经常吃。`,
    early: `孕早期${name}每月不超过1-2次，每次少量。`,
    mid: `孕中期${name}每周最多1次，注意分量控制。`,
    late: `孕晚期尽量不吃${name}，如需食用务必极少。`,
    nursing: `哺乳期${name}应严格限制摄入量。`,
  }
  return advices[stage] || `${name}此阶段需要限制摄入量。`
}

/** 食用建议 */
function eatingTips(level: string): string[] {
  const name = props.item.name
  if (level === 'caution') {
    return [
      `每次食用${name}控制在合理份量内`,
      `如有不适（腹痛、过敏等）立即停止`,
      `优先选择新鲜、卫生的${name}`,
      `烹饪时充分加热，避免生食`,
    ]
  }
  if (level === 'unsafe') {
    return [
      `当前阶段请完全避免${name}`,
      `可以用以下替代：根据个人情况选择同类安全食材`,
      `如果误食无需过度紧张，观察身体反应`,
      `有疑问请及时咨询产科医生`,
    ]
  }
  if (level === 'limit') {
    return [
      `${name}虽好但不可贪多`,
      `控制频率：每两周最多一次`,
      `搭配其他均衡饮食一起食用`,
    ]
  }
  return []
}
</script>

<style scoped>
.food-safety-card {
  background: var(--bg-card, white);
  border-radius: var(--radius-lg, 12px);
  margin-bottom: 10px;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
  overflow: hidden;
  border-left: 4px solid #e2e8f0;
  transition: border-color .2s;
}
.food-safety-card.level-safe { border-left-color: #52C41A; }
.food-safety-card.level-caution { border-left-color: #FAAD14; }
.food-safety-card.level-unsafe { border-left-color: #FF4D4F; }
.food-safety-card.level-limit { border-left-color: #FF9800; }

/* 主行 */
.card-main {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; cursor: pointer;
  transition: background .15s;
}
.card-main:hover { background: #f8fafc; }

.card-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.food-name { font-size: 15px; font-weight: 700; color: var(--text-color); }
.current-stage-badge {
  padding: 2px 10px; border-radius: 8px; font-size: 11px; font-weight: 600;
  white-space: nowrap; flex-shrink: 0;
}
.badge-safe { background: #F6FFED; color: #52C41A; }
.badge-caution { background: #FFFBE6; color: #FAAD14; }
.badge-unsafe { background: #FFF2F0; color: #FF4D4F; }
.badge-limit { background: #FFF7E6; color: #FF9800; }

/* 右侧小标签 */
.stage-mini-list { display: flex; gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
.mini-stage {
  padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: 600;
  white-space: nowrap;
}
.mini-safe { background: #F6FFED; color: #52C41A; }
.mini-caution { background: #FFFBE6; color: #D48806; }
.mini-unsafe { background: #FFF2F0; color: #FF4D4F; }
.mini-limit { background: #FFF7E6; color: #FF9800; }

.expand-icon { font-size: 10px; color: #94a3b8; margin-left: 4px; flex-shrink: 0; }

/* ========== 详情展开区 ========== */
.card-detail { padding: 0 14px 14px; }

/* 当前阶段大卡片 */
.detail-current-stage {
  border-radius: 10px; padding: 16px; margin-bottom: 14px;
}
.bg-safe { background: linear-gradient(135deg, #F6FFED, #D9F7BE); }
.bg-caution { background: linear-gradient(135deg, #FFFBE6, #FFF1B8); }
.bg-unsafe { background: linear-gradient(135deg, #FFF2F0, #FFCCC7); }
.bg-limit { background: linear-gradient(135deg, #FFF7E6, #FFE7BA); }

.detail-current-header { display: flex; align-items: center; gap: 12px; }
.detail-current-icon { font-size: 32px; flex-shrink: 0; }
.detail-current-text { display: flex; flex-direction: column; gap: 2px; }
.detail-current-title { font-size: 13px; color: #64748b; font-weight: 500; }
.detail-current-verdict { font-size: 17px; font-weight: 800; }

/* 分阶段网格 */
.detail-stages-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;
}
.detail-stage-cell {
  padding: 10px 12px; border-radius: 8px; background: #f8fafc;
  border: 1px solid transparent; transition: border-color .2s;
}
.detail-stage-cell.is-current {
  background: white; border-color: var(--primary-color, #e8a0bf);
  box-shadow: 0 1px 4px rgba(232,160,191,.15);
}
.cell-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.cell-stage { font-size: 12px; font-weight: 600; color: #334155; }
.cell-status {
  padding: 1px 7px; border-radius: 6px; font-size: 10px; font-weight: 700;
}
.status-safe { background: #F6FFED; color: #52C41A; }
.status-caution { background: #FFFBE6; color: #D48806; }
.status-unsafe { background: #FFF2F0; color: #FF4D4F; }
.status-limit { background: #FFF7E6; color: #FF9800; }
.cell-advice { font-size: 11.5px; color: #64748b; line-height: 1.6; margin: 0; }

/* 备注 */
.detail-note-section { margin-bottom: 12px; }
.note-label { font-size: 12px; font-weight: 700; color: #475569; }
.note-content { font-size: 13px; color: #64748b; line-height: 1.7; margin: 4px 0 0; padding: 8px 12px; background: #f8fafc; border-radius: 8px; }

/* 食用建议 */
.detail-tips { padding: 10px 12px; background: #EFF6FF; border-radius: 8px; border-left: 3px solid #4FC3F7; }
.tips-title { font-size: 12px; font-weight: 700; color: #0369A1; display: block; margin-bottom: 6px; }
.tips-list { margin: 0; padding-left: 18px; }
.tips-list li { font-size: 12px; color: #475569; line-height: 1.8; }

/* 动画 */
.slide-enter-active, .slide-leave-active { transition: max-height .25s ease, opacity .25s ease, margin-bottom .25s ease, padding-bottom .25s ease, padding-top .25s ease; overflow: hidden; }
.slide-enter-from, .slide-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: 0; }

/* 移动端适配 */
@media (max-width: 600px) {
  .card-main { padding: 10px 12px; flex-wrap: wrap; }
  .food-name { font-size: 14px; }
  .stage-mini-list { order: 3; width: 100%; margin-top: 6px; justify-content: flex-start; }
  .detail-stages-grid { grid-template-columns: 1fr; }
  .detail-current-icon { font-size: 26px; }
  .detail-current-verdict { font-size: 15px; }
  .cell-advice { font-size: 11px; }
}
@media (max-width: 400px) {
  .mini-stage { font-size: 9px; padding: 1px 4px; }
}
</style>
