<template>
  <n-modal v-model:show="visible" preset="card" :title="editRecord ? '编辑记录' : '添加记录'" style="max-width: 620px; width: 90vw;">
    <div class="add-record-form">
      <!-- 记录类型选择 -->
      <div v-if="!editRecord" class="type-selector">
        <div
          v-for="t in recordTypes"
          :key="t.value"
          class="type-tag"
          :class="{ selected: selectedType === t.value }"
          @click="selectedType = t.value"
        >
          <span class="type-icon">{{ t.icon }}</span>
          <span class="type-label">{{ t.label }}</span>
        </div>
      </div>

      <!-- 动态表单 -->
      <div class="form-area">
        <!-- 体重 -->
        <template v-if="selectedType === 'weight'">
          <div class="form-group">
            <label>体重 (kg)</label>
            <n-input-number v-model:value="formData.weight" :min="30" :max="200" :step="0.1" placeholder="请输入体重" style="width: 100%" />
          </div>
        </template>

        <!-- 血压 -->
        <template v-if="selectedType === 'blood_pressure'">
          <div class="form-row">
            <div class="form-group flex-1">
              <label>收缩压 (mmHg)</label>
              <n-input-number v-model:value="formData.bpSystolic" :min="60" :max="200" placeholder="收缩压" style="width: 100%" />
            </div>
            <div class="form-group flex-1">
              <label>舒张压 (mmHg)</label>
              <n-input-number v-model:value="formData.bpDiastolic" :min="40" :max="140" placeholder="舒张压" style="width: 100%" />
            </div>
          </div>
        </template>

        <!-- 血糖 -->
        <template v-if="selectedType === 'blood_glucose'">
          <div class="form-group">
            <label>测量时间</label>
            <n-radio-group v-model:value="formData.glucoseTime" size="small">
              <n-radio-button value="fasting">空腹</n-radio-button>
              <n-radio-button value="1h">餐后1h</n-radio-button>
              <n-radio-button value="2h">餐后2h</n-radio-button>
            </n-radio-group>
          </div>
          <div class="form-group">
            <label>血糖值 (mmol/L)</label>
            <n-input-number v-model:value="formData.glucoseValue" :min="0" :max="30" :step="0.1" placeholder="血糖值" style="width: 100%" />
          </div>
        </template>

        <!-- 胎动 -->
        <template v-if="selectedType === 'fetal_movement'">
          <div class="form-row">
            <div class="form-group flex-1">
              <label>胎动次数</label>
              <n-input-number v-model:value="formData.fetalMovementCount" :min="0" :max="200" placeholder="次数" style="width: 100%" />
            </div>
            <div class="form-group flex-1">
              <label>时长 (分钟)</label>
              <n-input-number v-model:value="formData.fetalMovementDuration" :min="0" :max="120" placeholder="分钟" style="width: 100%" />
            </div>
          </div>
        </template>

        <!-- 宫缩 -->
        <template v-if="selectedType === 'contraction'">
          <div class="form-row">
            <div class="form-group flex-1">
              <label>开始时间</label>
              <n-time-picker v-model:formatted-value="formData.contractionStart" format="HH:mm" placeholder="开始" style="width: 100%" />
            </div>
            <div class="form-group flex-1">
              <label>结束时间</label>
              <n-time-picker v-model:formatted-value="formData.contractionEnd" format="HH:mm" placeholder="结束" style="width: 100%" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label>间隔 (分钟)</label>
              <n-input-number v-model:value="formData.contractionInterval" :min="0" :max="60" placeholder="间隔" style="width: 100%" />
            </div>
            <div class="form-group flex-1">
              <label>疼痛程度</label>
              <n-select v-model:value="formData.contractionPain" :options="[
                { label: '轻微', value: '轻微' },
                { label: '中度', value: '中度' },
                { label: '剧烈', value: '剧烈' },
              ]" placeholder="选择疼痛程度" style="width: 100%" />
            </div>
          </div>
        </template>

        <!-- 症状 -->
        <template v-if="selectedType === 'symptoms'">
          <div class="symptom-tags">
            <span
              v-for="s in symptomOptions"
              :key="s"
              class="symptom-tag"
              :class="{ selected: formData.symptoms.includes(s) }"
              @click="toggleSymptom(s)"
            >
              {{ s }}
            </span>
          </div>
        </template>

        <!-- 用药 -->
        <template v-if="selectedType === 'medication'">
          <div class="form-group">
            <label>药品名称</label>
            <n-input v-model:value="formData.medName" placeholder="请输入药品名称" />
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label>剂量</label>
              <n-input v-model:value="formData.medDosage" placeholder="如 500mg" />
            </div>
            <div class="form-group flex-1">
              <label>频率</label>
              <n-input v-model:value="formData.medFrequency" placeholder="如 一日三次" />
            </div>
          </div>
        </template>

        <!-- 饮食（三餐+加餐列表） -->
        <template v-if="selectedType === 'diet'">
          <div class="diet-meals-list">
            <div v-for="(meal, idx) in formData.dietMeals" :key="idx" class="diet-meal-item">
              <div class="diet-meal-row">
                <n-select v-model:value="meal.type" :options="dietMealOptions" size="small" style="width: 90px" />
                <n-input v-model:value="meal.content" type="textarea" placeholder="记录吃了什么..." :rows="2" style="flex: 1" />
                <n-button v-if="formData.dietMeals.length > 1" quaternary circle type="error" size="small" @click="removeDietMeal(idx)" style="margin-left: 4px; flex-shrink: 0">×</n-button>
              </div>
            </div>
            <n-button dashed block @click="addDietMeal" style="margin-top: 8px">+ 添加一餐</n-button>
          </div>
        </template>

        <!-- 好习惯 -->
        <template v-if="selectedType === 'habit'">
          <div class="form-group">
            <label>好习惯内容</label>
            <n-input v-model:value="formData.habitText" type="textarea" placeholder="记录今天坚持的好习惯..." :rows="3" />
          </div>
        </template>

        <!-- 运动 -->
        <template v-if="selectedType === 'exercise'">
          <div class="form-group">
            <label>运动类型</label>
            <n-input v-model:value="formData.exerciseType" placeholder="如 散步、瑜伽、游泳" />
          </div>
          <div class="form-group">
            <label>运动时长 (分钟)</label>
            <n-input-number v-model:value="formData.exerciseDuration" :min="0" :max="300" placeholder="分钟" style="width: 100%" />
          </div>
        </template>

        <!-- 睡眠 -->
        <template v-if="selectedType === 'sleep'">
          <div class="form-row">
            <div class="form-group flex-1">
              <label>入睡时间</label>
              <n-select v-model:value="formData.sleepBedtime" :options="timeOptions" placeholder="选择" filterable style="width: 100%" />
            </div>
            <div class="form-group flex-1">
              <label>起床时间</label>
              <n-select v-model:value="formData.sleepWaketime" :options="timeOptions" placeholder="选择" filterable style="width: 100%" />
            </div>
          </div>
          <div class="form-group">
            <label>睡眠质量</label>
            <div class="sleep-quality-group">
              <button
                v-for="sq in sleepQualityOptions"
                :key="sq.value"
                class="sleep-quality-btn"
                :class="{ active: formData.sleepQuality === sq.value }"
                @click="formData.sleepQuality = sq.value as 'good' | 'fair' | 'poor'"
              >{{ sq.label }}</button>
            </div>
          </div>
        </template>

        <!-- 饮水 -->
        <template v-if="selectedType === 'water'">
          <div class="form-group">
            <label>饮水量 (ml)</label>
            <n-input-number v-model:value="formData.waterIntake" :min="0" :max="5000" :step="100" placeholder="如：1500" style="width: 100%" />
          </div>
          <div class="form-hint">💡 孕期建议每日饮水1500-2000ml</div>
        </template>

        <!-- 排便 -->
        <template v-if="selectedType === 'stool'">
          <div class="form-group">
            <label>排便次数</label>
            <n-input-number v-model:value="formData.stoolCount" :min="0" :max="10" placeholder="次数" style="width: 100%" />
          </div>
          <div class="form-group">
            <label>便质</label>
            <n-radio-group v-model:value="formData.stoolConsistency" size="small">
              <n-radio-button value="hard">干硬</n-radio-button>
              <n-radio-button value="normal">正常</n-radio-button>
              <n-radio-button value="soft">偏软</n-radio-button>
              <n-radio-button value="diarrhea">腹泻</n-radio-button>
            </n-radio-group>
          </div>
          <div class="form-group">
            <label>颜色</label>
            <n-radio-group v-model:value="formData.stoolColor" size="small">
              <n-radio-button value="brown">棕色</n-radio-button>
              <n-radio-button value="dark">深色</n-radio-button>
              <n-radio-button value="green">绿色</n-radio-button>
              <n-radio-button value="yellow">黄色</n-radio-button>
            </n-radio-group>
          </div>
        </template>

        <!-- 体温 -->
        <template v-if="selectedType === 'temperature'">
          <div class="form-group">
            <label>体温 (℃)</label>
            <n-input-number v-model:value="formData.bodyTemperature" :min="35" :max="42" :step="0.1" placeholder="如：36.5" style="width: 100%" />
          </div>
          <div class="form-hint">💡 孕期正常体温略高，36.5-37.2℃为正常范围</div>
        </template>

        <!-- HCG -->
        <template v-if="selectedType === 'hcg'">
          <div class="form-group">
            <label>HCG 值 (mIU/mL)</label>
            <n-input-number v-model:value="formData.hcgValue" :min="0" :step="1" placeholder="如：50000" style="width: 100%" />
          </div>
          <div class="form-group">
            <label>孕周</label>
            <n-input-number v-model:value="formData.hcgWeeks" :min="0" :max="42" :step="0.1" placeholder="如：6.5" style="width: 100%" />
          </div>
          <div class="form-hint">💡 孕8-10周达到峰值，之后逐渐下降</div>
        </template>

        <!-- 尿酸 -->
        <template v-if="selectedType === 'uric_acid'">
          <div class="form-group">
            <label>尿酸 (μmol/L)</label>
            <n-input-number v-model:value="formData.uricAcid" :min="0" :max="1000" :step="1" placeholder="如：280" style="width: 100%" />
          </div>
          <div class="form-group">
            <label>时段</label>
            <n-select v-model:value="formData.uricAcidPeriod" :options="[
              { label: '空腹', value: '空腹' },
              { label: '餐后2小时', value: '餐后2小时' },
            ]" placeholder="选择时段" style="width: 100%" />
          </div>
          <div class="form-hint">💡 女性正常范围155-357 μmol/L</div>
        </template>

        <!-- 营养补充 -->
        <template v-if="selectedType === 'supplement'">
          <div class="form-group">
            <label>今日补充</label>
            <div class="tag-grid">
              <span v-for="s in supplementOptions" :key="s"
                class="supp-tag" :class="{ selected: formData.supplementItems.includes(s) }"
                @click="toggleSupplement(s)">{{ s }}</span>
            </div>
          </div>
        </template>

        <!-- 爱爱 -->
        <template v-if="selectedType === 'intimacy'">
          <div class="form-group">
            <label>是否发生</label>
            <div class="intimacy-toggle">
              <button
                class="intimacy-btn"
                :class="{ active: formData.intimacyHappened === true }"
                @click="formData.intimacyHappened = true"
              >是</button>
              <button
                class="intimacy-btn"
                :class="{ active: formData.intimacyHappened === false }"
                @click="formData.intimacyHappened = false"
              >否</button>
            </div>
          </div>
          <div class="form-group" v-if="formData.intimacyHappened === true || formData.intimacyHappened === null">
            <label>备注（可选）</label>
            <n-input v-model:value="formData.intimacyNote" type="textarea" :rows="2" placeholder="如：正常、有轻微不适等" />
          </div>
          <div class="form-hint">💡 正常孕期可适当同房，如有出血、腹痛请避免并咨询医生</div>
        </template>

        <!-- 心情 -->
        <template v-if="selectedType === 'mood'">
          <div class="form-group">
            <label>今天心情如何？</label>
            <div class="mood-selector">
              <button
                v-for="m in moodOptions" :key="m.value"
                class="mood-btn" :class="{ active: formData.moodValue === m.value }"
                @click="formData.moodValue = m.value"
              >{{ m.emoji }} {{ m.label }}</button>
            </div>
          </div>
          <div class="form-group">
            <label>心情备注（可选）</label>
            <n-input v-model:value="formData.moodNote" type="textarea" :rows="2" placeholder="记录一下今天的心情..." />
          </div>
        </template>

        <!-- 测胎心 -->
        <template v-if="selectedType === 'fetal_heart_rate'">
          <div class="form-group">
            <label>胎心率（bpm）</label>
            <n-input-number v-model:value="formData.fetalHeartRate" :min="60" :max="200" placeholder="110-160" style="width: 100%" />
          </div>
          <div class="form-hint">💡 正常胎心范围：110-160 bpm，低于110或高于160需关注</div>
        </template>

        <!-- 计划 -->
        <template v-if="selectedType === 'plan'">
          <div class="form-group">
            <label>计划内容</label>
            <n-input v-model:value="formData.planText" placeholder="如：预约四维彩超" style="width: 100%" />
          </div>
          <div class="form-group">
            <label>计划日期（可选）</label>
            <n-date-picker v-model:formatted-value="formData.planDate" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
          </div>
        </template>

        <!-- 日记 - Tiptap 富文本编辑器 -->
        <template v-if="selectedType === 'diary'">
          <div class="form-group">
            <label>今日日记</label>
            <!-- 工具栏 -->
            <div v-if="editor" class="diary-toolbar">
              <n-button-group size="tiny">
                <n-button
                  :type="editor.isActive('bold') ? 'primary' : 'default'"
                  @click="editor.chain().focus().toggleBold().run()"
                  title="加粗"
                >
                  <strong>B</strong>
                </n-button>
                <n-button
                  :type="editor.isActive('italic') ? 'primary' : 'default'"
                  @click="editor.chain().focus().toggleItalic().run()"
                  title="斜体"
                >
                  <em>I</em>
                </n-button>
                <n-button
                  :type="editor.isActive('heading', { level: 2 }) ? 'primary' : 'default'"
                  @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
                  title="标题2"
                >
                  H2
                </n-button>
                <n-button
                  :type="editor.isActive('heading', { level: 3 }) ? 'primary' : 'default'"
                  @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
                  title="标题3"
                >
                  H3
                </n-button>
                <n-button
                  :type="editor.isActive('bulletList') ? 'primary' : 'default'"
                  @click="editor.chain().focus().toggleBulletList().run()"
                  title="无序列表"
                >
                  • 列表
                </n-button>
                <n-button
                  :type="editor.isActive('orderedList') ? 'primary' : 'default'"
                  @click="editor.chain().focus().toggleOrderedList().run()"
                  title="有序列表"
                >
                  1. 列表
                </n-button>
                <n-button
                  @click="handleInsertImage"
                  title="插入图片"
                >
                  🖼️ 图片
                </n-button>
              </n-button-group>
            </div>
            <!-- 编辑器区域 -->
            <div class="diary-editor-wrapper">
              <EditorContent :editor="editor" class="diary-editor" />
            </div>
            <!-- 隐藏的文件选择器 -->
            <input
              ref="imageInputRef"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style="display: none"
              @change="onImageSelected"
            />
          </div>
        </template>

        <!-- 日期 -->
        <div class="form-group">
          <label>记录日期</label>
          <n-date-picker v-model:formatted-value="formData.recordDate" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
      </div>
    </div>

    <template #action>
      <n-button @click="handleCancel">取消</n-button>
      <n-button type="primary" :loading="saving" @click="saveRecord">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import {
  NModal, NButton, NButtonGroup, NInput, NInputNumber, NDatePicker,
  NRadioGroup, NRadioButton, NSelect, useMessage,
} from 'naive-ui'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { dailyRecordApi } from '@/api/daily-record'
import client from '@/api/client'
import dayjs from 'dayjs'

