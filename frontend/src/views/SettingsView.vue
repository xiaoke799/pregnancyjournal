<template>
  <div class="settings-view">
    <h2>⚙️ 设置</h2>
    <div class="settings-sections">
      <!-- 孕期管理 -->
      <div class="section">
        <h3>🤰 孕期管理</h3>

        <div v-if="pregnancyStore.currentPregnancy" class="pregnancy-status">
          <div class="status-row">
            <div class="status-item">
              <span class="status-label">当前预产期</span>
              <span class="due-date-value">{{ pregnancyStore.currentPregnancy.due_date || '未设置' }}</span>
            </div>
            <div class="status-item" v-if="pregnancyStore.gestationalAge">
              <span class="status-label">当前孕周</span>
              <span class="gestational-info">
                {{ pregnancyStore.gestationalAge.weeks }}周{{ pregnancyStore.gestationalAge.days }}天
                <n-tag size="small" :type="trimesterTagType" style="margin-left: 8px;">
                  {{ pregnancyStore.gestationalAge.trimester }}
                </n-tag>
              </span>
            </div>
          </div>
        </div>

        <div class="pregnancy-form">
          <div class="form-group">
            <label class="form-label">设置方式</label>
            <n-radio-group v-model:value="dueDateMode" size="medium">
              <n-radio-button value="lmp">末次月经推算</n-radio-button>
              <n-radio-button value="direct">直接输入预产期</n-radio-button>
            </n-radio-group>
          </div>

          <div class="form-group">
            <label class="form-label">{{ dueDateMode === 'lmp' ? '末次月经日期' : '预产期' }}</label>
            <n-date-picker
              v-model:formatted-value="primaryDate"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="dueDateMode === 'lmp' ? '请选择末次月经日期' : '请选择预产期'"
              style="width: 100%"
              size="large"
            />
          </div>

          <div class="form-group" v-if="dueDateMode === 'lmp' && calculatedDueDate">
            <label class="form-label">推算预产期</label>
            <span class="due-date-value calculated">{{ calculatedDueDate }}</span>
          </div>

          <div class="form-group">
            <label class="form-label">宝宝昵称</label>
            <n-input v-model:value="babyName" placeholder="可选，给宝贝起个小名" style="width: 100%" size="large" />
          </div>

          <div class="form-actions">
            <n-button type="primary" size="large" @click="savePregnancy" :loading="savingPregnancy">
              {{ pregnancyStore.currentPregnancy ? '更新孕期信息' : '创建孕期档案' }}
            </n-button>
          </div>
        </div>
      </div>

      <!-- 多孕期切换 -->
      <div v-if="allPregnancies.length > 1" class="section">
        <h3>🔄 孕期切换</h3>
        <div
          v-for="p in allPregnancies"
          :key="p.id"
          class="pregnancy-item"
          :class="{ active: p.id === activePregnancyId }"
          @click="switchPregnancy(p.id)"
        >
          <span class="pregnancy-name">{{ p.baby_name || '宝宝' }}</span>
          <span class="pregnancy-due">预产期：{{ p.due_date || '未设置' }}</span>
          <n-tag v-if="p.is_active" size="small" type="success">当前</n-tag>
        </div>
      </div>

      <!-- 提醒管理 -->
      <ReminderSetting v-if="pregnancyStore.isActive" />

      <!-- 数据备份 -->
      <div class="section">
        <h3>💾 数据备份与恢复</h3>

        <div class="setting-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <label>备份目录路径</label>
          <div style="display: flex; gap: 8px;">
            <n-input v-model:value="backupDir" placeholder="点击选择按钮浏览目录" style="flex: 1" clearable />
            <n-button @click="toggleDirBrowser('backup')" :type="showDirBrowser && browsingFor === 'backup' ? 'error' : 'default'">
              {{ showDirBrowser && browsingFor === 'backup' ? '✕ 关闭' : '📁 选择' }}
            </n-button>
            <n-button type="primary" @click="handleBackup" :loading="backingUp" :disabled="backingUp || !backupDir.trim()">备份</n-button>
          </div>

          <div v-if="showDirBrowser && browsingFor === 'backup'" class="dir-browser-inline">
            <div class="db-roots">
              <button
                v-for="r in dirRoots" :key="r.path"
                class="db-root-btn"
                :class="{ active: currentBrowsePath === r.path, readonly: !r.canRW }"
                @click="navigateTo(r.path)"
              >{{ r.name }}<span v-if="!r.canRW" class="db-ro-tag">只读</span></button>
              <span v-if="dirRoots.length === 0 && !dirLoading" class="db-hint">未检测到存储卷，请先在应用设置中添加文件夹权限</span>
            </div>
            <div class="db-path">📂 {{ currentBrowsePath }} <span v-if="currentCanRW !== null" :class="currentCanRW ? 'db-rw-ok' : 'db-rw-no'">{{ currentCanRW ? '✅ 可读写' : '⚠️ 只读' }}</span></div>
            <div v-if="dirLoading" class="db-loading">加载中...</div>
            <div v-else-if="dirItems.length === 0" class="db-empty">此目录为空</div>
            <div v-else class="db-list">
              <div
                v-for="item in dirItems" :key="item.path"
                class="db-item"
                :class="{ ro: !item.canRW }"
                @click="selectDir(item.path)"
                @dblclick="navigateTo(item.path)"
              >📁 {{ item.name }}<span v-if="!item.canRW" class="db-ro-tag">只读</span></div>
            </div>
            <div class="db-bar">
              <button class="db-nav-btn" @click="navigateUp" :disabled="!canNavigateUp">⬆️ 上级</button>
              <button class="db-confirm-btn" @click="confirmDirSelect" :disabled="!selectedDirPath">确定选择此目录</button>
            </div>
          </div>

          <div class="setting-hint">全量备份所有数据（记录、相册、产检、清单、提醒等）+ 照片原图到指定目录</div>
        </div>

        <div class="setting-item" style="flex-direction: column; align-items: stretch; gap: 8px; margin-top: 16px;">
          <label>恢复目录路径</label>
          <div style="display: flex; gap: 8px;">
            <n-input v-model:value="restoreDir" placeholder="点击选择按钮浏览目录" style="flex: 1" clearable />
            <n-button @click="toggleDirBrowser('restore')" :type="showDirBrowser && browsingFor === 'restore' ? 'error' : 'default'">
              {{ showDirBrowser && browsingFor === 'restore' ? '✕ 关闭' : '📁 选择' }}
            </n-button>
            <n-button type="warning" @click="handleRestore" :loading="importing" :disabled="importing || !restoreDir.trim()">恢复</n-button>
          </div>

          <div v-if="showDirBrowser && browsingFor === 'restore'" class="dir-browser-inline">
            <div class="db-roots">
              <button
                v-for="r in dirRoots" :key="r.path"
                class="db-root-btn"
                :class="{ active: currentBrowsePath === r.path, readonly: !r.canRW }"
                @click="navigateTo(r.path)"
              >{{ r.name }}<span v-if="!r.canRW" class="db-ro-tag">只读</span></button>
            </div>
            <div class="db-path">📂 {{ currentBrowsePath }}</div>
            <div v-if="dirLoading" class="db-loading">加载中...</div>
            <div v-else-if="dirItems.length === 0" class="db-empty">此目录为空</div>
            <div v-else class="db-list">
              <div
                v-for="item in dirItems" :key="item.path"
                class="db-item"
                @click="selectDir(item.path)"
                @dblclick="navigateTo(item.path)"
              >📁 {{ item.name }}</div>
            </div>
            <div class="db-bar">
              <button class="db-nav-btn" @click="navigateUp" :disabled="!canNavigateUp">⬆️ 上级</button>
              <button class="db-confirm-btn" @click="confirmDirSelect" :disabled="!selectedDirPath">确定选择此目录</button>
            </div>
          </div>

          <div class="setting-hint">从指定目录恢复全量数据（会覆盖当前数据）</div>
        </div>
        <div v-if="backupResult" class="setting-hint" :style="{ color: backupResult.success ? '#18a058' : '#d03050' }">
          {{ backupResult.message }}
        </div>
      </div>

      <!-- 数据导出 -->
      <div class="section">
        <h3>📊 数据导出</h3>
        <div class="setting-item" style="flex-wrap: wrap; gap: 10px;">
          <n-button type="primary" @click="handleExportCsv" :loading="exportingCsv">
            📋 导出健康记录 CSV
          </n-button>
          <n-button type="info" @click="handleExportDiaryPdf" :loading="exportingDiary">
            📖 导出日记 PDF
          </n-button>
          <n-button @click="handleGeneratePdf" :loading="generatingPdf">
            📄 生成纪念册
          </n-button>
        </div>
        <div class="setting-hint">CSV 包含所有健康指标数据，可用 Excel 打开；日记按日期排版，浏览器打开后可打印为 PDF</div>
      </div>

      <!-- 企业微信推送 -->
      <div class="section wecom-section">
        <h3>💬 企业微信推送</h3>
        <div class="setting-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <label>Webhook URL</label>
          <n-input
            v-model:value="webhookUrl"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="企业微信群机器人 Webhook 地址"
          />
        </div>
        <div style="display: flex; gap: 8px;">
          <n-button type="primary" @click="saveWebhook" :loading="savingWecom">保存</n-button>
          <n-button @click="sendTestMessage" :loading="testingPush">测试发送</n-button>
          <n-button type="warning" quaternary @click="clearWecomConfig">清除</n-button>
        </div>
        <div v-if="wecomConfigured" class="setting-item">
          <label>状态</label>
          <n-tag :type="wecomStatus?.success ? 'success' : 'error'" size="small">{{ wecomStatus?.message || '已配置' }}</n-tag>
        </div>
      </div>

      <!-- 外观 -->
      <div class="section">
        <h3>🎨 外观</h3>
        <div class="setting-item">
          <label>深色模式</label>
          <n-switch :value="isDarkMode" @update:value="toggleDarkMode">
            <template #checked>🌙</template>
            <template #unchecked>☀️</template>
          </n-switch>
        </div>
      </div>

      <!-- 软件日志 -->
      <div class="section">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>📋 软件日志</h3>
          <div style="display:flex; gap:8px;">
            <n-button size="small" @click="loadLogs" :loading="logLoading">刷新</n-button>
            <n-button size="small" @click="clearLogs" type="error" ghost>清空</n-button>
          </div>
        </div>
        <div v-if="logInfo" style="display:flex; gap:12px; margin-bottom:8px; font-size:12px; color:#888;">
          <span>PID: {{ logInfo.pid }}</span>
          <span>运行: {{ formatUptime(logInfo.uptime) }}</span>
          <span>内存: {{ logInfo.memory }}</span>
          <span>Node: {{ logInfo.node_version }}</span>
        </div>
        <div class="log-box">{{ logText || '暂无日志' }}</div>
      </div>

      <!-- 关于 -->
      <div class="section">
        <h3>ℹ️ 关于</h3>
        <div class="setting-item">
          <label>应用</label>
          <span>孕程记 v0.0.8</span>
        </div>
        <div class="setting-item">
          <label>理念</label>
          <span>数据私有 · NAS 本地 · 零上云</span>
        </div>
        <div class="setting-item">
          <label>技术</label>
          <span>Vue 3 + Express + SQLite</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NInput, NButton, NDatePicker, NRadioGroup, NRadioButton, NSwitch, NTag, useMessage } from 'naive-ui'
