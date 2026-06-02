<template>
  <div class="setup-wizard">
    <!-- 步骤指示器 -->
    <div class="step-indicator">
      <div
        v-for="(s, idx) in steps"
        :key="idx"
        class="step-dot"
        :class="{ active: currentStep === idx + 1, done: currentStep > idx + 1 }"
      >
        <span class="step-num">{{ currentStep > idx + 1 ? '✓' : idx + 1 }}</span>
        <span class="step-label">{{ s.label }}</span>
      </div>
    </div>

    <div class="wizard-card">
      <!-- Step 1: 选择阶段 -->
      <div v-if="currentStep === 1" class="step-content">
        <div class="step-icon">🎯</div>
        <h2>选择当前阶段</h2>
        <p class="step-desc">请选择您目前所处的阶段</p>

        <div class="stage-options">
          <div
            v-for="s in stageOptions"
            :key="s.value"
            class="stage-card"
            :class="{ selected: form.stage === s.value }"
            :style="{ borderColor: form.stage === s.value ? s.color : '' }"
            @click="form.stage = s.value"
          >
            <span class="stage-icon">{{ s.icon }}</span>
            <div class="stage-name">{{ s.label }}</div>
            <div class="stage-desc">{{ s.desc }}</div>
          </div>
        </div>
      </div>

      <!-- Step 2: 设置预产期 -->
      <div v-if="currentStep === 2" class="step-content">
        <div class="step-icon">📅</div>
        <h2>设置预产期</h2>
        <p class="step-desc">请选择一种方式设置您的预产期</p>

        <div class="due-date-mode">
          <n-radio-group v-model:value="dueDateMode" name="dueDateMode">
            <n-radio value="direct">手动输入预产期</n-radio>
            <n-radio value="lmp">输入末次月经日期推算</n-radio>
          </n-radio-group>
        </div>

        <div class="date-input-area">
          <template v-if="dueDateMode === 'direct'">
            <div class="form-group">
              <label>预产期日期</label>
              <input
                type="date"
                v-model="form.dueDate"
                class="native-date-input"
              />
            </div>
          </template>
          <template v-else>
            <div class="form-group">
              <label>末次月经首日</label>
              <input
                type="date"
                v-model="form.lastPeriodDate"
                class="native-date-input"
              />
            </div>
            <div v-if="form.lastPeriodDate" class="calculated-due">
              <span class="calc-label">推算预产期：</span>
              <span class="calc-value">{{ calculatedDueDate }}</span>
            </div>
          </template>
        </div>

        <div class="form-group" style="margin-top: 16px;">
          <label>宝宝昵称（可选）</label>
          <n-input v-model:value="form.babyName" placeholder="给宝宝取个昵称" />
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="wizard-actions">
        <n-button v-if="currentStep > 1" @click="prevStep">上一步</n-button>
        <div v-else></div>
        <n-button
          v-if="currentStep < totalSteps"
          type="primary"
          :disabled="!canNext"
          @click="nextStep"
        >
          下一步
        </n-button>
        <n-button
          v-else
          type="primary"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="submitSetup"
        >
          完成设置
        </n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NInput, NRadioGroup, NRadio, useMessage } from 'naive-ui'
import { setupWizard } from '@/api/app-config'
import { resetSetupCheck } from '@/router'
import { usePregnancyStore } from '@/stores/pregnancy'
import dayjs from 'dayjs'

const router = useRouter()
const message = useMessage()
const pregnancyStore = usePregnancyStore()

const currentStep = ref(1)
const totalSteps = ref(2)
const submitting = ref(false)
const dueDateMode = ref<'direct' | 'lmp'>('lmp')

const form = ref({
  stage: '',
  dueDate: '',
  lastPeriodDate: '',
  babyName: '',
})

const steps = [
  { label: '选择阶段' },
  { label: '设置预产期' },
]

const stageOptions = [
  { value: 'preparing', label: '备孕', icon: '🌱', desc: '正在积极备孕中', color: 'var(--stage-preparing-color)' },
  { value: 'pregnant', label: '怀孕', icon: '🤰', desc: '已经怀孕了', color: 'var(--stage-early-color)' },
  { value: 'nursing', label: '育儿', icon: '👶', desc: '宝宝已经出生了', color: 'var(--stage-nursing-color)' },
]

/** 根据末次月经推算预产期 */
const calculatedDueDate = computed(() => {
  if (!form.value.lastPeriodDate) return ''
  return dayjs(form.value.lastPeriodDate).add(280, 'day').format('YYYY-MM-DD')
})

