<template>
  <div class="export-panel">
    <h3>数据导出</h3>

    <!-- CSV 健康数据 -->
    <div class="export-item">
      <div class="export-info">
        <span class="export-icon">📊</span>
        <div>
          <span class="export-title">健康数据 (CSV)</span>
          <span class="export-desc">导出全部健康指标，可用 Excel 打开</span>
        </div>
      </div>
      <n-button size="small" :loading="exportingCsv" @click="handleExportCsv">导出</n-button>
    </div>

    <!-- 日记 PDF -->
    <div class="export-item">
      <div class="export-info">
        <span class="export-icon">📖</span>
        <div>
          <span class="export-title">孕期日记 (PDF)</span>
          <span class="export-desc">按日期排版生成 PDF 文档</span>
        </div>
      </div>
      <n-button size="small" :loading="exportingDiary" @click="handleExportDiary">导出</n-button>
    </div>

    <!-- 纪念相册 PDF -->
    <div class="export-item">
      <div class="export-info">
        <span class="export-icon">📷</span>
        <div>
          <span class="export-title">纪念相册 (PDF)</span>
          <span class="export-desc">按时间线排列照片，生成纪念册 PDF</span>
        </div>
      </div>
      <n-button size="small" :loading="exportingAlbum" @click="handleExportAlbum">导出</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { exportApi } from '@/api/export'

const pregnancyStore = usePregnancyStore()
const message = useMessage()
const exportingCsv = ref(false)
const exportingDiary = ref(false)
const exportingAlbum = ref(false)

async function handleExportCsv() {
  if (!pregnancyStore.currentPregnancy) return
  exportingCsv.value = true
  try {
    const res: any = await exportApi.exportCsv({ pregnancy_id: pregnancyStore.currentPregnancy.id })
    if (res instanceof Blob) {
      const text = await res.text()
      try {
        const errJson = JSON.parse(text)
        if (errJson.code !== 0) { message.warning(errJson.message || '导出失败'); return }
      } catch { /* 非 JSON，正常 CSV 内容 */ }
      const url = window.URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `孕程记_健康记录_${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      message.success('CSV 导出成功')
    }
  } catch (e: any) {
    message.error(e?.message || '导出失败')
  } finally {
    exportingCsv.value = false
  }
}

async function handleExportDiary() {
  if (!pregnancyStore.currentPregnancy) return
  exportingDiary.value = true
  try {
    const res: any = await exportApi.exportDiaryPdf({ pregnancy_id: pregnancyStore.currentPregnancy.id })
    if (res instanceof Blob) {
      const buf = await res.arrayBuffer()
      // 检查是否为 JSON 错误响应（PDF 二进制通常不以 { 开头）
      const firstBytes = new Uint8Array(buf.slice(0, 1))
      if (firstBytes[0] === 0x7B) { // '{'
        const errText = new TextDecoder().decode(buf)
        try {
          const errJson = JSON.parse(errText)
          if (errJson.code !== 0) { message.warning(errJson.message || '导出失败'); return }
        } catch { /* ignore */ }
      }
      const url = window.URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `孕程记_日记_${new Date().toISOString().slice(0,10)}.pdf`
      a.click()
      window.URL.revokeObjectURL(url)
      message.success('日记 PDF 导出成功')
    }
  } catch (e: any) {
    message.error(e?.message || '导出失败')
  } finally {
    exportingDiary.value = false
  }
}

async function handleExportAlbum() {
  if (!pregnancyStore.currentPregnancy) return
  exportingAlbum.value = true
  try {
    const res: any = await exportApi.exportAlbumPdf({ pregnancy_id: pregnancyStore.currentPregnancy.id })
    if (res instanceof Blob) {
      const buf = await res.arrayBuffer()
      const firstBytes = new Uint8Array(buf.slice(0, 1))
      if (firstBytes[0] === 0x7B) {
        const errText = new TextDecoder().decode(buf)
        try {
          const errJson = JSON.parse(errText)
          if (errJson.code !== 0) { message.warning(errJson.message || '导出失败'); return }
        } catch { /* ignore */ }
      }
      const url = window.URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `孕程记_纪念相册_${new Date().toISOString().slice(0,10)}.pdf`
      a.click()
      window.URL.revokeObjectURL(url)
      message.success('纪念相册 PDF 导出成功')
    }
  } catch (e: any) {
    message.error(e?.message || '导出失败')
  } finally {
    exportingAlbum.value = false
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
