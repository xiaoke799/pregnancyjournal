<template>
  <div class="pregnancy-switcher" v-if="pregnancies.length > 1">
    <h3>孕期切换</h3>
    <div class="pregnancy-list">
      <div
        v-for="p in pregnancies"
        :key="p.id"
        class="pregnancy-item"
        :class="{ active: p.id === activeId }"
        @click="switchPregnancy(p.id)"
      >
        <span class="pregnancy-name">{{ p.baby_name || '宝宝' }}</span>
        <span class="pregnancy-due">预产期：{{ p.due_date }}</span>
        <span class="pregnancy-status" v-if="p.is_active">当前</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePregnancyStore } from '@/stores/pregnancy'
import { pregnancyApi } from '@/api/pregnancy'

const pregnancyStore = usePregnancyStore()
const pregnancies = ref<any[]>([])
const activeId = ref('')

async function switchPregnancy(id: string) {
  await pregnancyApi.activate(id)
  await pregnancyStore.fetchActivePregnancy()
  activeId.value = id
}

onMounted(async () => {
  const res: any = await pregnancyApi.list()
  if (res.code === 0) {
    pregnancies.value = res.data?.items || res.data || []
    const active = pregnancies.value.find((p: any) => p.is_active)
    if (active) activeId.value = active.id
  }
})
</script>

<style scoped>
.pregnancy-switcher {
  background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.pregnancy-switcher h3 { margin-bottom: 12px; color: var(--accent-color); }
.pregnancy-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;
  border: 2px solid transparent; margin-bottom: 4px;
}
.pregnancy-item:hover { background: rgba(232,160,191,0.05); }
.pregnancy-item.active { border-color: var(--primary-color); background: rgba(232,160,191,0.1); }
.pregnancy-name { font-weight: 600; }
.pregnancy-due { color: var(--text-secondary); font-size: 13px; flex: 1; }
.pregnancy-status {
  background: var(--primary-color); color: white; font-size: 11px;
  padding: 2px 8px; border-radius: 12px;
}
</style>