const props = defineProps<{
  show: boolean
  date: string
  pregnancyId?: string
  defaultType?: string
  editRecord?: any
}>()

const emit = defineEmits<{
  'update:show': [val: boolean]
  'saved': []
}>()

const message = useMessage()
const saving = ref(false)
const selectedType = ref('weight')
const imageInputRef = ref<HTMLInputElement | null>(null)

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val),
})

const recordTypes = [
  { value: 'weight', icon: '⚖️', label: '体重' },
  { value: 'blood_pressure', icon: '🩺', label: '血压' },
  { value: 'blood_glucose', icon: '🩸', label: '血糖' },
  { value: 'temperature', icon: '🌡️', label: '体温' },
  { value: 'hcg', icon: '🧬', label: 'HCG' },
  { value: 'uric_acid', icon: '🧪', label: '尿酸' },
  { value: 'supplement', icon: '💊', label: '营养补充' },
  { value: 'habit', icon: '✅', label: '好习惯' },
  { value: 'fetal_movement', icon: '🦶', label: '胎动' },
  { value: 'contraction', icon: '⏱️', label: '宫缩' },
  { value: 'intimacy', icon: '💑', label: '爱爱' },
  { value: 'symptoms', icon: '📋', label: '症状' },
  { value: 'medication', icon: '💊', label: '用药' },
  { value: 'diet', icon: '🍎', label: '饮食' },
  { value: 'exercise', icon: '🏃', label: '运动' },
  { value: 'sleep', icon: '😴', label: '睡眠' },
  { value: 'water', icon: '💧', label: '饮水' },
  { value: 'stool', icon: '🚽', label: '便便' },
  { value: 'plan', icon: '📌', label: '计划' },
  { value: 'diary', icon: '📝', label: '日记' },
  { value: 'mood', icon: '😊', label: '心情' },
  { value: 'fetal_heart_rate', icon: '❤️', label: '测胎心' },
]

