<template>
  <div class="dose-plan-view">
    <!-- ===== 说明 ===== -->
    <div class="dp-intro">
      <strong>按医嘱提醒 · 打卡记今天</strong>
      <span>只在方案里配的时间点提醒；打完卡，当天就不再推这一项。</span>
    </div>

    <!-- ===== 今日打卡 ===== -->
    <DoseTodayCard ref="todayRef" :show-manage="false" />

    <!-- ===== 方案列表 ===== -->
    <div class="dp-section">
      <div class="dp-section-head">
        <h3>我的方案</h3>
        <button class="dp-add-btn" @click="openCreate">+ 添加</button>
      </div>

      <div v-if="!plans.length" class="dp-empty">
        <template v-if="loadError">方案加载失败，请检查网络后刷新重试</template>
        <template v-else>还没有方案。把医生交代的吃法配进来，到点就会提醒。</template>
      </div>

      <div v-for="p in plans" :key="p.id" class="dp-card" :class="{ disabled: !p.is_enabled }">
        <div class="dp-card-head">
          <span class="dp-kind" :class="p.kind">{{ p.kind_label || kindLabel(p.kind) }}</span>
          <span class="dp-name">{{ p.name }}</span>
          <span class="dp-dosage" v-if="p.dosage">{{ p.dosage }}</span>
          <n-switch :value="p.is_enabled" @update:value="toggleEnabled(p)" size="small" />
        </div>

        <div class="dp-card-meta">
          <span class="dp-meta-item">⏰ {{ timesText(p) }}</span>
          <span class="dp-meta-item">🔁 {{ frequencyText(p) }}</span>
          <span class="dp-meta-item" v-if="rangeText(p)">📅 {{ rangeText(p) }}</span>
        </div>
        <div class="dp-card-note" v-if="p.note">{{ p.note }}</div>

        <div class="dp-card-actions">
          <button class="dp-act" @click="openEdit(p)">编辑</button>
          <button class="dp-act danger" @click="removePlan(p)">删除</button>
        </div>
      </div>
    </div>

    <div class="dp-foot-tip">
      提醒推送需要在「设置 → 消息推送」里配好渠道；每个渠道可单独开关「用药/补充提醒」。
      <router-link to="/settings">去设置 ›</router-link>
    </div>

    <div style="height: 80px"></div>

    <!-- ===== 新增 / 编辑 ===== -->
    <n-modal v-model:show="showDialog" preset="card" :title="editingId ? '编辑方案' : '添加方案'" style="max-width: 480px">
      <div class="dp-form">
        <div class="dp-field">
          <label class="dp-label">类型</label>
          <div class="dp-seg">
            <button type="button" class="dp-seg-btn" :class="{ active: form.kind === 'medication' }" @click="form.kind = 'medication'">💊 药品</button>
            <button type="button" class="dp-seg-btn" :class="{ active: form.kind === 'supplement' }" @click="form.kind = 'supplement'">🥛 营养补充</button>
          </div>
        </div>

        <div class="dp-field" v-if="!editingId">
          <label class="dp-label">常用模板（可选）</label>
          <div class="dp-tpls">
            <button type="button" class="dp-tpl" v-for="t in PRESETS" :key="t.name" @click="applyPreset(t)">{{ t.name }}</button>
          </div>
        </div>

        <div class="dp-field">
          <label class="dp-label">名称 <em>*</em></label>
          <input v-model="form.name" class="dp-input" placeholder="如：优甲乐 / 叶酸" maxlength="40" />
        </div>

        <div class="dp-field">
          <label class="dp-label">剂量</label>
          <input v-model="form.dosage" class="dp-input" placeholder="如：1 片 / 50μg / 0.4mg" maxlength="40" />
        </div>

        <div class="dp-field">
          <label class="dp-label">提醒时间点（最多 6 个）</label>
          <div class="dp-times">
            <div class="dp-time-row" v-for="(t, i) in form.reminder_times" :key="i">
              <input v-model="form.reminder_times[i]" type="time" class="dp-input dp-time" />
              <button type="button" class="dp-time-del" @click="removeTime(i)" v-if="form.reminder_times.length > 1">×</button>
            </div>
            <button type="button" class="dp-time-add" @click="addTime" v-if="form.reminder_times.length < 6">+ 加一个时间点</button>
          </div>
        </div>

        <div class="dp-field">
          <label class="dp-label">频率</label>
          <div class="dp-seg">
            <button type="button" class="dp-seg-btn" :class="{ active: form.frequency === 'daily' }" @click="form.frequency = 'daily'">每天</button>
            <button type="button" class="dp-seg-btn" :class="{ active: form.frequency === 'interval2' }" @click="form.frequency = 'interval2'">隔天</button>
            <button type="button" class="dp-seg-btn" :class="{ active: form.frequency === 'weekdays' }" @click="form.frequency = 'weekdays'">每周指定</button>
          </div>
        </div>

        <div class="dp-field" v-if="form.frequency === 'weekdays'">
          <label class="dp-label">星期（可多选）</label>
          <div class="dp-weekdays">
            <button
              type="button"
              class="dp-wd"
              :class="{ active: form.weekdays.includes(d.value) }"
              v-for="d in WEEKDAYS"
              :key="d.value"
              @click="toggleWeekday(d.value)"
            >{{ d.label }}</button>
          </div>
        </div>

        <div class="dp-field">
          <label class="dp-label">起止日期（选填，按医生交代的疗程）</label>
          <div class="dp-range">
            <input v-model="form.start_date" type="date" class="dp-input" />
            <span class="dp-range-sep">至</span>
            <input v-model="form.end_date" type="date" class="dp-input" />
          </div>
        </div>

        <div class="dp-field">
          <label class="dp-label">起止孕周（选填，医嘱常按孕周下）</label>
          <div class="dp-range">
            <input v-model="form.start_week" type="number" min="0" max="45" class="dp-input" placeholder="起始周" />
            <span class="dp-range-sep">至</span>
            <input v-model="form.end_week" type="number" min="0" max="45" class="dp-input" placeholder="结束周" />
          </div>
        </div>

        <div class="dp-field">
          <label class="dp-label">备注</label>
          <input v-model="form.note" class="dp-input" placeholder="如：空腹服用 / 饭后半小时" maxlength="120" />
        </div>

        <div class="dp-field dp-field-inline">
          <label class="dp-label">启用提醒</label>
          <n-switch v-model:value="form.is_enabled" />
        </div>

        <p class="dp-err" v-if="formError">{{ formError }}</p>

        <div class="dp-form-actions">
          <button type="button" class="dp-btn ghost" @click="showDialog = false">取消</button>
          <button type="button" class="dp-btn primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
