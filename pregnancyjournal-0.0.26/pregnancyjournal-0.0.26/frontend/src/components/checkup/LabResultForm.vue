<template>
  <n-modal v-model:show="visible" preset="card" title="添加检查指标" style="max-width: 500px">
    <n-form :model="form" label-placement="left" label-width="80">
      <n-form-item label="指标类别">
        <n-select v-model:value="form.category" :options="categories" placeholder="选择类别" />
      </n-form-item>
      <n-form-item label="指标名称">
        <n-input v-model:value="form.item_name" placeholder="如：血红蛋白" />
      </n-form-item>
      <n-form-item label="数值">
        <n-input-number v-model:value="form.value" :step="0.01" placeholder="检查值" style="width: 100%" />
      </n-form-item>
      <n-form-item label="单位">
        <n-input v-model:value="form.unit" placeholder="如：g/L" />
      </n-form-item>
      <n-form-item label="参考下限">
        <n-input-number v-model:value="form.reference_min" :step="0.01" style="width: 100%" />
      </n-form-item>
      <n-form-item label="参考上限">
        <n-input-number v-model:value="form.reference_max" :step="0.01" style="width: 100%" />
      </n-form-item>
    </n-form>
    <template #action>
      <n-button @click="visible = false">取消</n-button>
      <n-button type="primary" :disabled="!form.item_name || form.value === null" @click="handleSave">保存</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NForm, NFormItem, NInput, NInputNumber, NSelect } from 'naive-ui'
import { labResultApi } from '@/api/lab-result'

const props = defineProps<{
  show: boolean
  checkupId: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
}>()

const form = ref({
  category: null as string | null,
  item_name: '',
  value: null as number | null,
  unit: '',
  reference_min: null as number | null,
  reference_max: null as number | null,
})

const categories = [
  { label: '血常规', value: 'blood_routine' },
  { label: '尿常规', value: 'urine_routine' },
  { label: 'B超', value: 'ultrasound' },
  { label: 'HCG/孕酮', value: 'hcg_progesterone' },
  { label: '血糖', value: 'glucose' },
  { label: '肝功能', value: 'liver' },
  { label: '肾功能', value: 'kidney' },
  { label: '甲状腺', value: 'thyroid' },
  { label: '凝血', value: 'coagulation' },
  { label: '其他', value: 'other' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

watch(() => props.show, (val) => {
  if (val) {
    form.value = { category: null, item_name: '', value: null, unit: '', reference_min: null, reference_max: null }
  }
})

async function handleSave() {
  if (!form.value.item_name || form.value.value === null || !props.checkupId) return
  await labResultApi.create({
    checkup_id: props.checkupId,
    ...form.value,
  })
  visible.value = false
  emit('saved')
}
</script>