const moodOptions = [
  { value: 1, emoji: '😢', label: '很差' },
  { value: 2, emoji: '😔', label: '不好' },
  { value: 3, emoji: '😐', label: '一般' },
  { value: 4, emoji: '😊', label: '不错' },
  { value: 5, emoji: '😄', label: '很好' },
]

const symptomOptions = [
  '恶心', '呕吐', '头痛', '头晕', '水肿', '腰痛',
  '胃灼热', '便秘', '腹泻', '尿频', '失眠', '焦虑',
  '乏力', '气短', '心悸', '背痛', '腿抽筋',
]

const supplementOptions = [
  '叶酸', '铁剂', '钙片', 'DHA', '复合维生素',
  '维生素D', '维生素B6', '维生素B12', '锌', '镁',
  '益生菌', '蛋白粉', '燕窝', '鱼胶',
]

const sleepQualityOptions = [
  { value: 'good', label: '好' },
  { value: 'fair', label: '一般' },
  { value: 'poor', label: '差' },
]

const dietMealOptions = [
  { value: '早餐', label: '早餐' },
  { value: '午餐', label: '午餐' },
  { value: '晚餐', label: '晚餐' },
  { value: '加餐', label: '加餐' },
]

// 时间选项（每30分钟一个，00:00 ~ 23:30）
const timeOptions = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = (i % 2) * 30
  const v = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  return { value: v, label: v }
})

