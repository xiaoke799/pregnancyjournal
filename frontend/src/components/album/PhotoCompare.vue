<template>
  <div class="photo-compare" v-if="photos.length >= 2">
    <h4>🔄 孕肚对比</h4>
    <div class="compare-controls">
      <select v-model="leftIndex" class="compare-select">
        <option v-for="(p, i) in photos" :key="i" :value="i">孕{{ p.gestational_week }}周</option>
      </select>
      <span class="compare-vs">VS</span>
      <select v-model="rightIndex" class="compare-select">
        <option v-for="(p, i) in photos" :key="i" :value="i">孕{{ p.gestational_week }}周</option>
      </select>
    </div>
    <div class="compare-images">
      <div class="compare-side">
        <img :src="thumbnailUrl(photos[leftIndex]?.id)" class="compare-img" />
        <div class="compare-label">孕{{ photos[leftIndex]?.gestational_week }}周</div>
      </div>
      <div class="compare-side">
        <img :src="thumbnailUrl(photos[rightIndex]?.id)" class="compare-img" />
        <div class="compare-label">孕{{ photos[rightIndex]?.gestational_week }}周</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { photoApi } from '@/api/photo'

const props = defineProps<{
  photos: Array<{ id: string; gestational_week: number }>
}>()

const leftIndex = ref(0)
const rightIndex = ref(1)

watch(() => props.photos.length, (len) => {
  if (len >= 2) { leftIndex.value = 0; rightIndex.value = len - 1 }
})

function thumbnailUrl(id: string | undefined): string {
  return id ? photoApi.thumbnailUrl(id) : ''
}
</script>

<style scoped>
.photo-compare h4 { margin-bottom: 12px; }
.compare-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; justify-content: center; }
.compare-select { padding: 6px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color); font-size: 14px; }
.compare-vs { font-weight: 700; color: var(--primary-color); }
.compare-images { display: flex; gap: 16px; }
.compare-side { flex: 1; text-align: center; }
.compare-img { width: 100%; max-height: 300px; object-fit: cover; border-radius: var(--radius-md); }
.compare-label { margin-top: 8px; font-size: 14px; font-weight: 600; color: var(--primary-color); }
</style>
