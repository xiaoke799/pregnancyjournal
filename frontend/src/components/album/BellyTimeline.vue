<template>
  <div class="belly-timeline" v-if="photos.length > 0">
    <h4>🤰 孕肚成长时间线</h4>
    <div class="timeline">
      <div v-for="photo in sortedPhotos" :key="photo.id" class="timeline-item">
        <div class="timeline-line">
          <div class="timeline-dot" />
        </div>
        <div class="timeline-content">
          <div class="timeline-week">孕{{ photo.gestational_week }}周</div>
          <img :src="thumbnailUrl(photo.id)" :alt="`孕${photo.gestational_week}周`" class="timeline-photo" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { photoApi } from '@/api/photo'

const props = defineProps<{
  photos: Array<{ id: string; gestational_week: number }>
}>()

const sortedPhotos = computed(() =>
  [...props.photos].sort((a, b) => a.gestational_week - b.gestational_week)
)

function thumbnailUrl(id: string): string {
  return photoApi.thumbnailUrl(id)
}
</script>

<style scoped>
.belly-timeline h4 { margin-bottom: 16px; }
.timeline { display: flex; overflow-x: auto; gap: 0; padding-bottom: 8px; }
.timeline-item { display: flex; flex-direction: column; align-items: center; min-width: 120px; position: relative; }
.timeline-line { display: flex; flex-direction: column; align-items: center; }
.timeline-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--primary-color); border: 2px solid white; box-shadow: 0 0 0 2px var(--primary-color); }
.timeline-content { margin-top: 8px; text-align: center; }
.timeline-week { font-size: 12px; color: var(--primary-color); font-weight: 600; margin-bottom: 4px; }
.timeline-photo { width: 100px; height: 130px; object-fit: cover; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); }
</style>