function addDietMeal() {
  const used = formData.value.dietMeals.map(m => m.type)
  // 默认选第一个未使用的餐次，否则默认加餐
  let next = '加餐'
  for (const opt of dietMealOptions) {
    if (!used.includes(opt.value)) { next = opt.value; break }
  }
  formData.value.dietMeals.push({ type: next, content: '' })
}

function removeDietMeal(idx: number) {
  formData.value.dietMeals.splice(idx, 1)
}

function toggleSupplement(s: string) {
  const idx = formData.value.supplementItems.indexOf(s)
  if (idx >= 0) formData.value.supplementItems.splice(idx, 1)
  else formData.value.supplementItems.push(s)
}

const formData = ref({
  recordDate: '',
  // 体重
  weight: null as number | null,
  // 血压
  bpSystolic: null as number | null,
  bpDiastolic: null as number | null,
  // 血糖
  glucoseTime: 'fasting' as 'fasting' | '1h' | '2h',
  glucoseValue: null as number | null,
  // 胎动
  fetalMovementCount: null as number | null,
  fetalMovementDuration: null as number | null,
  // 宫缩
  contractionStart: '',
  contractionEnd: '',
  contractionInterval: null as number | null,
  contractionPain: null as string | null,
  // 症状
  symptoms: [] as string[],
  // 用药
  medName: '',
  medDosage: '',
  medFrequency: '',
  // 饮食（三餐+加餐列表）
  dietMeals: [] as { type: string; content: string }[],
  // 运动
  exerciseType: '',
  exerciseDuration: null as number | null,
  // 睡眠
  // 睡眠（入/起床时间）
    sleepBedtime: '' as string,
    sleepWaketime: '' as string,
    sleepQuality: 'fair' as 'good' | 'fair' | 'poor',
  // 饮水
  waterIntake: null as number | null,
  // 排便
  stoolCount: null as number | null,
  stoolConsistency: 'normal' as 'hard' | 'normal' | 'soft' | 'diarrhea',
  stoolColor: 'brown' as 'brown' | 'dark' | 'green' | 'yellow',
  // 体温
  bodyTemperature: null as number | null,
  // HCG
  hcgValue: null as number | null,
  hcgWeeks: null as number | null,
  // 尿酸
  uricAcid: null as number | null,
  uricAcidPeriod: null as string | null,
  // 营养补充
  supplementItems: [] as string[],
  // 爱爱
  intimacyNote: '',
  intimacyHappened: null as boolean | null,
  // 心情
  moodValue: 3 as number,
  moodNote: '',
  // 测胎心
  fetalHeartRate: null as number | null,
  // 计划
  planText: '',
  planDate: '',
  // 好习惯
  habitText: '',
  // 日记（富文本 HTML）
  diaryContent: '',
})

/** Tiptap 编辑器实例 */
const editor = useEditor({
  content: '',
  extensions: [
    StarterKit,
    Image.configure({
      HTMLAttributes: { class: 'diary-image' },
    }),
    Placeholder.configure({
      placeholder: '记录今天的感受...',
    }),
  ],
  onUpdate: ({ editor: e }) => {
    formData.value.diaryContent = e.getHTML()
  },
})