/** 用药 / 营养补充「医嘱计划」管理页。
 *
 * ⚠️ 日期、时间一律用原生 input（type=date / type=time）：
 *    naive-ui 的 n-date-picker / n-time-picker 绑 formatted-value 时
 *    传空字符串会直接崩（详见铁律 #十四），而这里起止日期本来就是选填。
 */
import { ref, reactive, onMounted } from 'vue'
import { NSwitch, NModal, useMessage } from 'naive-ui'
import { dosePlanApi } from '@/api/dose-plan'
import { usePregnancyStore } from '@/stores/pregnancy'
import DoseTodayCard from '@/components/dose/DoseTodayCard.vue'
import * as doseText from '@/utils/dose'

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
]

/** 常用模板：用户主要就是怕忘了优甲乐、叶酸这类每天固定要吃的 */
const PRESETS = [
  { name: '优甲乐', kind: 'medication', dosage: '按医嘱', reminder_times: ['08:00'], note: '空腹服用，与钙铁间隔 4 小时' },
  { name: '叶酸', kind: 'supplement', dosage: '0.4mg', reminder_times: ['08:00'], note: '' },
  { name: '钙片', kind: 'supplement', dosage: '600mg', reminder_times: ['20:00'], note: '' },
  { name: '铁剂', kind: 'supplement', dosage: '按医嘱', reminder_times: ['12:00'], note: '与钙片错开服用' },
  { name: 'DHA', kind: 'supplement', dosage: '200mg', reminder_times: ['12:00'], note: '' },
]

