<template>
  <n-modal v-model:show="visible" preset="card" title="上传照片" style="max-width: 400px">
    <div class="upload-form">
      <div class="upload-area" @click="triggerFile" @dragover.prevent @drop.prevent="handleDrop">
        <div v-if="!previewUrl" class="upload-placeholder">
          <span class="upload-icon">📷</span>
          <p>点击选择或拖拽照片</p>
        </div>
        <img v-else :src="previewUrl" class="preview-img" />
      </div>
      <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="handleFileSelect" />
      <div class="form-group" v-if="previewUrl">
        <label>照片类型</label>
        <n-select v-model:value="form.photo_type" :options="photoTypes" />
      </div>
      <div class="form-group" v-if="previewUrl">
        <label>里程碑标签（可选）</label>
        <n-input v-model:value="form.milestone_type" placeholder="如：第一次胎动" />
      </div>
      <div class="form-group" v-if="previewUrl">
        <label>备注</label>
        <n-input v-model:value="form.note" placeholder="照片备注" />
      </div>
    </div>
    <template #action>
      <n-button @click="visible = false">取消</n-button>
      <n-button type="primary" :disabled="!selectedFile" @click="handleUpload">上传</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NModal, NButton, NSelect, NInput } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { usePhotoUpload } from '@/composables/usePhotoUpload'

const props = defineProps<{
  show: boolean
  defaultType?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  uploaded: []
}>()

const pregnancyStore = usePregnancyStore()
const { upload } = usePhotoUpload()

const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const previewUrl = ref('')

const form = ref({
  photo_type: props.defaultType || 'belly',
  milestone_type: '',
  note: '',
})

const photoTypes = [
  { label: '🤰 孕妇照', value: 'belly' },
  { label: '🏥 B超照', value: 'ultrasound' },
  { label: '👶 成长里程碑', value: 'milestone' },
]

const visible = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

function triggerFile() {
  fileInput.value?.click()
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) selectFile(file)
}

function handleDrop(e: DragEvent) {
  const file = e.dataTransfer?.files[0]
  if (file) selectFile(file)
}

function selectFile(file: File) {
  selectedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
}

async function handleUpload() {
  if (!selectedFile.value || !pregnancyStore.currentPregnancy) return
  await upload(selectedFile.value, pregnancyStore.currentPregnancy.id, form.value.photo_type, {
    milestoneType: form.value.milestone_type || undefined,
    note: form.value.note || undefined,
    gestationalWeek: pregnancyStore.gestationalAge?.weeks,
  })
  selectedFile.value = null
  previewUrl.value = ''
  form.value = { photo_type: props.defaultType || 'belly', milestone_type: '', note: '' }
  visible.value = false
  emit('uploaded')
}
</script>

<style scoped>
.upload-area {
  border: 2px dashed var(--border-color); border-radius: var(--radius-lg);
  padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s;
  margin-bottom: 16px;
}
.upload-area:hover { border-color: var(--primary-color); background: rgba(232,160,191,0.05); }
.upload-icon { font-size: 48px; display: block; margin-bottom: 8px; }
.upload-placeholder p { color: var(--text-hint); font-size: 14px; }
.preview-img { max-width: 100%; max-height: 200px; object-fit: contain; border-radius: var(--radius-md); }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; margin-bottom: 4px; font-size: 13px; color: var(--text-secondary); }
</style>
