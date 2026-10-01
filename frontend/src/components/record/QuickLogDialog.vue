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
      <!-- 首页传 lockDate：那一屏写的就是「今天」，把日期选择器露出来只会让人
           改完日期却看不到首页数字变化（首页只显示今天），以为没保存成功。 -->
      <div v-if="lockDate" class="qf-static-date">
        <span>记到今天</span><strong>{{ form.date }}</strong>
      </div>
      <div v-else class="qf-group">
        <label>日期</label>
        <n-date-picker v-model:formatted-value="form.date" type="date" value-format="yyyy-MM-dd" style="width:100%" />
      </div>

      <!-- 这一天已经记了什么 —— 不先说清楚，用户填「5 次」时不知道会盖掉上午数的 20 次 -->
      <div v-if="existingText" class="qf-existing">
        <span class="qfe-lead">这一天已记</span>
        <span class="qfe-val">{{ existingText }}</span>
      </div>

      <!-- ===== 胎动 ===== -->
      <template v-if="type === 'fetal_movement'">
        <div class="qf-row">
          <div class="qf-group flex1">
            <label>本次胎动次数</label>
            <n-input-number v-model:value="form.count" :min="0" :max="200" placeholder="次数" style="width:100%" />
          </div>
          <div class="qf-group flex1">
            <label>本次用时(分钟)</label>
            <n-input-number v-model:value="form.duration" :min="0" :max="180" :step="5" placeholder="分钟" style="width:100%" />
          </div>
        </div>
        <!-- ⚠️ 数字从 utils/clinical-standards.ts 取（唯一真源），不在这里硬写。
             旧文案写「每天累计 10 次以上」与指南口径不符：指南是**每小时 ≥3 次 /
             12 小时累计 ≥30 次**；一天只数到 10 次其实偏少，照那句会让人放松警惕。 -->
        <div class="form-hint-text">{{ fmHintText }}</div>
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

      <!-- 追加 / 改为 —— 只在「这一天已经记过、而且还是记在这一天」时才有意义 -->
      <div v-if="canPickMode" class="qf-group">
        <label>本次怎么记</label>
        <n-radio-group v-model:value="mode" size="small">
          <n-radio-button value="append">追加到已记</n-radio-button>
          <n-radio-button value="replace">改为本次值</n-radio-button>
        </n-radio-group>
        <div class="form-hint-text">{{ modeHint }}</div>
      </div>
      <div v-if="previewText" class="qf-preview">保存后：{{ previewText }}</div>

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
import {
  buildQuickLogFields,
  describeExisting,
  previewQuickLog,
  type QuickLogMode,
  type QuickLogExisting,
} from '@/utils/quick-log'
import { FM_STANDARD } from '@/utils/clinical-standards'
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
  /**
   * 这一天**已经记下**的胎动 / 宫缩汇总值。
   * 不传 ⇒ 弹窗不显示「这一天已记…」、也不显示追加/改为开关（没有可累加的对象）。
   */
  existing?: QuickLogExisting | null
  /** 首页传 true：固定记到今天，不露出日期选择器（改了日期首页也看不到反馈） */
  lockDate?: boolean
}>(), {
  pregnancyId: '',
  date: '',
  note: '',
  existing: null,
  lockDate: false,
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
  // ⚠️ 疼痛程度**不设默认值**：以前默认选中「轻微」，于是用户压根没点过这一项、
  //    保存后库里却记着「轻微」—— 凭空替用户编了一个他没表达过的感受。
  //    与运动强度同款规矩（EXERCISE_INTENSITY 明确「不设默认值」）：没选就存空。
  pain: '',
  note: '',
})
const form = ref(blank())

/** 追加（默认）/ 改为。每次打开都回到「追加」——覆盖是有风险的操作，不能顺手留着。 */
const mode = ref<QuickLogMode>('append')