const { FREQ_LABEL, kindLabel } = doseText

const message = useMessage()
const pregnancyStore = usePregnancyStore()

const todayRef = ref<InstanceType<typeof DoseTodayCard> | null>(null)
const plans = ref<any[]>([])
const loadError = ref(false)
const showDialog = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')

const form = reactive<any>({
  kind: 'medication',
  name: '',
  dosage: '',
  reminder_times: ['08:00'],
  frequency: 'daily',
  weekdays: [] as number[],
  start_date: '',
  end_date: '',
  start_week: '',
  end_week: '',
  note: '',
  is_enabled: true,
})

function resetForm() {
  form.kind = 'medication'
  form.name = ''
  form.dosage = ''
  form.reminder_times = ['08:00']
  form.frequency = 'daily'
  form.weekdays = []
  form.start_date = ''
  form.end_date = ''
  form.start_week = ''
  form.end_week = ''
  form.note = ''
  form.is_enabled = true
  formError.value = ''
}

function timesText(p: any) {
  const t = Array.isArray(p.reminder_times) ? p.reminder_times : []
  return t.length ? t.join(' · ') : '08:00'
}

function frequencyText(p: any) {
  const base = FREQ_LABEL[p.frequency] || '每天'
  if (p.frequency === 'weekdays') {
    const days = Array.isArray(p.weekdays) ? p.weekdays : []
    const labels = days.map((d: number) => WEEKDAYS.find((w) => w.value === d)?.label).filter(Boolean)
    return labels.length ? `每周 ${labels.join('')}` : base
  }
  return base
}

function rangeText(p: any) {
  const parts: string[] = []
  if (p.start_date || p.end_date) {
    parts.push(`${p.start_date || '起'} ~ ${p.end_date || '长期'}`)
  }
  if (p.start_week !== null && p.start_week !== undefined && p.start_week !== ''
    || p.end_week !== null && p.end_week !== undefined && p.end_week !== '') {
    parts.push(`孕 ${p.start_week ?? ''}-${p.end_week ?? ''} 周`)
  }
  return parts.join(' · ')
}

function addTime() {
  if (form.reminder_times.length >= 6) return
  const last = form.reminder_times[form.reminder_times.length - 1] || '08:00'
  form.reminder_times.push(last)
}
function removeTime(i: number) {
  form.reminder_times.splice(i, 1)
}
function toggleWeekday(v: number) {
  const idx = form.weekdays.indexOf(v)
  if (idx >= 0) form.weekdays.splice(idx, 1)
  else form.weekdays.push(v)
}
function applyPreset(t: any) {
  form.kind = t.kind
  form.name = t.name
  form.dosage = t.dosage
  form.reminder_times = t.reminder_times.slice()
  form.note = t.note
}

async function loadPlans() {
  const p = pregnancyStore.currentPregnancy as any
  if (!p || !p.id) return
  try {
    const res: any = await dosePlanApi.list(p.id)
    plans.value = (res?.data || []).map((it: any) => ({
      ...it,
      reminder_times: Array.isArray(it.reminder_times) ? it.reminder_times : [],
      weekdays: Array.isArray(it.weekdays) ? it.weekdays : [],
      is_enabled: !!it.is_enabled,
    }))
    loadError.value = false
  } catch (e) {
    // ⚠️ 失败不能伪装成「还没有方案」：接口挂了和真的没有方案必须能区分开
    plans.value = []
    loadError.value = true
  }
}

function openCreate() {
  editingId.value = null
  resetForm()
  showDialog.value = true
}

