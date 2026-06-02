<template>
  <n-modal v-model:show="visible" preset="card" :title="isEdit ? '编辑产检记录' : '新增产检记录'" style="max-width: 500px">
    <n-form ref="formRef" :model="form" label-placement="left" label-width="80">
      <n-form-item label="检查日期">
        <n-input v-model:value="form.checkup_date" type="text" placeholder="YYYY-MM-DD" />
      </n-form-item>
      <n-form-item label="检查类型">
        <n-select v-model:value="form.checkup_type" :options="checkupTypes" placeholder="选择检查类型" />
      </n-form-item>
      <n-form-item label="医院">
        <n-input v-model:value="form.hospital" placeholder="检查医院（选填）" />
      </n-form-item>
      <n-form-item label="血压">
        <div class="bp-input">
          <n-input-number v-model:value="form.blood_pressure_systolic" :min="60" :max="200" placeholder="收缩压" style="width: 120px" />
          <span class="bp-divider">/</span>
          <n-input-number v-model:value="form.blood_pressure_diastolic" :min="40" :max="140" placeholder="舒张压" style="width: 120px" />
          <span class="bp-unit">mmHg</span>
        </div>
      </n-form-item>
      <n-form-item label="体重">
        <n-input-number v-model:value="form.weight" :min="30" :max="200" :step="0.1" placeholder="体重" style="width: 160px">
          <template #suffix>kg</template>
        </n-input-number>
      </n-form-item>
      <n-form-item label="宫高">
        <n-input-number v-model:value="form.fundal_height" :min="10" :max="50" :step="0.5" placeholder="宫高" style="width: 160px">
          <template #suffix>cm</template>
        </n-input-number>
      </n-form-item>
      <n-form-item label="腹围">
        <n-input-number v-model:value="form.abdominal_circumference" :min="50" :max="150" :step="0.5" placeholder="腹围" style="width: 160px">
          <template #suffix>cm</template>
        </n-input-number>
      </n-form-item>
      <n-form-item label="胎心率">
        <n-input-number v-model:value="form.fetal_heart_rate" :min="60" :max="200" placeholder="胎心率" style="width: 160px">
          <template #suffix>次/分</template>
        </n-input-number>
      </n-form-item>
      <n-form-item label="备注">
        <n-input v-model:value="form.notes" type="textarea" placeholder="检查备注" :rows="3" />
      </n-form-item>
    </n-form>
    <template #action>
      <n-button @click="visible = false">取消</n-button>
      <n-button type="primary" @click="handleSave">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NForm, NFormItem, NInput, NInputNumber, NSelect } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { checkupApi } from '@/api/checkup'
import dayjs from 'dayjs'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const pregnancyStore = usePregnancyStore()
const isEdit = computed(() => !!props.editData?.id)

const form = ref({
  checkup_date: '',
  checkup_type: null as string | null,
  hospital: '',
  blood_pressure_systolic: null as number | null,
  blood_pressure_diastolic: null as number | null,
  weight: null as number | null,
  fundal_height: null as number | null,
  abdominal_circumference: null as number | null,
  fetal_heart_rate: null as number | null,
  notes: '',
})

const checkupTypes = [
  { label: '早孕检查', value: 'early_pregnancy' },
  { label: 'NT检查', value: 'nt' },
  { label: '早期唐筛', value: 'early_tang' },
  { label: '中期唐筛', value: 'mid_tang' },
  { label: 'NIPT(无创DNA)', value: 'nipt' },
  { label: '大排畸', value: 'anomaly_scan' },
  { label: 'OGTT(糖耐量)', value: 'ogtt' },
  { label: '小排畸', value: 'growth_scan' },
  { label: 'NST(胎心监护)', value: 'nst' },
  { label: 'GBS(B族链球菌)', value: 'gbs' },
  { label: '常规产检', value: 'routine' },
  { label: '其他', value: 'other' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

function parseBloodPressure(bp?: string | null): { systolic: number | null; diastolic: number | null } {
  if (!bp) return { systolic: null, diastolic: null }
  const match = bp.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (match) return { systolic: Number(match[1]), diastolic: Number(match[2]) }
  return { systolic: null, diastolic: null }
}

function calcGestationalWeek(dateStr: string): { gestational_week: number; gestational_day: number } {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  if (!lmp) return { gestational_week: 0, gestational_day: 0 }
  const totalDays = dayjs(dateStr).diff(dayjs(lmp), 'day')
  if (totalDays < 0) return { gestational_week: 0, gestational_day: 0 }
  return { gestational_week: Math.floor(totalDays / 7), gestational_day: totalDays % 7 }
}

watch(() => props.show, (val) => {
  if (val && props.editData) {
    const bp = parseBloodPressure(props.editData.blood_pressure)
    form.value = {
      checkup_date: props.editData.checkup_date || '',
      checkup_type: props.editData.checkup_type || null,
      hospital: props.editData.hospital || '',
      blood_pressure_systolic: bp.systolic,
      blood_pressure_diastolic: bp.diastolic,
      weight: props.editData.weight ?? null,
      fundal_height: props.editData.fundal_height ?? null,
      abdominal_circumference: props.editData.abdominal_circumference ?? null,
      fetal_heart_rate: props.editData.fetal_heart_rate ?? null,
      notes: props.editData.notes || '',
    }
  } else if (val) {
    form.value = {
      checkup_date: new Date().toISOString().split('T')[0],
      checkup_type: null, hospital: '',
      blood_pressure_systolic: null, blood_pressure_diastolic: null,
      weight: null, fundal_height: null, abdominal_circumference: null,
      fetal_heart_rate: null, notes: '',
    }
  }
})

async function handleSave() {
  if (!pregnancyStore.currentPregnancy || !form.value.checkup_date || !form.value.checkup_type) return
  const bpS = form.value.blood_pressure_systolic
  const bpD = form.value.blood_pressure_diastolic
  const blood_pressure = (bpS != null && bpD != null) ? `${bpS}/${bpD}` : null
  const { gestational_week, gestational_day } = calcGestationalWeek(form.value.checkup_date)
  const data: any = {
    pregnancy_id: pregnancyStore.currentPregnancy.id,
    checkup_date: form.value.checkup_date,
    gestational_week,
    gestational_day,
    checkup_type: form.value.checkup_type,
    hospital: form.value.hospital || null,
    blood_pressure,
    weight: form.value.weight,
    fundal_height: form.value.fundal_height,
    abdominal_circumference: form.value.abdominal_circumference,
    fetal_heart_rate: form.value.fetal_heart_rate,
    notes: form.value.notes || null,
    is_completed: 1,
  }
  if (isEdit.value) {
    await checkupApi.update(props.editData.id, data)
  } else {
    await checkupApi.create(data)
  }
  visible.value = false
  emit('saved')
}
</script>

<style scoped>
.bp-input { display: flex; align-items: center; gap: 4px; }
.bp-divider { font-size: 18px; color: var(--text-secondary); }
.bp-unit { font-size: 13px; color: var(--text-hint); margin-left: 4px; }
</style>
