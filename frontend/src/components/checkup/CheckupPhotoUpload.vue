<template>
  <div class="checkup-photo-upload">
    <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="handleUpload" />
    <n-button size="small" @click="fileInput?.click()">📷 上传检查单</n-button>
    <div v-if="photos.length > 0" class="photo-grid">
      <div v-for="p in photos" :key="p.id" class="photo-thumb-wrapper">
        <img :src="`/api/v1/checkups/photos/${p.id}/file`" :alt="p.note || ''" class="photo-thumb" />
        <button class="delete-btn" @click="$emit('deletePhoto', p.id)">✕</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NButton } from 'naive-ui'
import { checkupApi } from '@/api/checkup'

const props = defineProps<{
  checkupId: string
}>()

const emit = defineEmits<{
  deletePhoto: [photoId: string]
  uploaded: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const photos = ref<any[]>([])

async function handleUpload(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  await checkupApi.uploadPhoto(props.checkupId, file)
  await loadPhotos()
  target.value = ''
  emit('uploaded')
}

async function loadPhotos() {
  const res: any = await checkupApi.listPhotos(props.checkupId)
  if (res.code === 0) photos.value = res.data || []
}

onMounted(() => { if (props.checkupId) loadPhotos() })
</script>

<style scoped>
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.photo-thumb-wrapper { position: relative; width: 80px; height: 80px; }
.photo-thumb { width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-sm); }
.delete-btn {
  position: absolute; top: -4px; right: -4px; width: 20px; height: 20px;
  border-radius: 50%; background: rgba(255,77,79,0.8); color: white;
  border: none; cursor: pointer; font-size: 10px; display: flex;
  align-items: center; justify-content: center;
}
</style>