/** 是否可以进入下一步 */
const canNext = computed(() => {
  if (currentStep.value === 1) return !!form.value.stage
  return true
})

/** 是否可以提交 */
const canSubmit = computed(() => {
  if (form.value.stage === 'pregnant') {
    if (dueDateMode.value === 'direct') {
      return !!form.value.dueDate
    } else {
      return !!form.value.lastPeriodDate
    }
  }
  return true
})

onMounted(() => {
  // setup wizard is self-contained
})

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

function nextStep() {
  if (currentStep.value === 1) {
    if (form.value.stage !== 'pregnant') {
      submitSetup()
      return
    }
  }
  if (currentStep.value < totalSteps.value) {
    currentStep.value++
  }
}

async function submitSetup() {
  submitting.value = true
  try {
    let dueDate = form.value.dueDate
    let lastPeriodDate = form.value.lastPeriodDate

    // 如果选择末次月经推算
    if (form.value.stage === 'pregnant' && dueDateMode.value === 'lmp' && lastPeriodDate) {
      dueDate = dayjs(lastPeriodDate).add(280, 'day').format('YYYY-MM-DD')
    }

    // 非 pregnant 阶段不需要预产期
    if (form.value.stage !== 'pregnant') {
      dueDate = undefined as any
      lastPeriodDate = undefined as any
    }

    const res: any = await setupWizard({
      storage_dir: '',
      stage: form.value.stage,
      due_date: dueDate,
      last_period_date: lastPeriodDate,
      baby_name: form.value.babyName || undefined,
    })

    if (res.code === 0) {
      message.success('设置完成！')
      resetSetupCheck()
      await pregnancyStore.fetchActivePregnancy()
      router.push('/')
    } else {
      message.error(res.message || '设置失败')
    }
  } catch (err: any) {
    message.error(err?.message || '设置失败，请重试')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.setup-wizard {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #FDF2F8, #F5F3FF);
  padding: 20px;
}

.step-indicator {
  display: flex;
  gap: 32px;
  margin-bottom: 32px;
}

.step-dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.step-num {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  background: #e2e8f0;
  color: #94a3b8;
  transition: all 0.3s;
}

.step-dot.active .step-num {
  background: var(--primary-color, #e8a0bf);
  color: white;
}

.step-dot.done .step-num {
  background: #52c41a;
  color: white;
}

.step-label {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.step-dot.active .step-label {
  color: var(--primary-color, #e8a0bf);
  font-weight: 600;
}

.wizard-card {
  background: white;
  border-radius: var(--radius-xl, 16px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  padding: 40px;
  max-width: 520px;
  width: 100%;
}

.step-content {
  min-height: 320px;
}

.step-icon {
  font-size: 48px;
  text-align: center;
  margin-bottom: 16px;
}

.step-content h2 {
  text-align: center;
  font-size: 22px;
  color: var(--text-color, #1e293b);
  margin-bottom: 8px;
}

.step-desc {
  text-align: center;
  color: var(--text-secondary, #64748b);
  margin-bottom: 24px;
  font-size: 14px;
}

.stage-options {
  display: flex;
  gap: 14px;
  justify-content: center;
}

.stage-card {
  flex: 1;
  padding: 24px 16px;
  border: 2px solid var(--border-color, #e2e8f0);
  border-radius: var(--radius-lg, 12px);
  text-align: center;
  cursor: pointer;
  transition: background 0.2s, border-width 0.2s, box-shadow 0.2s, transform 0.2s;
}

.stage-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.stage-card.selected {
  border-width: 2px;
  background: rgba(232, 160, 191, 0.04);
}

.stage-icon {
  font-size: 40px;
  display: block;
  margin-bottom: 8px;
}

.stage-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-color, #1e293b);
}

.stage-desc {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
}

.due-date-mode {
  margin-bottom: 20px;
}

.date-input-area {
  min-height: 80px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--text-secondary, #64748b);
}

.native-date-input {
  width: 100%;
  padding: 10px 14px;
  border: 2px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  font-size: 15px;
  background: white;
  color: var(--text-color, #1e293b);
  -webkit-appearance: none;
}

.calculated-due {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--stage-early-bg, #FFF3E0);
  border-radius: var(--radius-md, 8px);
  text-align: center;
}

.calc-label {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.calc-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--stage-early-color, #FFB74D);
}

.wizard-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color, #e2e8f0);
}

@media (max-width: 600px) {
  .wizard-card {
    padding: 24px 16px;
  }

  .stage-options {
    flex-direction: column;
  }

  .step-indicator {
    gap: 16px;
  }
}
</style>