function openEdit(p: any) {
  editingId.value = p.id
  resetForm()
  form.kind = p.kind
  form.name = p.name
  form.dosage = p.dosage || ''
  form.reminder_times = (p.reminder_times || []).length ? p.reminder_times.slice() : ['08:00']
  form.frequency = p.frequency || 'daily'
  form.weekdays = (p.weekdays || []).slice()
  form.start_date = p.start_date || ''
  form.end_date = p.end_date || ''
  form.start_week = p.start_week ?? ''
  form.end_week = p.end_week ?? ''
  form.note = p.note || ''
  form.is_enabled = !!p.is_enabled
  showDialog.value = true
}

async function save() {
  const p = pregnancyStore.currentPregnancy as any
  if (!p || !p.id) return
  if (!form.name.trim()) {
    formError.value = '请填名称'
    return
  }
  // 允许「全部留空」——留空＝不限制，但不能只填一半导致区间反向
  if (form.start_date && form.end_date && form.start_date > form.end_date) {
    formError.value = '开始日期不能晚于结束日期'
    return
  }
  const sw = form.start_week === '' ? null : Number(form.start_week)
  const ew = form.end_week === '' ? null : Number(form.end_week)
  if (sw !== null && ew !== null && sw > ew) {
    formError.value = '开始孕周不能大于结束孕周'
    return
  }
  // ⚠️「每周指定」一个都不勾 = 后端不过滤 = 每天都提醒（上线前检查 #5）
  if (form.frequency === 'weekdays' && !form.weekdays.length) {
    formError.value = '每周指定至少要勾一天'
    return
  }
  formError.value = ''
  saving.value = true
  try {
    const payload: any = {
      pregnancy_id: p.id,
      kind: form.kind,
      name: form.name.trim(),
      dosage: form.dosage,
      reminder_times: form.reminder_times.filter((t: string) => !!t),
      frequency: form.frequency,
      weekdays: form.frequency === 'weekdays' ? form.weekdays : [],
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      start_week: sw,
      end_week: ew,
      note: form.note,
      is_enabled: form.is_enabled ? 1 : 0,
    }
    if (editingId.value) await dosePlanApi.update(editingId.value, payload)
    else await dosePlanApi.create(payload)
    showDialog.value = false
    message.success(editingId.value ? '已更新' : '已添加')
    await loadPlans()
    todayRef.value?.refresh()
  } catch (e: any) {
    formError.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

/** 停/启用：:value 单向绑定，值由我们自己改（乐观更新，失败回滚） */
async function toggleEnabled(plan: any) {
  const val = !plan.is_enabled
  plan.is_enabled = val
  try {
    await dosePlanApi.update(plan.id, { is_enabled: val ? 1 : 0 })
    todayRef.value?.refresh()
  } catch (e) {
    plan.is_enabled = !val
    message.error('操作失败')
  }
}

async function removePlan(plan: any) {
  if (!window.confirm(`删除「${plan.name}」？它的打卡记录也会一起删除。`)) return
  try {
    await dosePlanApi.remove(plan.id)
    message.success('已删除')
    await loadPlans()
    todayRef.value?.refresh()
  } catch (e) {
    message.error('删除失败')
  }
}

onMounted(loadPlans)
</script>

<style scoped>
.dose-plan-view {
  padding: var(--space-4, 16px);
  max-width: var(--layout-max-width, 920px);
  margin: 0 auto;
}

.dp-intro {
  background: var(--bg-tint-blue);
  border-left: 3px solid var(--info-color);
  border-radius: var(--radius-md, 12px);
  padding: 10px 14px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dp-intro strong { font-size: 13.5px; color: var(--info-ink); }
.dp-intro span { font-size: 12.5px; color: var(--text-secondary); }

.dp-section {
  background: var(--bg-card);
  border-radius: var(--radius-lg, 16px);
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
}
.dp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.dp-section-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color);
}
.dp-add-btn {
  border: 1px solid var(--primary-color);
  background: var(--bg-card);
  color: var(--primary-color);
  font-size: 12.5px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: var(--radius-full, 9999px);
  cursor: pointer;
}

.dp-empty {
  font-size: 13px;
  color: var(--text-hint);
  padding: 8px 0;
}

.dp-card {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 12px);
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--bg-card);
}
.dp-card.disabled { opacity: 0.6; }