// 当对话框打开时初始化编辑器内容和日期
watch(() => props.show, (val) => {
  if (val) {
    formData.value.recordDate = props.date || dayjs().format('YYYY-MM-DD')

    if (props.editRecord) {
      const r = props.editRecord
      // 优先使用记录中的 record_type，否则回退到父组件传入的 defaultType
      if (r.record_type) {
        selectedType.value = r.record_type
      } else if (props.defaultType) {
        selectedType.value = props.defaultType
      }
      if (r.record_date) {
        formData.value.recordDate = r.record_date
      }
      switch (selectedType.value) {
        case 'weight':
          formData.value.weight = r.weight ?? null
          break
        case 'blood_pressure':
          formData.value.bpSystolic = r.blood_pressure_systolic != null ? Number(r.blood_pressure_systolic) : null
          formData.value.bpDiastolic = r.blood_pressure_diastolic != null ? Number(r.blood_pressure_diastolic) : null
          break
        case 'blood_glucose':
          if (r.blood_glucose_fasting != null) {
            formData.value.glucoseTime = 'fasting'
            formData.value.glucoseValue = r.blood_glucose_fasting
          } else if (r.blood_glucose_1h != null) {
            formData.value.glucoseTime = '1h'
            formData.value.glucoseValue = r.blood_glucose_1h
          } else if (r.blood_glucose_2h != null) {
            formData.value.glucoseTime = '2h'
            formData.value.glucoseValue = r.blood_glucose_2h
          }
          break
        case 'fetal_movement':
          formData.value.fetalMovementCount = r.fetal_movement_count ?? null
          formData.value.fetalMovementDuration = r.fetal_movement_duration ?? null
          break
        case 'contraction':
          formData.value.contractionInterval = r.contraction_interval ?? null
          formData.value.contractionPain = r.contraction_pain || null
          if (r.note) {
            const m = r.note.match(/(\d{2}:\d{2})~(\d{2}:\d{2})/)
            if (m) {
              formData.value.contractionStart = m[1]
              formData.value.contractionEnd = m[2]
            }
          }
          break
        case 'symptoms':
          try {
            formData.value.symptoms = r.symptoms ? JSON.parse(r.symptoms) : []
          } catch { formData.value.symptoms = [] }
          break
        case 'medication':
          try {
            const meds = r.medication ? JSON.parse(r.medication) : []
            if (meds.length > 0) {
              formData.value.medName = meds[0].name || ''
              formData.value.medDosage = meds[0].dosage || ''
              formData.value.medFrequency = meds[0].frequency || ''
            }
          } catch { /* ignore */ }
          break
        case 'diet':
          // 从旧格式 diet_note 回填：尝试解析 JSON 数组，否则作为单条"其他"
          if (r.diet_note) {
            try {
              const parsed = JSON.parse(r.diet_note)
              if (Array.isArray(parsed)) { formData.value.dietMeals = parsed }
              else { formData.value.dietMeals = [{ type: '早餐', content: String(r.diet_note) }] }
            } catch {
              formData.value.dietMeals = [{ type: '早餐', content: r.diet_note }]
            }
          } else if (!formData.value.dietMeals.length) {
            addDietMeal()
          }
          break
        case 'exercise':
          formData.value.exerciseType = r.exercise_type || ''
          formData.value.exerciseDuration = r.exercise_duration ?? null
          break
        case 'sleep':
          // 兼容小弹窗保存的中文质量值（好/一般/差）→ 英文（good/fair/poor）
          const sqMap2: Record<string, string> = { '好': 'good', '一般': 'fair', '差': 'poor' }
          const mappedQ2 = sqMap2[String(r.sleep_quality)] || r.sleep_quality
          formData.value.sleepQuality = (mappedQ2 || 'fair') as 'good' | 'fair' | 'poor'
          // 尝试从备注中解析入/起床时间（格式如 "22:00~07:00"）
          if (r.note) {
            const m = r.note.match(/(\d{1,2}:\d{2})[~\-～](\d{1,2}:\d{2})/)
            if (m) {
              formData.value.sleepBedtime = m[1]
              formData.value.sleepWaketime = m[2]
            }
          }
          break
        case 'water':
          formData.value.waterIntake = r.water_intake ?? null
          break
        case 'stool':
          try {
            const stool = r.stool_record ? JSON.parse(r.stool_record) : null
            if (stool) {
              formData.value.stoolCount = stool.count ?? null
              formData.value.stoolConsistency = stool.consistency || 'normal'
              formData.value.stoolColor = stool.color || 'brown'
            }
          } catch { /* ignore */ }
          break
        case 'temperature':
          formData.value.bodyTemperature = r.body_temperature ?? null
          break
        case 'hcg':
          formData.value.hcgValue = r.hcg_value ?? null
          formData.value.hcgWeeks = r.hcg_weeks ?? null
          break
        case 'uric_acid':
          formData.value.uricAcid = r.uric_acid ?? null
          formData.value.uricAcidPeriod = r.uric_acid_period ?? null
          break
        case 'supplement':
          try {
            const supps = r.supplement_record ? JSON.parse(r.supplement_record) : []
            formData.value.supplementItems = Array.isArray(supps) ? supps.map((s: any) => s.name || s) : []
          } catch { formData.value.supplementItems = [] }
          break
        case 'intimacy':
          formData.value.intimacyNote = r.intimacy_note || r.intimacy_record || ''
          // intimacy_record 存储的是 "已记录" 或备注文本
          formData.value.intimacyHappened = !!(r.intimacy_record || r.intimacy_note)
          break
        case 'habit':
          formData.value.habitText = r.habit_text || ''
          break
        case 'mood':
          formData.value.moodValue = r.mood ? Number(r.mood) : 3
          formData.value.moodNote = r.mood_note || ''
          break
        case 'fetal_heart_rate':
          formData.value.fetalHeartRate = r.fetal_heart_rate ?? null
          break
        case 'plan':
          formData.value.planText = r.plan_text || ''
          formData.value.planDate = r.plan_date || ''
          break
        case 'diary': {
          const html = r.note || ''
          formData.value.diaryContent = html
          // 净化 HTML：移除 script 标签和危险属性
          let safeHtml = html || ''
          safeHtml = safeHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          safeHtml = safeHtml.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
          safeHtml = safeHtml.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
          safeHtml = safeHtml.replace(/javascript:/gi, '')
          nextTick(() => {
            editor.value?.commands.setContent(safeHtml)
          })
          break
        }
      }
    } else {
      if (props.defaultType) {
        const validTypes = recordTypes.map(t => t.value)
        if (validTypes.includes(props.defaultType)) {
          selectedType.value = props.defaultType
        }
      }
      if (editor.value) {
        editor.value.commands.setContent('')
      }
    }
  }
})