import dayjs from 'dayjs'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useAppStore } from '@/stores/app'
import { pregnancyApi } from '@/api/pregnancy'
import { exportApi } from '@/api/export'
import client from '@/api/client'
import { wecomApi } from '@/api/wecom'
import ReminderSetting from '@/components/settings/ReminderSetting.vue'

const logText = ref('')
const logInfo = ref<any>(null)
const logLoading = ref(false)

async function loadLogs() {
  logLoading.value = true
  try {
    const res: any = await exportApi.getLogs()
    if (res.code === 0 && res.data) {
      logText.value = res.data.logs || ''
      logInfo.value = res.data
    }
  } catch { logText.value = '加载失败' }
  logLoading.value = false
}

async function clearLogs() {
  try { await exportApi.clearLogs(); logText.value = '' } catch {}
}

function formatUptime(sec: number) {
  if (!sec) return '-'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}时${m}分` : `${m}分${sec % 60}秒`
}

const pregnancyStore = usePregnancyStore()
const appStore = useAppStore()
const message = useMessage()

const dueDateMode = ref<'lmp' | 'direct'>('lmp')
const primaryDate = ref('')
const babyName = ref('')
const savingPregnancy = ref(false)
const backingUp = ref(false)
const importing = ref(false)
const generatingPdf = ref(false)
const exportingCsv = ref(false)
const exportingDiary = ref(false)
const backupDir = ref('')
const restoreDir = ref('')
const backupResult = ref<{ success: boolean; message: string } | null>(null)

const showDirBrowser = ref(false)
const browsingFor = ref<'backup' | 'restore'>('backup')
const currentBrowsePath = ref('/')
const dirRoots = ref<any[]>([])
const dirItems = ref<any[]>([])
const dirLoading = ref(false)
const selectedDirPath = ref('')
const currentCanRW = ref<boolean | null>(null)

const allPregnancies = ref<any[]>([])
const activePregnancyId = ref('')

const webhookUrl = ref('')
const wecomConfigured = ref(false)
const wecomStatus = ref<any>(null)
const savingWecom = ref(false)
const testingPush = ref(false)

const calculatedDueDate = computed(() => {
  if (!primaryDate.value || dueDateMode.value !== 'lmp') return ''
  return dayjs(primaryDate.value).add(280, 'day').format('YYYY-MM-DD')
})

const isDarkMode = computed(() => appStore.currentTheme === 'dark')

const trimesterTagType = computed(() => {
  const t = pregnancyStore.gestationalAge?.trimester
  if (t === '孕早期') return 'warning'
  if (t === '孕中期') return 'info'
  if (t === '孕晚期') return 'error'
  return 'default'
})

watch(isDarkMode, (dark) => {
  document.documentElement.classList.toggle('dark', dark)
}, { immediate: true })

watch(dueDateMode, () => {
  loadDateForMode()
})

function loadDateForMode() {
  const p = pregnancyStore.currentPregnancy
  if (!p) {
    primaryDate.value = ''
    return
  }
  if (dueDateMode.value === 'lmp') {
    primaryDate.value = p.last_period_date || ''
  } else {
    primaryDate.value = p.due_date || ''
  }
}

onMounted(async () => {
  await pregnancyStore.fetchActivePregnancy()
  if (pregnancyStore.currentPregnancy) {
    if (pregnancyStore.currentPregnancy.last_period_date) {
      dueDateMode.value = 'lmp'
    } else if (pregnancyStore.currentPregnancy.due_date) {
      dueDateMode.value = 'direct'
    }
    loadDateForMode()
    babyName.value = pregnancyStore.currentPregnancy.baby_name || ''
  }
  await loadAllPregnancies()
  await loadWecomStatus()
  await loadLogs()
})

async function loadAllPregnancies() {
  try {
    const res: any = await pregnancyApi.list()
    if (res.code === 0) {
      allPregnancies.value = res.data?.items || res.data || []
      const active = allPregnancies.value.find((p: any) => p.is_active)
      if (active) activePregnancyId.value = active.id
    }
  } catch {
    // 忽略
  }
}

async function switchPregnancy(id: string) {
  try {
    await pregnancyApi.activate(id)
    await pregnancyStore.fetchActivePregnancy()
    activePregnancyId.value = id
    if (pregnancyStore.currentPregnancy) {
      primaryDate.value = pregnancyStore.currentPregnancy.last_period_date || ''
      babyName.value = pregnancyStore.currentPregnancy.baby_name || ''
    }
    await loadAllPregnancies()
    message.success('已切换孕期')
  } catch {
    message.error('切换失败')
  }
}

// ========== 孕期管理 ==========
async function savePregnancy() {
  if (dueDateMode.value === 'lmp' && !primaryDate.value && !babyName.value) {
    message.warning('请输入末次月经日期或宝宝昵称')
    return
  }
  if (dueDateMode.value === 'direct' && !primaryDate.value) {
    message.warning('请输入预产期日期')
    return
  }
  savingPregnancy.value = true
  try {
    const payload: any = {}
    if (dueDateMode.value === 'lmp') {
      if (primaryDate.value) payload.last_period_date = primaryDate.value
    } else {
      if (primaryDate.value) payload.due_date = primaryDate.value
    }
    if (babyName.value) payload.baby_name = babyName.value
    if (pregnancyStore.currentPregnancy?.id) {
      await pregnancyApi.update(pregnancyStore.currentPregnancy.id, payload)
      message.success('孕期信息已更新')
    } else {
      await pregnancyApi.create(payload)
      message.success('孕期档案创建成功！')
    }
    await pregnancyStore.fetchActivePregnancy()
    if (pregnancyStore.currentPregnancy) {
      primaryDate.value = pregnancyStore.currentPregnancy.last_period_date || ''
      babyName.value = pregnancyStore.currentPregnancy.baby_name || ''
    }
    await loadAllPregnancies()
  } catch {
    message.error('保存失败，请重试')
  }
  savingPregnancy.value = false
}

// ========== 目录浏览器 ==========
const canNavigateUp = computed(() => currentBrowsePath.value !== '/' && currentBrowsePath.value.length > 1)

function toggleDirBrowser(forWhat: 'backup' | 'restore') {
  if (showDirBrowser.value && browsingFor.value === forWhat) {
    showDirBrowser.value = false
    return
  }
  browsingFor.value = forWhat
  selectedDirPath.value = forWhat === 'backup' ? backupDir.value : restoreDir.value
  dirRoots.value = []
  dirItems.value = []
  dirLoading.value = false
  currentCanRW.value = null
  currentBrowsePath.value = '/'
  showDirBrowser.value = true
  loadDirRoots()
}

async function loadDirRoots() {
  dirLoading.value = true
  try {
    const res: any = await exportApi.browseDir('/')
    if (res.code === 0 && res.data) {
      dirRoots.value = res.data.roots || []
      if (dirRoots.value.length > 0) {
        currentBrowsePath.value = dirRoots.value[0].path
        currentCanRW.value = dirRoots.value[0].canRW || false
        await loadDirItems(currentBrowsePath.value)
      }
    }
  } catch (e) { console.error('loadDirRoots:', e); dirRoots.value = [] }
  dirLoading.value = false
}

async function navigateTo(dirPath: string) {
  if (!dirPath) return
  currentBrowsePath.value = dirPath
  selectedDirPath.value = dirPath
  const root = dirRoots.value.find((r: any) => r.path === dirPath || dirPath.startsWith(r.path))
  currentCanRW.value = root ? root.canRW : null
  await loadDirItems(dirPath)
}

async function loadDirItems(dirPath: string) {
  dirLoading.value = true
  try {
    const res: any = await exportApi.browseDir(dirPath)
    if (res.code === 0 && res.data) {
      dirItems.value = res.data.items || []
      if (res.data.canRW !== undefined) currentCanRW.value = res.data.canRW
      if (!dirRoots.value.length && res.data.roots) dirRoots.value = res.data.roots
    }
  } catch (e) { console.error('loadDirItems:', e); dirItems.value = [] }
  dirLoading.value = false
}

function navigateUp() {
  const parts = currentBrowsePath.value.split('/').filter(Boolean)
  parts.pop()
  navigateTo('/' + parts.join('/') || '/')
}

function selectDir(path: string) { selectedDirPath.value = path }

function confirmDirSelect() {
  if (browsingFor.value === 'backup') backupDir.value = selectedDirPath.value
  else restoreDir.value = selectedDirPath.value
  showDirBrowser.value = false
}

// ========== 数据管理 ==========
async function handleBackup() {
  if (!backupDir.value.trim()) { message.warning('请输入备份目录路径'); return }
  backingUp.value = true
  backupResult.value = null
  try {
    const res: any = await exportApi.backup(backupDir.value.trim())
    if (res.code === 0) {
      backupResult.value = { success: true, message: res.message || '备份成功' }
      message.success('备份成功')
    } else {
      backupResult.value = { success: false, message: res.message || '备份失败' }
      message.error('备份失败: ' + (res.message || ''))
    }
  } catch (e: any) {
    backupResult.value = { success: false, message: '备份失败: ' + (e?.message || '') }
    message.error('备份失败')
  }
  backingUp.value = false
}

async function handleRestore() {
  if (!restoreDir.value.trim()) { message.warning('请输入恢复目录路径'); return }
  if (!confirm('确定要恢复吗？当前数据将被覆盖（建议先备份）')) return
  importing.value = true
  backupResult.value = null
  try {
    const res: any = await exportApi.restore(restoreDir.value.trim())
    if (res.code === 0) {
      backupResult.value = { success: true, message: res.message || '恢复成功' }
      message.success('恢复成功')
    } else {
      backupResult.value = { success: false, message: res.message || '恢复失败' }
      message.error('恢复失败: ' + (res.message || ''))
    }
  } catch (e: any) {
    backupResult.value = { success: false, message: '恢复失败: ' + (e?.message || '') }
    message.error('恢复失败')
  }
  importing.value = false
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function handleExportCsv() {
  exportingCsv.value = true
  try {
    const pregnancyId = pregnancyStore.currentPregnancy?.id
    const res: any = await exportApi.exportCsv({ pregnancy_id: pregnancyId })
    if (res.data) {
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
      downloadBlob(blob, `孕程记_健康记录_${new Date().toISOString().slice(0, 10)}.csv`)
      message.success('CSV 导出成功')
    } else {
      message.warning(res.message || '没有可导出的数据')
    }
  } catch (e: any) {
    message.error('导出失败')
  }
  exportingCsv.value = false
}

async function handleExportDiaryPdf() {
  exportingDiary.value = true
  try {
    const pregnancyId = pregnancyStore.currentPregnancy?.id
    const res: any = await exportApi.exportDiaryPdf({ pregnancy_id: pregnancyId })
    if (res.data) {
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/html' })
      downloadBlob(blob, `孕程记_日记_${new Date().toISOString().slice(0, 10)}.html`)
      message.success('日记导出成功，浏览器打开后可打印为 PDF')
    } else {
      message.warning(res.message || '没有可导出的日记内容')
    }
  } catch (e: any) {
    message.error('导出失败')
  }
  exportingDiary.value = false
}

async function handleGeneratePdf() {
  if (!pregnancyStore.currentPregnancy) {
    message.warning('请先创建孕期档案')
    return
  }
  generatingPdf.value = true
  try {
    const res: any = await exportApi.generatePdf(pregnancyStore.currentPregnancy.id)
    if (res.code === 0 && res.data?.task_id) {
      message.success('PDF 生成成功，开始下载...')
      window.open(`${(client as any).defaults.baseURL}/pdf/download/${res.data.task_id}`, '_blank')
    } else {
      message.error('生成失败' + (res.message ? ': ' + res.message : ''))
    }
  } catch {
    message.error('生成失败，请重试')
  }
  generatingPdf.value = false
}

// ========== 企业微信 ==========
async function loadWecomStatus() {
  try {
    const configRes: any = await wecomApi.getConfig()
    wecomConfigured.value = configRes?.data?.configured || false
    if (wecomConfigured.value) {
      const statusRes: any = await wecomApi.getStatus()
      wecomStatus.value = statusRes?.data?.status
      webhookUrl.value = ''
    }
  } catch {
    // 忽略
  }
}

async function saveWebhook() {
  if (!webhookUrl.value.trim()) {
    message.warning('请输入 Webhook URL')
    return
  }
  savingWecom.value = true
  try {
    const res: any = await wecomApi.saveConfig(webhookUrl.value.trim())
    message.success(res.code === 0 ? '保存成功' : res.message || '已保存')
    wecomConfigured.value = true
    await loadWecomStatus()
  } catch (e: any) {
    message.error('保存失败: ' + e?.message)
  }
  savingWecom.value = false
}

async function sendTestMessage() {
  testingPush.value = true
  try {
    const res: any = await wecomApi.sendTest()
    if (res.code === 0) {
      message.success(res.message || '测试消息已发送到群聊！请在企业微信查看')
    } else {
      message.error(res.message || '发送失败')
    }
  } catch (e: any) {
    message.error('发送失败: ' + e?.message)
  }
  testingPush.value = false
}

async function clearWecomConfig() {
  try {
    await wecomApi.saveConfig('')
    wecomConfigured.value = false
    wecomStatus.value = null
    webhookUrl.value = ''
    message.info('已清除企业微信配置')
  } catch {
    message.error('操作失败')
  }
}

// ========== 外观 ==========
function toggleDarkMode(dark: boolean) {
  appStore.currentTheme = dark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', dark)
}
</script>

<style scoped>
.settings-view { max-width: 600px; margin: 0 auto; padding: 16px; }
.section { background: var(--bg-card, white); border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.section h3 { margin-bottom: 16px; font-size: 16px; }
.setting-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color, #e2e8f0); }
.setting-item:last-child { border-bottom: none; }
.setting-item label { min-width: 72px; color: var(--text-secondary, #64748b); font-size: 14px; flex-shrink: 0; }
.setting-hint { font-size: 12px; color: var(--text-hint, #94a3b8); padding: 4px 0 0 84px; margin-top: 4px; }
.due-date-value { color: var(--primary-color, #e8a0bf); font-weight: 600; }
.due-date-value.calculated { font-size: 16px; }
.gestational-info { font-weight: 600; }
.mode-switcher { flex-direction: column; align-items: stretch; gap: 8px; }
.mode-switcher label { min-width: auto; }

.pregnancy-status {
  background: var(--bg-secondary, #f8f9fa);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.status-row { display: flex; gap: 24px; flex-wrap: wrap; }
.status-item { display: flex; flex-direction: column; gap: 4px; }
.status-label { font-size: 12px; color: var(--text-hint, #94a3b8); }

.pregnancy-form { display: flex; flex-direction: column; gap: 16px; }
.form-group { display: flex; flex-direction: column; gap: 8px; }
.form-label { font-size: 14px; font-weight: 600; color: var(--text-secondary, #64748b); }
.form-actions { padding-top: 8px; }

.pregnancy-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border-radius: 8px; cursor: pointer; transition: background-color 0.2s, border-color 0.2s;
  border: 2px solid transparent; margin-bottom: 4px;
}
.pregnancy-item:hover { background: rgba(232,160,191,0.05); }
.pregnancy-item.active { border-color: var(--primary-color, #e8a0bf); background: rgba(232,160,191,0.1); }
.log-box {
  background: #1e1e2e;
  color: #a6e3a1;
  border-radius: 8px;
  padding: 12px;
  font-family: "Cascadia Code", "Fira Code", monospace;
  font-size: 11px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.pregnancy-name { font-weight: 600; }
.pregnancy-due { color: var(--text-secondary, #64748b); font-size: 13px; flex: 1; }

.wecom-section { border-left: 4px solid #07c160; }

.dir-browser-inline {
  border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;
  background: #fafbfc; margin-top: 6px;
}
.db-roots {
  display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px;
  background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
}
.db-root-btn {
  padding: 4px 12px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: white; cursor: pointer; font-size: 13px; transition: all 0.15s;
}
.db-root-btn:hover { border-color: #3b82f6; color: #3b82f6; }
.db-root-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
.db-root-btn.readonly { opacity: 0.6; }
.db-hint { font-size: 12px; color: #ef4444; padding: 4px 0; }
.db-ro-tag {
  font-size: 10px; padding: 1px 5px; background: #fef3c7; color: #d97706;
  border-radius: 4px; margin-left: 4px;
}
.db-path {
  padding: 7px 12px; font-size: 13px; color: #475569;
  border-bottom: 1px solid #e2e8f0; background: white;
}
.db-rw-ok { color: #16a34a; font-weight: 600; }
.db-rw-no { color: #dc2626; font-weight: 600; }
.db-loading, .db-empty {
  padding: 24px; text-align: center; color: #94a3b8; font-size: 13px;
}
.db-list { max-height: 200px; overflow-y: auto; }
.db-item {
  padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 6px;
  font-size: 13.5px; border-bottom: 1px solid #f1f5f9; transition: background 0.15s;
}
.db-item:hover { background: #eff6ff; }
.db-item.ro { opacity: 0.55; }
.db-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-top: 1px solid #e2e8f0; background: #f8fafc;
}
.db-nav-btn {
  padding: 5px 14px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: white; cursor: pointer; font-size: 12.5px;
}
.db-nav-btn:hover:not(:disabled) { background: #f1f5f9; }
.db-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.db-confirm-btn {
  padding: 5px 16px; border: none; border-radius: 6px;
  background: #2563eb; color: white; cursor: pointer; font-size: 12.5px; font-weight: 600;
}
.db-confirm-btn:hover:not(:disabled) { background: #1d4ed8; }
.db-confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
