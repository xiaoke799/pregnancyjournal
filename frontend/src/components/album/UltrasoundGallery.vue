<template>
  <div class="ultrasound-gallery" v-if="photos.length > 0">
    <div class="gallery-grid">
      <div v-for="photo in photos" :key="photo.id" class="gallery-item" @click="$emit('view', photo)">
        <img :src="thumbnailUrl(photo.id)" :alt="photo.note || ''" class="gallery-img" />
        <div class="gallery-info">
          <span class="gallery-week">孕{{ photo.gestational_week }}周</span>
          <span class="gallery-note" v-if="photo.note">{{ photo.note }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { photoApi } from '@/api/photo'

defineProps<{
  photos: Array<{ id: string; gestational_week: number; note?: string }>
}>()

defineEmits<{
  view: [photo: any]
}>()

function thumbnailUrl(id: string): string {
  return photoApi.thumbnailUrl(id)
}
</script>

<style scoped>
.gallery-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.gallery-item { background: var(--bg-card); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow-sm); cursor: pointer; transition: transform 0.2s; }
.gallery-item:hover { transform: translateY(-2px); }
.gallery-img { width: 100%; aspect-ratio: 4/3; object-fit: cover; background: #000; }
.gallery-info { padding: 8px; }
.gallery-week { font-size: 13px; font-weight: 600; color: var(--primary-color); display: block; }
.gallery-note { font-size: 12px; color: var(--text-secondary); display: block; margin-top: 2px; }
</style>