// 每次打开都重置：沿用之前那次的残留值会让用户以为「已经填过了」
watch(() => props.show, (v) => {
  if (!v) return
  form.value = blank()
  form.value.date = props.date || dayjs().format('YYYY-MM-DD')
  form.value.note = props.note || ''
  mode.value = 'append'
})

/**
 * 「这一天已记…」是否还作数 —— 只有**没改日期**时才作数。
 *
 * ⚠️ existing 是调用方按自己当前那天取的记录（首页取今天、记录页取选中日期）。
 *    用户把弹窗里的日期改到别的日子后，那串数字就属于**另一天**了；
 *    还拿它来累加 / 显示，等于把 9 月 30 日的次数加到 10 月 1 日上。
 */
const defaultDate = computed(() => props.date || dayjs().format('YYYY-MM-DD'))
const activeExisting = computed<QuickLogExisting | null>(() =>
  form.value.date && form.value.date !== defaultDate.value ? null : (props.existing || null)
)

const existingText = computed(() => describeExisting(props.type, activeExisting.value))
/** 没有可累加的对象时，「追加 / 改为」是个没有意义的开关，不显示 */
const canPickMode = computed(() => !!existingText.value)

const modeHint = computed(() => {
  if (mode.value === 'replace') return '用本次填的数字替换这一天（填错了用这个）'
  return props.type === 'fetal_movement'
    ? '次数和用时加到这一天已记的数字上（一天分几次数就用这个）'
    : '次数 +1；持续 / 间隔是单次平均值，按本次填的更新'
})

const previewText = computed(() =>
  previewQuickLog(props.type, mode.value, form.value, activeExisting.value)
)

/** 胎动的参考说明（数字取自唯一真源，改口径只改一处） */
const fmHintText = computed(
  () =>
    `参考：孕 ${FM_STANDARD.startWeek} 周起每天早、中、晚各数 1 小时，` +
    `正常每小时 ≥${FM_STANDARD.perHourNormal} 次（12 小时累计 ≥${FM_STANDARD.per12hNormal} 次）`
)

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

  // 胎动次数必填 —— 但**已经记过次数的日子允许只补用时**（此时次数保持原值，见下方 fields）
  if (props.type === 'fetal_movement' && form.value.count == null && !activeExisting.value?.count) {
    message.warning('请填写本次胎动次数')
    return
  }

  // 🔴 取值交给 utils/quick-log.ts（唯一真源 + 可单测），这里不再自己拼。
  //    旧实现 `count = 本次值` / `count = duration ? 1 : 0` 会把计数器写回的汇总值
  //    覆盖甚至清零 —— 用户上午数 20 次、下午记一笔 5 次，上午那 20 次就没了。
  const fields = buildQuickLogFields(props.type, mode.value, form.value, activeExisting.value)
  const payload: any = {
    pregnancy_id: props.pregnancyId,
    record_date: recordDate,
    note: form.value.note,
    ...fields,
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

<style scoped>
/* 首页锁日期时：用一行静态文字代替日期选择器（首页只显示今天，给个选择器反而误导） */
.qf-static-date {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-tint-pink, #fdf1f5);
  color: var(--text-secondary, #4b5563);
  font-size: 12px;
}
.qf-static-date strong {
  color: var(--text-color, #1e293b);
  font-variant-numeric: tabular-nums;
}

/* 「这一天已记…」：填之前先看清楚已经记了什么，是防覆盖的第一道提示 */
.qf-existing {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-color-2, #f8fafc);
  border: 1px solid var(--border-color-soft, #efe7ef);
  font-size: 12px;
}
.qfe-lead {
  color: var(--text-hint, #94a3b8);
  flex-shrink: 0;
}
.qfe-val {
  color: var(--text-color, #1e293b);
  font-weight: 600;
}

/* 保存后会变成什么 —— 在按下「保存」之前就把结果说清楚 */
.qf-preview {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-tint-mint, #eefaf3);
  color: var(--success-ink, #2f7a54);
  font-size: 12px;
  font-weight: 600;
}
</style>