.dp-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dp-kind {
  padding: 2px 7px;
  border-radius: var(--radius-xs, 4px);
  font-size: 11.5px;
  font-weight: 600;
}
.dp-kind.medication { background: var(--bg-tint-blue); color: var(--info-ink); }
.dp-kind.supplement { background: var(--bg-tint-mint); color: var(--success-ink); }
.dp-name { font-size: 14.5px; font-weight: 600; color: var(--text-color); }
.dp-dosage { font-size: 12.5px; color: var(--text-secondary); }

.dp-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}
.dp-meta-item { font-size: 12.5px; color: var(--text-hint); }
.dp-card-note {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.dp-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  margin-top: 8px;
}
.dp-act {
  border: none;
  background: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--primary-color);
  cursor: pointer;
  padding: 0;
}
.dp-act.danger { color: var(--error-ink); }

.dp-foot-tip {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--text-hint);
  line-height: 1.6;
}
.dp-foot-tip a { color: var(--primary-color); font-weight: 600; text-decoration: none; }

/* ===== 表单 ===== */
.dp-form { display: flex; flex-direction: column; gap: 14px; }
.dp-field { display: flex; flex-direction: column; gap: 6px; }
.dp-field-inline { flex-direction: row; align-items: center; justify-content: space-between; }
.dp-label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
.dp-label em { color: var(--error-color); font-style: normal; }

.dp-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-color);
  background: var(--bg-card);
  border: 1px solid var(--border-color-strong);
  border-radius: var(--radius-sm, 8px);
}
.dp-input:focus { outline: none; border-color: var(--primary-color); }

.dp-seg { display: flex; gap: 8px; }
.dp-seg-btn {
  flex: 1;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-color-strong);
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
}
.dp-seg-btn.active {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--bg-tint-pink);
  font-weight: 600;
}

.dp-tpls { display: flex; flex-wrap: wrap; gap: 6px; }
.dp-tpl {
  padding: 4px 10px;
  font-size: 12.5px;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--bg-color-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-full, 9999px);
  cursor: pointer;
}

.dp-times { display: flex; flex-direction: column; gap: 6px; }
.dp-time-row { display: flex; align-items: center; gap: 6px; }
.dp-time { flex: 1; }
.dp-time-del {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px solid var(--border-color-strong);
  background: var(--bg-card);
  color: var(--error-ink);
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.dp-time-add {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--primary-color);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 0;
}

.dp-weekdays { display: flex; gap: 6px; }
.dp-wd {
  width: 32px;
  height: 32px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-color-strong);
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
}
.dp-wd.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: var(--text-inverse);
  font-weight: 600;
}

.dp-range { display: flex; align-items: center; gap: 8px; }
.dp-range-sep { font-size: 12.5px; color: var(--text-hint); flex-shrink: 0; }

.dp-err { margin: 0; font-size: 12.5px; color: var(--error-ink); }

.dp-form-actions { display: flex; gap: 10px; justify-content: flex-end; }
.dp-btn {
  padding: 8px 18px;
  font-size: 13.5px;
  font-family: inherit;
  font-weight: 600;
  border-radius: var(--radius-full, 9999px);
  cursor: pointer;
}
.dp-btn.ghost {
  background: var(--bg-card);
  border: 1px solid var(--border-color-strong);
  color: var(--text-secondary);
}
.dp-btn.primary {
  background: var(--primary-color);
  border: 1px solid var(--primary-color);
  color: var(--text-inverse);
}
.dp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
