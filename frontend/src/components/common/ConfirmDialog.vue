<template>
  <n-modal v-model:show="visible" preset="card" :title="title" style="max-width: 420px">
    <p class="confirm-message">{{ message }}</p>
    <template #action>
      <div class="confirm-actions">
        <n-button @click="handleCancel">取消</n-button>
        <n-button :type="danger ? 'error' : 'primary'" @click="handleConfirm">确认</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NButton } from 'naive-ui'

const props = withDefaults(defineProps<{
  show: boolean
  title?: string
  message: string
  danger?: boolean
}>(), {
  title: '确认操作',
  danger: false,
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: []
  cancel: []
}>()

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

function handleConfirm() {
  emit('confirm')
  visible.value = false
}

function handleCancel() {
  emit('cancel')
  visible.value = false
}
</script>

<style scoped>
.confirm-message { font-size: 15px; color: var(--text-color); line-height: 1.6; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>