// 当切换到日记类型时确保编辑器可用
watch(selectedType, (newType) => {
  if (newType === 'diary' && editor.value) {
    nextTick(() => {
      editor.value?.commands.focus()
    })
  }
})

/** 点击插入图片按钮 */
function handleInsertImage() {
  imageInputRef.value?.click()
}

/** 图片文件选择后的处理 */
async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 验证文件大小（5MB 上限）
  if (file.size > 5 * 1024 * 1024) {
    message.warning('图片大小不能超过 5MB')
    input.value = ''
    return
  }

  try {
    message.loading('正在上传图片...', { duration: 0 })
    const formPayload = new FormData()
    formPayload.append('file', file)

    const res: any = await client.post('/daily-records/diary-image', formPayload, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })

    if (res.code === 0 && res.data?.url) {
      // 在编辑器中插入图片
      editor.value?.chain().focus().setImage({ src: res.data.url }).run()
      message.success('图片已插入')
    } else {
      message.error(res.message || '图片上传失败')
    }
  } catch (err: any) {
    message.error(err?.message || '图片上传失败')
  } finally {
    message.destroyAll()
    input.value = ''
  }
}

function toggleSymptom(symptom: string) {
  const idx = formData.value.symptoms.indexOf(symptom)
  if (idx >= 0) {
    formData.value.symptoms.splice(idx, 1)
  } else {
    formData.value.symptoms.push(symptom)
  }
}

