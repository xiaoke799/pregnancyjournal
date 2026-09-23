<template>
  <div class="milestone-gallery" v-if="photos.length > 0">
    <div class="milestone-grid">
      <div v-for="photo in photos" :key="photo.id" class="milestone-item">
        <img :src="thumbnailUrl(photo.id)" :alt="photo.milestone_type || ''" class="milestone-img" />
        <div class="milestone-label">{{ photo.milestone_type || `孕${photo.gestational_week}周` }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { photoApi } from '@/api/photo'

defineProps<{
  photos: Array<{ id: string; gestational_week: number; milestone_type?: string }>
}>()

function thumbnailUrl(id: string): string {
  return photoApi.thumbnailUrl(id)
}
</script>

<style scoped>
.milestone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.milestone-item { position: relative; border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow-sm); }
.milestone-img { width: 100%; aspect-ratio: 1; object-fit: cover; }
.milestone-label {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.6));
  color: white; padding: 20px 8px 8px; font-size: 13px; text-align: center;
}
</style>
