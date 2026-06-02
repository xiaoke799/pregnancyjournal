<template>
  <div class="export-panel">
    <h3>数据导出</h3>
    <div class="export-item">
      <div class="export-info">
        <span class="export-icon">📄</span>
        <div>
          <span class="export-title">PDF 纪念册</span>
          <span class="export-desc">生成包含孕期记录的精美PDF</span>
        </div>
      </div>
      <n-button size="small" :loading="generating" @click="handleGeneratePdf">生成</n-button>
    </div>
    <div class="export-item" v-if="pdfTaskId">
      <div class="export-info">
        <span>生成进度</span>
      </div>
      <n-button size="small" @click="downloadPdf">下载</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NButton } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import client from '@/api/client'
import { exportApi } from '@/api/export'

const pregnancyStore = usePregnancyStore()
const generating = ref(false)
const pdfTaskId = ref('')

async function handleGeneratePdf() {
  if (!pregnancyStore.currentPregnancy) return
  generating.value = true
  try {
    const res: any = await exportApi.generatePdf(pregnancyStore.currentPregnancy.id)
    if (res.code === 0 && res.data) {
      pdfTaskId.value = res.data.task_id
    }
  } finally {
    generating.value = false
  }
}

function downloadPdf() {
  if (pdfTaskId.value) {
    window.open(`${(client as any).defaults.baseURL}/pdf/download/${pdfTaskId.value}`, '_blank')
  }
}
</script>

<style scoped>
.export-panel {
  background: var(--bg-card); border-radius: var(--radius-lg); padding: 20px;
  margin-bottom: 16px; box-shadow: var(--shadow-sm);
}
.export-panel h3 { margin-bottom: 16px; color: var(--accent-color); }
.export-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-color); }
.export-item:last-child { border-bottom: none; }
.export-info { display: flex; align-items: center; gap: 12px; }
.export-icon { font-size: 20px; }
.export-title { font-weight: 500; display: block; }
.export-desc { font-size: 12px; color: var(--text-hint); display: block; }
</style>