async function saveRecord() {
  if (!props.pregnancyId) {
    message.error('缺少孕期信息')
    return
  }

  saving.value = true
  try {
    // 强制确保 record_date 为有效 YYYY-MM-DD 格式
    let rawDate = formData.value.recordDate
    const recordDate = (rawDate && dayjs(rawDate, 'YYYY-MM-DD', true).isValid())
      ? dayjs(rawDate).format('YYYY-MM-DD')
      : dayjs().format('YYYY-MM-DD')
    const data: any = {
      pregnancy_id: props.pregnancyId,
      record_date: recordDate,
    }

    switch (selectedType.value) {
      case 'weight':
        if (!formData.value.weight) { message.warning('请输入体重'); saving.value = false; return }
        data.weight = formData.value.weight
        break
      case 'blood_pressure':
        if (!formData.value.bpSystolic || !formData.value.bpDiastolic) { message.warning('请输入血压值'); saving.value = false; return }
        data.blood_pressure_systolic = String(formData.value.bpSystolic)
        data.blood_pressure_diastolic = String(formData.value.bpDiastolic)
        break
      case 'blood_glucose':
        if (!formData.value.glucoseValue) { message.warning('请输入血糖值'); saving.value = false; return }
        if (formData.value.glucoseTime === 'fasting') data.blood_glucose_fasting = formData.value.glucoseValue
        else if (formData.value.glucoseTime === '1h') data.blood_glucose_1h = formData.value.glucoseValue
        else data.blood_glucose_2h = formData.value.glucoseValue
        break
      case 'fetal_movement':
        data.fetal_movement_count = formData.value.fetalMovementCount || 0
        data.fetal_movement_duration = formData.value.fetalMovementDuration || null
        break
      case 'contraction':
        data.contraction_count = formData.value.contractionStart ? 1 : 0
        data.contraction_interval = formData.value.contractionInterval || null
        // 从开始/结束时间计算持续时间(分钟)
        if (formData.value.contractionStart && formData.value.contractionEnd) {
          const [sh, sm] = formData.value.contractionStart.split(':').map(Number)
          const [eh, em] = formData.value.contractionEnd.split(':').map(Number)
          let diffMin = (eh * 60 + em) - (sh * 60 + sm)
          if (diffMin < 0) diffMin += 60 // 跨小时（不太可能但防御性处理）
          if (diffMin < 0) return // 仍然为负则不保存
          data.contraction_duration = diffMin
        }
        if (formData.value.contractionPain) data.contraction_pain = formData.value.contractionPain
        break
      case 'symptoms':
        if (formData.value.symptoms.length === 0) { message.warning('请选择症状'); saving.value = false; return }
        data.symptoms = JSON.stringify(formData.value.symptoms)
        break
      case 'medication':
        if (!formData.value.medName) { message.warning('请输入药品名称'); saving.value = false; return }
        data.medication = JSON.stringify([{
          name: formData.value.medName,
          dosage: formData.value.medDosage,
          frequency: formData.value.medFrequency,
        }])
        break
      case 'diet':
        const validMeals = formData.value.dietMeals.filter(m => m.content && m.content.trim())
        if (!validMeals.length) { message.warning('请至少填写一餐饮食'); saving.value = false; return }
        data.diet_note = JSON.stringify(validMeals)
        break
      case 'exercise':
        if (!formData.value.exerciseType) { message.warning('请输入运动类型'); saving.value = false; return }
        data.exercise_type = formData.value.exerciseType
        data.exercise_duration = formData.value.exerciseDuration
        break
      case 'sleep':
        // 从入/起床时间计算睡眠时长
        let calcHours: number | undefined = undefined
        if (formData.value.sleepBedtime && formData.value.sleepWaketime) {
          const [bh, bm] = formData.value.sleepBedtime.split(':').map(Number)
          const [wh, wm] = formData.value.sleepWaketime.split(':').map(Number)
          let diff = (wh * 60 + wm) - (bh * 60 + bm)
          if (diff < 0) diff += 24 * 60 // 跨天
          calcHours = Math.round((diff / 60) * 10) / 10
        }
        data.sleep_hours = calcHours
        data.sleep_quality = formData.value.sleepQuality
        // note 字段复用设计：
        // - sleep 类型：存 "22:00~07:00" 格式的时间范围，编辑时正则解析回填 bedtime/waketime
        // - diary 类型：存 Tiptap 富文本 HTML 内容（日记无独立 content 字段）
        // - 其他类型不使用 note 字段
        if (formData.value.sleepBedtime && formData.value.sleepWaketime) {
          data.note = `${formData.value.sleepBedtime}~${formData.value.sleepWaketime}`
        }
        break
      case 'temperature':
        if (!formData.value.bodyTemperature) { message.warning('请输入体温'); saving.value = false; return }
        data.body_temperature = formData.value.bodyTemperature
        break
      case 'hcg':
        if (!formData.value.hcgValue) { message.warning('请输入HCG值'); saving.value = false; return }
        data.hcg_value = formData.value.hcgValue
        if (formData.value.hcgWeeks) data.hcg_weeks = formData.value.hcgWeeks
        break
      case 'uric_acid':
        if (!formData.value.uricAcid) { message.warning('请输入尿酸值'); saving.value = false; return }
        data.uric_acid = formData.value.uricAcid
        if (formData.value.uricAcidPeriod) data.uric_acid_period = formData.value.uricAcidPeriod
        break
      case 'supplement':
        data.supplement_record = JSON.stringify(formData.value.supplementItems.map(s => ({ name: s })))
        break
      case 'intimacy':
        data.intimacy_record = formData.value.intimacyHappened ? (formData.value.intimacyNote || '已记录') : ''
        data.intimacy_note = formData.value.intimacyNote || (formData.value.intimacyHappened ? '已记录' : '')
        break
      case 'mood':
        data.mood = String(formData.value.moodValue ?? 3)
        if (formData.value.moodNote) data.mood_note = formData.value.moodNote
        break
      case 'fetal_heart_rate':
        if (!formData.value.fetalHeartRate) { message.warning('请输入胎心率'); saving.value = false; return }
        data.fetal_heart_rate = formData.value.fetalHeartRate
        break
      case 'plan':
        if (!formData.value.planText) { message.warning('请输入计划内容'); saving.value = false; return }
        data.plan_text = formData.value.planText
        if (formData.value.planDate) data.plan_date = formData.value.planDate
        break
      case 'habit':
        if (!formData.value.habitText) { message.warning('请输入好习惯内容'); saving.value = false; return }
        data.habit_text = formData.value.habitText
        break
      case 'water':
        if (!formData.value.waterIntake) { message.warning('请输入饮水量'); saving.value = false; return }
        data.water_intake = formData.value.waterIntake
        break
      case 'stool': {
        if (!formData.value.stoolCount && formData.value.stoolCount !== 0) { message.warning('请输入排便次数'); saving.value = false; return }
        data.stool_record = JSON.stringify({
          count: formData.value.stoolCount,
          consistency: formData.value.stoolConsistency,
          color: formData.value.stoolColor,
        })
        break
      }
      case 'diary': {
        const htmlContent = formData.value.diaryContent
        const textContent = editor.value?.getText()?.trim() || ''
        if (!textContent) { message.warning('请输入日记内容'); saving.value = false; return }
        // diary 类型复用 note 字段存储 Tiptap 富文本 HTML（见上方 sleep 类型的 note 复用说明）
        data.note = htmlContent
        break
      }
      default:
        message.warning('未知的记录类型'); saving.value = false; return
    }

    const isEdit = !!props.editRecord?.id

    const apiCall = isEdit
      ? dailyRecordApi.update(props.editRecord.id, data)
      : dailyRecordApi.upsert(data)

    try {
      await apiCall
      visible.value = false
      resetForm()
      emit('saved')
      message.success(isEdit ? '更新成功' : '保存成功')
    } catch (error: any) {
      message.error('保存失败: ' + (error.message || '请重试'))
      // 不关闭弹窗，不重置表单，让用户可以重试
    } finally {
      saving.value = false
    }
  } catch (err: any) {
    message.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const handleCancel = () => {
  visible.value = false
  resetForm()
}

function resetForm() {
  formData.value = {
    recordDate: dayjs().format('YYYY-MM-DD'),
    weight: null,
    bpSystolic: null,
    bpDiastolic: null,
    glucoseTime: 'fasting',
    glucoseValue: null,
    fetalMovementCount: null,
    fetalMovementDuration: null,
    contractionStart: '',
    contractionEnd: '',
    contractionInterval: null,
    contractionPain: null as string | null,
    symptoms: [],
    medName: '',
    medDosage: '',
    medFrequency: '',
    // 饮食（三餐+加餐列表）
    dietMeals: [] as { type: string; content: string }[],
    exerciseType: '',
    exerciseDuration: null,
    // 睡眠（入/起床时间）
    sleepBedtime: '',
    sleepWaketime: '',
    sleepQuality: 'fair' as 'good' | 'fair' | 'poor',
    bodyTemperature: null,
    hcgValue: null,
    hcgWeeks: null as number | null,
    uricAcid: null,
    uricAcidPeriod: null as string | null,
    supplementItems: [],
    intimacyNote: '',
    intimacyHappened: null as boolean | null,
    moodValue: 3,
    moodNote: '',
    fetalHeartRate: null,
    planText: '',
    planDate: '',
    habitText: '',
    waterIntake: null,
    stoolCount: null,
    stoolConsistency: 'normal' as 'hard' | 'normal' | 'soft' | 'diarrhea',
    stoolColor: 'brown' as 'brown' | 'dark' | 'green' | 'yellow',
    diaryContent: '',
  }
  // 重置编辑器内容
  if (editor.value) {
    editor.value.commands.setContent('')
  }
}

// 组件卸载时销毁编辑器
onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<style scoped>
.add-record-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.type-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.type-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  user-select: none;
}

.type-tag:hover {
  border-color: var(--primary-color, #c44680);
}

.type-tag.selected {
  background: var(--primary-color, #c44680);
  color: white;
  border-color: var(--primary-color, #c44680);
}

.type-icon {
  font-size: 14px;
}

.type-label {
  font-size: 12px;
}

.form-area {
  min-height: 120px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

.form-row {
  display: flex;
  gap: 12px;
}

.flex-1 {
  flex: 1;
  min-width: 0;
}

.symptom-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.symptom-tag {
  padding: 5px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.symptom-tag:hover {
  border-color: var(--stage-late-color, #F06292);
}

.symptom-tag.selected {
  background: var(--stage-late-color, #F06292);
  color: white;
  border-color: var(--stage-late-color, #F06292);
}

/* ====== 日记富文本编辑器样式 ====== */
.diary-toolbar {
  margin-bottom: 8px;
}

.diary-toolbar :deep(.n-button-group) {
  flex-wrap: wrap;
  gap: 2px;
}

.diary-toolbar :deep(.n-button) {
  font-size: 12px;
  padding: 0 8px;
  min-width: 32px;
}

.diary-editor-wrapper {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  overflow: hidden;
}

.diary-editor {
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
  padding: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color, #1e293b);
  outline: none;
}

/* Tiptap 占位符样式 */
.diary-editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-hint, #94a3b8);
  pointer-events: none;
  height: 0;
}

/* Tiptap 内容样式 */
.diary-editor :deep(.tiptap) {
  outline: none;
}

.diary-editor :deep(.tiptap h2) {
  font-size: 18px;
  font-weight: 600;
  margin: 16px 0 8px;
}

.diary-editor :deep(.tiptap h3) {
  font-size: 16px;
  font-weight: 600;
  margin: 12px 0 6px;
}

.diary-editor :deep(.tiptap p) {
  margin: 4px 0;
}

.diary-editor :deep(.tiptap ul) {
  list-style: disc;
  padding-left: 20px;
  margin: 4px 0;
}

.diary-editor :deep(.tiptap ol) {
  list-style: decimal;
  padding-left: 20px;
  margin: 4px 0;
}

.diary-editor :deep(.tiptap li) {
  margin: 2px 0;
}

/* 日记中插入的图片样式 */
.diary-editor :deep(.tiptap img.diary-image) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 8px 0;
}

.diary-editor :deep(.tiptap img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 8px 0;
}

.diary-editor :deep(.tiptap strong) {
  font-weight: 600;
}

.diary-editor :deep(.tiptap em) {
  font-style: italic;
}

.tag-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.supp-tag {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  background: var(--bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  transition: all .15s;
}
.supp-tag.selected {
  background: var(--primary-color, #c44680);
  color: white;
  border-color: var(--primary-color, #c44680);
}
.form-hint { font-size: 12px; color: var(--text-hint, #94a3b8); margin-top: 6px; padding: 6px 10px; background: #f0f9ff; border-radius: 6px; }

.mood-selector { display: flex; gap: 8px; flex-wrap: wrap; }
.mood-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 10px 16px; border: 2px solid var(--border-color, #e2e8f0);
  border-radius: 12px; background: var(--bg-card, #fff);
  cursor: pointer; font-size: 15px; transition: all 0.15s ease;
}
.mood-btn:hover { border-color: #a78bfa; background: #faf5ff; }
.mood-btn.active {
  border-color: #a78bfa; background: #ede9fe;
  color: #7c3aed; font-weight: 600;
}

/* 睡眠质量按钮组 */
.sleep-quality-group {
  display: flex;
  gap: 10px;
}
.sleep-quality-btn {
  flex: 1;
  padding: 8px 16px;
  border: 2px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  background: var(--bg-card, #fff);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s ease;
  text-align: center;
}
.sleep-quality-btn:hover {
  border-color: #818cf8;
  background: #eef2ff;
}
.sleep-quality-btn.active {
  border-color: #818cf8;
  background: #e0e7ff;
  color: #4f46e5;
  font-weight: 600;
}

/* 饮食三餐列表 */
.diet-meals-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.diet-meal-item {
  /* container */
}
.diet-meal-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

/* 爱爱切换按钮 */
.intimacy-toggle {
  display: flex;
  gap: 12px;
}
.intimacy-btn {
  flex: 1;
  padding: 10px 20px;
  border: 2px solid var(--border-color, #e2e8f0);
  border-radius: 12px;
  background: var(--bg-card, #fff);
  cursor: pointer;
  font-size: 15px;
  transition: all 0.15s ease;
  text-align: center;
}
.intimacy-btn:hover {
  border-color: #f43f5e;
  background: #fef2f2;
}
.intimacy-btn.active {
  border-color: #f43f5e;
  background: #ffe4e6;
  color: #be123c;
  font-weight: 600;
}

@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
    gap: 0;
  }

  .diary-toolbar :deep(.n-button-group) {
    display: flex;
    flex-wrap: wrap;
  }
}
</style>
