<template>
  <!--
    胎动 / 宫缩 的「快捷记一笔」小弹窗（共享组件）。

    为什么会有这个文件：同一个功能此前只能从**记录页**的「＋ → 胎动/宫缩」进入，
    首页那两个工具卡只是纯跳转（点了直接进计数器全屏页），用户反馈
    「首页相关功能是展示和快捷记录」。现在两处都用这一份实现，
    免得首页再写一遍、日后各改各的慢慢长歪。

    字段与文案与记录页原有小弹窗**逐字一致**（DOM 里的 .qf-group / label /
    .form-hint-text 结构也没变），所以 tools/verify 里量小弹窗风格的脚本口径依然成立。
  -->
  <n-modal
    :show="show"
    preset="card"
    :title="title"
    style="max-width: 420px; width: 94vw;"
    :mask-closable="true"
    @update:show="$emit('update:show', $event)"
  >
    <div class="quick-form">
      <div class="qf-group">
        <label>日期</label>
        <n-date-picker v-model:formatted-value="form.date" type="date" value-format="yyyy-MM-dd" style="width:100%" />
      </div>

      <!-- ===== 胎动 ===== -->
      <template v-if="type === 'fetal_movement'">
        <div class="qf-row">
          <div class="qf-group flex1">
            <label>胎动次数</label>
            <n-input-number v-model:value="form.count" :min="0" :max="200" placeholder="次数" style="width:100%" />
          </div>
          <div class="qf-group flex1">
            <label>用时(分钟)</label>
            <n-input-number v-model:value="form.duration" :min="0" :max="180" :step="5" placeholder="分钟" style="width:100%" />
          </div>
        </div>
        <div class="form-hint-text">正常胎动：每小时≥3次，每天累计10次以上</div>
      </template>

      <!-- ===== 宫缩 ===== -->
      <!-- ⚠️ 故意写成 v-else-if 而不是 v-else：写 v-else 时，将来往 QuickLogType 里加了
           第三个类型却忘了写分支，弹窗会「打开是空白」且**不报错**。显式写出来，
           tools/verify/verify_record_entrypoints.js 就能断言「声明的每个类型都有模板分支」。 -->
      <template v-else-if="type === 'contraction'">
        <div class="qf-row">
          <div class="qf-group flex1">
            <label>持续时间(秒)</label>
            <n-input-number v-model:value="form.duration" :min="0" :max="300" placeholder="秒" style="width:100%" />
          </div>
          <div class="qf-group flex1">
            <label>间隔时间(分钟)</label>
            <n-input-number v-model:value="form.interval" :min="0" :max="60" :step="0.5" placeholder="分钟" style="width:100%" />
          </div>
        </div>
        <div class="qf-group">
          <label>疼痛程度</label>
          <n-radio-group v-model:value="form.pain" size="small">
            <n-radio-button value="无感">无感</n-radio-button>
            <n-radio-button value="轻微">轻微</n-radio-button>
            <n-radio-button value="明显">明显</n-radio-button>
            <n-radio-button value="剧烈">剧烈</n-radio-button>
          </n-radio-group>
        </div>
      </template>

      <div class="qf-group">
        <label>当天备注（可选）</label>
        <n-input v-model:value="form.note" placeholder="可选" />
      </div>
    </div>

    <template #action>
      <n-button @click="$emit('update:show', false)">取消</n-button>
      <n-button type="primary" :loading="saving" @click="save">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NInput, NInputNumber, NDatePicker, NRadioGroup, NRadioButton, useMessage } from 'naive-ui'
import { dailyRecordApi } from '@/api/daily-record'
import { isValidDateStr } from '@/utils/format'
import dayjs from 'dayjs'

/** 支持的两类：胎动计数、宫缩计时 */
export type QuickLogType = 'fetal_movement' | 'contraction'

const props = withDefaults(defineProps<{
  show: boolean
  type: QuickLogType
  pregnancyId?: string
  /** 默认日期（记录页传当前选中日期；首页传今天） */
  date?: string
  /** 当天已有的备注 —— daily_record.note 是**按天共享**的一列，打开时预填，避免盲写覆盖 */
  note?: string
}>(), {
  pregnancyId: '',
  date: '',
  note: '',
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved'): void
}>()

const message = useMessage()
const saving = ref(false)

const TITLES: Record<QuickLogType, string> = {
  fetal_movement: '记录胎动',
  contraction: '记录宫缩',
}
const title = computed(() => TITLES[props.type] || '记录')

const blank = () => ({
  date: '',
  count: null as number | null,
  duration: null as number | null,
  interval: null as number | null,
  pain: '轻微' as '无感' | '轻微' | '明显' | '剧烈',
  note: '',
})
const form = ref(blank())

// 每次打开都重置：沿用之前那次的残留值会让用户以为「已经填过了」
watch(() => props.show, (v) => {
  if (!v) return
  form.value = blank()
  form.value.date = props.date || dayjs().format('YYYY-MM-DD')
  form.value.note = props.note || ''
})

async function save() {
  if (!props.pregnancyId) { message.error('缺少孕期信息'); return }
  // 与记录页原实现同一条口径：日期必须真的是 YYYY-MM-DD。
  // ⚠️ 校验用共享的 isValidDateStr()，不要用 dayjs 严格模式（本项目未 extend customParseFormat，不生效）
  const rawDate = form.value.date
  if (rawDate != null && rawDate !== '' && !isValidDateStr(rawDate)) {
    message.error('日期无效，请重新选择日期')
    return
  }
  const recordDate = rawDate ? String(rawDate) : dayjs().format('YYYY-MM-DD')

  if (props.type === 'fetal_movement' && !form.value.count) {
    message.warning('请输入胎动次数')
    return
  }

  const payload: any = { pregnancy_id: props.pregnancyId, record_date: recordDate, note: form.value.note }
  if (props.type === 'fetal_movement') {
    payload.fetal_movement_count = form.value.count
    // 没填用时就不提交（后端按 !== undefined 判更新，不提交即保持原值，不会被清成空）
    payload.fetal_movement_duration = form.value.duration || undefined
  } else {
    // ⚠️ 这两行沿用记录页原口径，别"顺手修正"：宫缩次数按「有没有填持续时间」记 1 或 0，
    //    与计数器写回的口径（当天所有会话的宫缩条数之和）在语义上是两回事，
    //    改掉会让手填用户的历史行为发生变化。
    payload.contraction_count = form.value.duration ? 1 : 0
    payload.contraction_duration = form.value.duration || undefined  // 秒
    payload.contraction_interval = form.value.interval || undefined  // 分钟
    payload.contraction_pain = form.value.pain || undefined
  }

  saving.value = true
  try {
    const res: any = await dailyRecordApi.upsert(payload)
    if (res.code === 0) {
      message.success('已保存')
      emit('saved')
      // 记录页与记录列表都监听这个事件（各自的 fetchRecords），保存后各自刷新
      window.dispatchEvent(new CustomEvent('record-added'))
      emit('update:show', false)
    } else {
      message.error(res.message || '保存失败')
    }
  } catch (e: any) {
    message.error(e?.message || '网络异常，请检查网络连接')
  } finally {
    saving.value = false
  }
}
</script>
