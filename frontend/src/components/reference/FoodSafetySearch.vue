<template>
  <div class="food-safety-search">
    <n-input v-model:value="keyword" placeholder="搜索食材，如：螃蟹、咖啡..." @input="handleSearch">
      <template #prefix>🔍</template>
    </n-input>
    <div v-if="results.length > 0" class="food-results">
      <div v-for="item in results" :key="item.name" class="food-item">
        <div class="food-left">
          <span class="food-name">{{ item.name }}</span>
          <span class="food-badge" :class="item.safety">{{ safetyLabel(item.safety) }}</span>
        </div>
        <div class="food-note" v-if="item.note">{{ item.note }}</div>
        <div class="food-category" v-if="item.category">{{ item.category }}</div>
      </div>
    </div>
    <div v-else-if="keyword && !loading" class="no-results">
      未找到"{{ keyword }}"相关信息
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NInput } from 'naive-ui'
import { referenceApi } from '@/api/reference'

const keyword = ref('')
const results = ref<any[]>([])
const loading = ref(false)

function safetyLabel(s: string): string {
  const map: Record<string, string> = { safe: '✅ 可食用', caution: '⚠️ 慎食', unsafe: '🚫 禁食' }
  return map[s] || s
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function handleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  if (!keyword.value) { results.value = []; return }
  searchTimer = setTimeout(async () => {
    loading.value = true
    try {
      const res: any = await referenceApi.getFoodSafety(keyword.value)
      if (res.code === 0 && res.data) {
        results.value = res.data.results || []
      }
    } finally {
      loading.value = false
    }
  }, 300)
}
</script>

<style scoped>
.food-results { margin-top: 12px; }
.food-item { padding: 10px 0; border-bottom: 1px solid var(--border-color); }
.food-item:last-child { border-bottom: none; }
.food-left { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.food-name { font-weight: 600; font-size: 15px; }
.food-badge { font-size: 12px; padding: 2px 10px; border-radius: 12px; }
.food-badge.safe { background: #f6ffed; color: #52c41a; }
.food-badge.caution { background: #fffbe6; color: #faad14; }
.food-badge.unsafe { background: #fff2f0; color: #ff4d4f; }
.food-note { color: var(--text-secondary); font-size: 13px; line-height: 1.4; }
.food-category { font-size: 11px; color: var(--text-hint); margin-top: 2px; }
.no-results { text-align: center; padding: 30px; color: var(--text-hint); font-size: 14px; }
</style>
