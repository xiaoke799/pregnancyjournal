<template>
  <div class="checkup-schedule-view">
    <!-- 顶部摘要区 -->
    <div class="summary-section" :style="summaryStyle">
      <div class="summary-content">
        <div class="summary-stats">
          <div class="stat-item">
            <div class="stat-value">{{ completedCount }}/{{ totalCount }}</div>
            <div class="stat-label">已完成产检</div>
          </div>
          <div class="stat-progress">
            <div class="progress-bar-wrapper">
              <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-text">{{ progressPercent }}%</div>
          </div>
        </div>
        <div v-if="nextCheckup" class="next-checkup">
          <div class="next-label">🕐 下一次产检</div>
          <div class="next-name">{{ nextCheckup.name }}（孕{{ nextCheckup.week_range || '--' }}周）</div>
        </div>
      </div>
    </div>

    <!-- 当前推荐高亮 -->
    <div v-if="currentCheckup" class="current-recommend" @click="scrollToCurrent">
      ⭐ 本次推荐: {{ currentCheckup.name }}（孕{{ currentCheckup.week_range }}周）→
    </div>

    <!-- 操作栏 -->
    <div class="action-bar">
      <span class="action-bar-title">产检列表</span>
      <n-button type="primary" size="small" @click="showAddDialog = true">+ 添加自定义</n-button>
    </div>

    <!-- 产检列表 -->
    <div class="checkup-list">
      <div
        v-for="item in mergedList"
        :key="item._key"
        :ref="(el) => { if (item.id === currentCheckupId) currentEl = el as HTMLElement }"
        class="checkup-card"
        :class="{
          'is-completed': item.is_completed,
          'is-current': item.id === currentCheckupId && item._type === 'standard',
          'is-mandatory': item.is_mandatory,
          'is-custom': item._type === 'custom',
        }"
      >
        <div class="card-header">
          <div class="card-left">
            <span v-if="item._type === 'standard' && item.week_range" class="week-badge">孕{{ item.week_range }}周</span>
            <span v-else class="week-badge">自定义</span>
            <span class="checkup-name">{{ item.name }}</span>
            <n-tag v-if="item._type === 'standard' && item.is_recommended !== false" size="tiny" type="warning" :bordered="false">⭐ 推荐</n-tag>
            <n-tag v-if="item._type === 'custom'" size="tiny" type="info" :bordered="false">自定义</n-tag>
          </div>
          <div class="card-right">
            <!-- 产检日期 -->
            <input
              type="date"
              class="date-input-small"
              :value="scheduleDates[item._type === 'custom' ? item.id : item.id] || ''"
              @change="(e) => onDateChange(item, (e.target as HTMLInputElement).value)"
              @click.stop
            />
            <n-tag v-if="item.is_mandatory" size="small" type="error" :bordered="false">必检</n-tag>
            <n-tag v-else-if="item._type === 'standard'" size="small" type="default" :bordered="false">选检</n-tag>
            <span v-if="item.is_completed" class="completed-mark">✅</span>
            <n-button
              v-if="item._type === 'custom'"
              size="tiny"
              quaternary
              type="error"
              @click="deleteCustom(item.id)"
            >🗑</n-button>
          </div>
        </div>

        <!-- 有子项的产检（标准或自定义）：子项分行 + 独立上传 -->
        <div v-if="item.items?.length" class="sub-items-section">
          <div v-for="(subItem, idx) in item.items" :key="idx" class="sub-item-row" :class="{ collapsed: isSubItemCollapsed(item, subItem) }">
            <div class="sub-item-header" @click="toggleSubItemCollapse(item, subItem)">
              <span class="sub-item-name">{{ subItem }}</span>
              <span class="sub-item-cat-tag" :class="'cat-' + autoCategory(subItem)">{{ autoCategoryLabel(subItem) }}</span>
              <span v-if="getSubItemReportCount(item, subItem)" class="sub-item-count">{{ getSubItemReportCount(item, subItem) }}份</span>
              <span class="sub-item-fold">{{ isSubItemCollapsed(item, subItem) ? '▸' : '▾' }}</span>
              <label class="sub-item-upload-btn" @click.stop>
                <input type="file" accept="image/*,.pdf" style="display:none" @change="(e) => handleSubItemUpload(e, item, subItem)" />
                <span>📎 上传</span>
              </label>
              <span class="sub-item-nas-btn" @click.stop="handleSubItemNasSelect(item, subItem)">🖥</span>
            </div>
            <div v-if="!isSubItemCollapsed(item, subItem) && getSubItemReports(item, subItem).length" class="sub-item-reports">
              <div v-for="r in getSubItemReports(item, subItem)" :key="r.id" class="report-thumb-sm" @click="openReport(r)">
                <template v-if="r.file_type === 'image'">
                  <img :src="getReportUrl(r.id)" class="report-img-sm" />
                </template>
                <template v-else>
                  <div class="report-pdf-sm">📄<span class="pdf-label-sm">{{ r.filename }}</span></div>
                </template>
                <button class="report-del-sm" @click.stop="deleteReport(r, item)">✕</button>
              </div>
            </div>
          </div>
          <!-- 未分类报告（旧数据兼容） -->
          <div v-if="getUncategorizedReports(item).length" class="sub-item-row" :class="{ collapsed: isSubItemCollapsed(item, '__uncategorized__') }">
            <div class="sub-item-header" @click="toggleSubItemCollapse(item, '__uncategorized__')">
              <span class="sub-item-name">其他报告</span>
              <span class="sub-item-count">{{ getUncategorizedReports(item).length }}份</span>
              <span class="sub-item-fold">{{ isSubItemCollapsed(item, '__uncategorized__') ? '▸' : '▾' }}</span>
            </div>
            <div v-if="!isSubItemCollapsed(item, '__uncategorized__')" class="sub-item-reports">
              <div v-for="r in getUncategorizedReports(item)" :key="r.id" class="report-thumb-sm" @click="openReport(r)">
                <template v-if="r.file_type === 'image'">
                  <img :src="getReportUrl(r.id)" class="report-img-sm" />
                </template>
                <template v-else>
                  <div class="report-pdf-sm">📄<span class="pdf-label-sm">{{ r.filename }}</span></div>
                </template>
                <button class="report-del-sm" @click.stop="deleteReport(r, item)">✕</button>
              </div>
            </div>
          </div>
          <div v-if="getItemReportCount(item) === 0" class="sub-items-empty">暂无报告，点击子项旁的📎上传</div>
        </div>

        <!-- 自定义产检 / 无子项的标准产检：保持原有上传方式 -->
        <div v-else class="report-section">
          <div class="report-header">
            <span class="report-label">📎 报告 ({{ getItemReportCount(item) }})</span>
          </div>
          <div class="category-tabs">
            <button v-for="cat in allCategories" :key="cat.value" class="cat-tab" :class="{ active: activeCategory[item._key] === cat.value }" @click="activeCategory[item._key] = cat.value">
              {{ cat.label }}
              <span class="cat-count" v-if="getCategoryCount(item, cat.value)">{{ getCategoryCount(item, cat.value) }}</span>
            </button>
          </div>
          <div class="upload-bar">
            <label class="report-upload-btn">
              <input type="file" accept="image/*,.pdf" style="display:none" @change="(e) => handleReportUpload(e, item)" />
              <span>📱 本地上传</span>
            </label>
            <span class="upload-link nas-upload" @click.stop="openNasBrowser(item)">🖥 NAS选择</span>
            <span class="current-cat-hint">当前: {{ getCurrentCatLabel(item) }}</span>
          </div>
          <div class="report-grid" v-if="filteredReports(item).length">
            <div v-for="r in filteredReports(item)" :key="r.id" class="report-thumb" @click="openReport(r)">
              <span class="thumb-cat-tag">{{ r.report_category || '其他' }}</span>
              <template v-if="r.file_type === 'image'">
                <img :src="getReportUrl(r.id)" :alt="r.filename" class="report-img" />
              </template>
              <template v-else>
                <div class="report-pdf-icon"><span class="pdf-icon">📄</span><span class="pdf-name">{{ r.filename }}</span></div>
              </template>
              <button class="report-delete-btn" @click.stop="deleteReport(r, item)">✕</button>
            </div>
          </div>
          <div v-else class="report-empty">暂无报告，点击上方上传</div>
        </div>

        <div class="card-footer">
          <n-button
            v-if="!item.is_completed"
            size="small"
            type="primary"
            ghost
            @click="markComplete(item)"
          >
            标记完成
          </n-button>
          <span v-else class="completed-text">已完成</span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="mergedList.length === 0 && !loading" class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无产检时间表数据</div>
    </div>

    <!-- 添加自定义产检对话框 -->
    <n-modal v-model:show="showAddDialog" preset="card" title="添加自定义产检" style="max-width: 440px">
      <n-form label-placement="left" label-width="80">
        <n-form-item label="检查名称" required>
          <n-input v-model:value="customForm.name" placeholder="如：额外B超、专项复查" />
        </n-form-item>
        <n-form-item label="检查子项">
          <div class="custom-items-editor">
            <div v-for="(item, idx) in customForm.items" :key="idx" class="custom-item-row">
              <n-input v-model:value="customForm.items[idx]" placeholder="如：B超、血常规" size="small" style="flex:1" />
              <span class="custom-item-del" @click="customForm.items.splice(idx, 1)">✕</span>
            </div>
            <n-button size="tiny" quaternary type="primary" @click="customForm.items.push('')">+ 添加子项</n-button>
            <div class="custom-items-hint">添加后每个子项可独立上传分类报告</div>
          </div>
        </n-form-item>
        <n-form-item label="计划日期">
          <n-date-picker v-model:formatted-value="customForm.checkup_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="customForm.notes" type="textarea" placeholder="检查备注（选填）" :rows="2" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showAddDialog = false">取消</n-button>
        <n-button type="primary" @click="handleAddCustom">添加</n-button>
      </template>
    </n-modal>

    <!-- NAS 文件浏览器 -->
    <n-modal v-model:show="showNasBrowser" preset="card" title="从NAS选择文件" style="max-width: 600px; height: 70vh">
      <div class="nas-browser">
        <div class="nas-breadcrumb">
          <n-button size="tiny" quaternary @click="nasGoUp" :disabled="!nasParent">⬆ 上层</n-button>
          <span class="nas-current-path">{{ nasCurrentPath }}</span>
        </div>
        <div v-if="nasLoading" class="nas-loading">加载中...</div>
        <div v-else class="nas-file-list">
          <div
            v-for="entry in nasEntries"
            :key="entry.path"
            class="nas-entry"
            :class="{ 'is-dir': entry.type === 'dir', 'is-file': entry.type === 'file' }"
            @click="entry.type === 'dir' ? nasNavigate(entry.path) : nasSelectFile(entry)"
          >
            <span class="nas-entry-icon">{{ entry.type === 'dir' ? '📁' : '📄' }}</span>
            <span class="nas-entry-name">{{ entry.name }}</span>
            <span v-if="entry.type === 'file'" class="nas-entry-size">{{ formatSize(entry.size) }}</span>
          </div>
          <div v-if="nasEntries.length === 0 && !nasLoading" class="nas-empty">此目录为空</div>
        </div>
      </div>
      <template #action>
        <n-button @click="showNasBrowser = false">取消</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { NTag, NButton, NModal, NForm, NFormItem, NInput, NSelect, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { getCheckupSchedule, markCheckupCompleted } from '@/api/checkup-schedule'
import { checkupApi } from '@/api/checkup'
import dayjs from 'dayjs'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

// ... interfaces (same as before)
interface MergedItem {
  _key: string
  _type: 'standard' | 'custom'
  id: string
  name: string
  week_range?: string
  week_start?: number
  week_end?: number
  checkup_date?: string | null
  items?: string[]
  is_mandatory?: boolean
  description?: string
  notes?: string | null
  is_completed: boolean | number
  is_recommended?: boolean
}

interface ReportItem {
  id: string
  checkup_id: string
  checkup_type: string
  filename: string
  file_path: string
  file_type: string
  file_size: number
  report_category: string
  sub_item?: string
  created_at: string
}

interface NasEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  mtime: number
}

const schedule = ref<any[]>([])
const customCheckups = ref<any[]>([])
const reportMap = ref<Record<string, ReportItem[]>>({})
const loading = ref(false)
const currentEl = ref<HTMLElement | null>(null)
const showAddDialog = ref(false)
const customForm = ref({ name: '', items: [] as string[], checkup_date: '', notes: '' })
const scheduleDates = ref<Record<string, string>>({})
const collapsedItems = ref<Record<string, boolean>>({})
const uploadCategory = ref<Record<string, string>>({})
const activeCategory = ref<Record<string, string>>({})

// 分类标签（含"全部"）
const allCategories = [
  { label: '全部', value: '_all_' },
  { label: 'B超', value: 'b超' },
  { label: '血检', value: '血检' },
  { label: '尿检', value: '尿检' },
  { label: '血压', value: '血压' },
  { label: '血糖', value: '血糖' },
  { label: '胎心', value: '胎心' },
  { label: '其他', value: '其他' },
]

// NAS browser state
const showNasBrowser = ref(false)
const nasLoading = ref(false)
const nasCurrentPath = ref('/')
const nasParent = ref<string | null>(null)
const nasEntries = ref<NasEntry[]>([])
const nasTargetItem = ref<MergedItem | null>(null)
const nasTargetSubItem = ref<string | null>(null)

const categoryOptions = [
  { label: 'B超', value: 'b超' },
  { label: '血检', value: '血检' },
  { label: '尿检', value: '尿检' },
  { label: '血压', value: '血压' },
  { label: '血糖', value: '血糖' },
  { label: '胎心', value: '胎心' },
  { label: '其他', value: '其他' },
]

// ... computed properties (same)
const currentWeek = computed(() => pregnancyStore.gestationalAge?.weeks ?? 0)

const mergedList = computed<MergedItem[]>(() => {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  function dateToWeek(dateStr?: string | null): number | undefined {
    if (!dateStr || !lmp) return undefined
    const totalDays = dayjs(dateStr).diff(dayjs(lmp), 'day')
    return totalDays >= 0 ? Math.floor(totalDays / 7) : undefined
  }
  const standard: MergedItem[] = schedule.value.map(s => ({
    _key: `std_${s.id}`, _type: 'standard' as const, id: s.id, name: s.name,
    week_range: s.week_range, week_start: s.week_start, week_end: s.week_end,
    items: s.items, is_mandatory: s.is_mandatory, description: s.description,
    is_completed: s.is_completed, is_recommended: s.is_recommended ?? true,
  }))
  const custom: MergedItem[] = customCheckups.value.map(c => {
    const weekStart = dateToWeek(c.checkup_date)
    let subItems: string[] | undefined
    if (Array.isArray(c.items)) subItems = c.items
    else if (typeof c.items === 'string') { try { subItems = JSON.parse(c.items) } catch { subItems = undefined } }
    return {
      _key: `cst_${c.id}`, _type: 'custom' as const, id: c.id, name: c.name,
      week_start: weekStart, checkup_date: c.checkup_date, notes: c.notes,
      items: subItems, is_completed: c.is_completed === 1,
    }
  })
  const all = [...standard, ...custom]
  all.sort((a, b) => {
    const aWeek = a.week_start ?? 999
    const bWeek = b.week_start ?? 999
    if (aWeek !== bWeek) return aWeek - bWeek
    if (a._type !== b._type) return a._type === 'standard' ? -1 : 1
    const aDate = a.checkup_date || ''
    const bDate = b.checkup_date || ''
    return aDate.localeCompare(bDate)
  })
  return all
})

const currentCheckupId = computed(() => {
  const week = currentWeek.value
  for (const item of schedule.value) {
    if (week >= item.week_start && week <= item.week_end) return item.id
  }
  return ''
})

const currentCheckup = computed(() => {
  if (!currentCheckupId.value) return null
  return schedule.value.find((s: any) => s.id === currentCheckupId.value) || null
})

const completedCount = computed(() => mergedList.value.filter(s => s.is_completed).length)
const totalCount = computed(() => mergedList.value.length)
const progressPercent = computed(() => totalCount.value === 0 ? 0 : Math.round((completedCount.value / totalCount.value) * 100))

const nextCheckup = computed(() => {
  const week = currentWeek.value
  const upcoming = mergedList.value.filter(s => !s.is_completed && ((s.week_start ?? 999) >= week))
  if (upcoming.length > 0) return upcoming[0]
  return mergedList.value.find(s => !s.is_completed) || null
})

const summaryStyle = computed(() => {
  const stage = pregnancyStore.gestationalAge?.trimester || 'early'
  const bgMap: Record<string, string> = { early: 'var(--stage-early-bg)', mid: 'var(--stage-mid-bg)', late: 'var(--stage-late-bg)' }
  return { background: bgMap[stage] || bgMap.early }
})

// helpers
function getReportUrl(reportId: string) { return checkupApi.getReportDownloadUrl(reportId) }
function getItemReports(item: MergedItem) { return reportMap.value[item._key] || [] }
function getItemReportCount(item: MergedItem) { return getItemReports(item).length }
function getCheckupTypeKey(item: MergedItem): string { return item._type === 'custom' ? 'custom' : 'standard' }
function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// category default (use activeCategory)
function getCategory(item: MergedItem): string {
  const key = item._key
  if (!(key in activeCategory.value)) {
    activeCategory.value[key] = '_all_'
  }
  return activeCategory.value[key] === '_all_' ? '其他' : activeCategory.value[key]
}

// 分类筛选后的报告
function filteredReports(item: MergedItem): ReportItem[] {
  const reports = getItemReports(item) || []
  const cat = activeCategory.value[item._key]
  if (!cat || cat === '_all_') return reports
  return reports.filter(r => r.report_category === cat)
}

function getCategoryCount(item: MergedItem, catValue: string): number {
  if (catValue === '_all_') return getItemReports(item).length
  return getItemReports(item).filter(r => r.report_category === catValue).length
}

function getCurrentCatLabel(item: MergedItem): string {
  const cat = activeCategory.value[item._key] || '全部'
  const found = allCategories.find(c => c.value === cat)
  return found?.label || cat
}

function autoCategory(itemName: string): string {
  if (/B超|超声|NT|排畸|系统超声/i.test(itemName)) return 'b超'
  if (/血常规|血型|肝肾|乙肝|梅毒|HIV|唐氏|唐筛|DNA|糖耐|OGTT|凝血|GBS|链球菌|甲状腺/i.test(itemName)) return '血检'
  if (/尿常规/i.test(itemName)) return '尿检'
  if (/血压|体重|宫高|腹围/i.test(itemName)) return '血压'
  if (/血糖/i.test(itemName)) return '血糖'
  if (/胎心|胎监/i.test(itemName)) return '胎心'
  if (/骨盆|心电图|宫颈/i.test(itemName)) return '其他'
  return '其他'
}

function autoCategoryLabel(itemName: string): string {
  const map: Record<string, string> = { 'b超': 'B超', '血检': '血检', '尿检': '尿检', '血压': '血压/体重', '血糖': '血糖', '胎心': '胎心', '其他': '其他' }
  return map[autoCategory(itemName)] || '其他'
}

function subItemKey(item: MergedItem, subItem: string): string {
  return `${item._key}::${subItem}`
}

function isSubItemCollapsed(item: MergedItem, subItem: string): boolean {
  return !!collapsedItems.value[subItemKey(item, subItem)]
}

function toggleSubItemCollapse(item: MergedItem, subItem: string) {
  const key = subItemKey(item, subItem)
  collapsedItems.value[key] = !collapsedItems.value[key]
}

function getSubItemReports(item: MergedItem, subItem: string): ReportItem[] {
  return getItemReports(item).filter(r => r.sub_item === subItem)
}

function getSubItemReportCount(item: MergedItem, subItem: string): number {
  return getSubItemReports(item, subItem).length
}

function getUncategorizedReports(item: MergedItem): ReportItem[] {
  return getItemReports(item).filter(r => !r.sub_item)
}

async function handleSubItemUpload(e: Event, item: MergedItem, subItem: string) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    const category = autoCategory(subItem)
    await checkupApi.uploadReport(item.id, file, getCheckupTypeKey(item), category, subItem)
    await loadReportsForItem(item)
    target.value = ''
    message.success('上传成功')
  } catch { message.error('上传失败') }
}

async function handleSubItemNasSelect(item: MergedItem, subItem: string) {
  nasTargetItem.value = item
  nasTargetSubItem.value = subItem
  showNasBrowser.value = true
  await nasNavigate('/')
}

// date change
async function onDateChange(item: MergedItem, dateStr: string) {
  if (!dateStr || !pregnancyStore.currentPregnancy) return
  const scheduleId = item._type === 'standard' ? item.id : item.id
  try {
    await checkupApi.setScheduleDate(pregnancyStore.currentPregnancy.id, scheduleId, dateStr)
    scheduleDates.value[scheduleId] = dateStr
  } catch {
    message.error('设置日期失败')
  }
}

function scrollToCurrent() {
  if (currentEl.value) currentEl.value.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function markComplete(item: MergedItem) {
  if (!pregnancyStore.currentPregnancy) { message.warning('请先设置孕期信息'); return }
  try {
    if (item._type === 'custom') {
      await checkupApi.markCustomComplete(item.id)
    } else {
      await markCheckupCompleted(item.id, pregnancyStore.currentPregnancy.id)
    }
    message.success('已标记完成')
    await loadAll()
  } catch { message.error('操作失败，请重试') }
}

async function handleAddCustom() {
  if (!pregnancyStore.currentPregnancy || !customForm.value.name.trim()) { message.warning('请输入检查名称'); return }
  try {
    const filteredItems = customForm.value.items.filter(i => i.trim())
    await checkupApi.createCustom({
      pregnancy_id: pregnancyStore.currentPregnancy.id,
      name: customForm.value.name.trim(),
      items: filteredItems.length ? filteredItems : undefined,
      checkup_date: customForm.value.checkup_date || undefined,
      notes: customForm.value.notes || undefined,
    })
    message.success('添加成功')
    showAddDialog.value = false
    customForm.value = { name: '', items: [], checkup_date: '', notes: '' }
    await loadAll()
  } catch { message.error('添加失败，请重试') }
}

async function deleteCustom(id: string) {
  try { await checkupApi.deleteCustom(id); message.success('已删除'); await loadAll() } catch { message.error('删除失败') }
}

async function handleReportUpload(e: Event, item: MergedItem) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    await checkupApi.uploadReport(item.id, file, getCheckupTypeKey(item), getCategory(item))
    await loadReportsForItem(item)
    target.value = ''
    message.success('上传成功')
  } catch { message.error('上传失败') }
}

function openReport(report: ReportItem) {
  window.open(checkupApi.getReportDownloadUrl(report.id), '_blank')
}

async function deleteReport(report: ReportItem, item: MergedItem) {
  try { await checkupApi.deleteReport(report.id); message.success('已删除'); await loadReportsForItem(item) } catch { message.error('删除失败') }
}

async function loadReportsForItem(item: MergedItem) {
  try {
    const res: any = await checkupApi.listReports(item.id, getCheckupTypeKey(item))
    reportMap.value[item._key] = res?.data || []
  } catch { reportMap.value[item._key] = [] }
}

// NAS browser
async function openNasBrowser(item: MergedItem) {
  nasTargetItem.value = item
  showNasBrowser.value = true
  await nasNavigate('/')
}

async function nasNavigate(path: string) {
  nasLoading.value = true
  try {
    const res: any = await checkupApi.browseNasFiles(path)
    if (res.code === 0 && res.data) {
      nasCurrentPath.value = res.data.path
      nasParent.value = res.data.parent
      nasEntries.value = res.data.entries || []
    }
  } catch { message.error('浏览失败') }
  nasLoading.value = false
}

function nasGoUp() {
  if (nasParent.value) nasNavigate(nasParent.value)
}

async function nasSelectFile(entry: NasEntry) {
  if (!nasTargetItem.value || !pregnancyStore.currentPregnancy) return
  try {
    const item = nasTargetItem.value
    const subItem = nasTargetSubItem.value || undefined
    const category = subItem ? autoCategory(subItem) : getCategory(item)
    await checkupApi.uploadReportFromNas(item.id, entry.path, getCheckupTypeKey(item), category, subItem)
    message.success('已从NAS添加报告')
    showNasBrowser.value = false
    nasTargetSubItem.value = null
    await loadReportsForItem(item)
  } catch { message.error('添加失败') }
}

async function loadScheduleDates() {
  if (!pregnancyStore.currentPregnancy) return
  try {
    const res: any = await checkupApi.getScheduleDates(pregnancyStore.currentPregnancy.id)
    if (res.code === 0 && res.data) {
      scheduleDates.value = res.data
    }
  } catch { /* ignore */ }
}

async function loadAll() {
  loading.value = true
  try {
    const pid = pregnancyStore.currentPregnancy?.id
    const [scheduleRes, customRes] = await Promise.allSettled([
      getCheckupSchedule(pid),
      pid ? checkupApi.listCustom(pid) : Promise.resolve({ data: [] }),
    ])
    schedule.value = scheduleRes.status === 'fulfilled' ? ((scheduleRes.value as any)?.data || []) : []
    customCheckups.value = customRes.status === 'fulfilled' ? ((customRes.value as any)?.data || []) : []

    await loadScheduleDates()

    const reportPromises: Promise<void>[] = []
    const newReportMap: Record<string, ReportItem[]> = {}
    for (const item of mergedList.value) {
      reportPromises.push((async () => {
        const res: any = await checkupApi.listReports(item.id, getCheckupTypeKey(item)).catch(() => ({ data: [] }))
        newReportMap[item._key] = res?.data || []
      })())
    }
    await Promise.all(reportPromises)
    reportMap.value = newReportMap
  } finally { loading.value = false }
}

onMounted(() => { loadAll() })
watch(() => pregnancyStore.currentPregnancy?.id, (pid) => { if (pid) loadAll() })
</script>

<style scoped>
.checkup-schedule-view { max-width: 800px; margin: 0 auto; padding: 16px; }

.summary-section { border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.04); }
.summary-stats { display: flex; align-items: center; gap: 24px; margin-bottom: 12px; }
.stat-item { display: flex; flex-direction: column; }
.stat-value { font-size: 28px; font-weight: 800; color: var(--text-color, #1e293b); }
.stat-label { font-size: 13px; color: var(--text-secondary, #64748b); }
.stat-progress { flex: 1; display: flex; align-items: center; gap: 12px; }
.progress-bar-wrapper { flex: 1; height: 10px; background: rgba(255,255,255,.6); border-radius: 5px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: linear-gradient(90deg, #66BB6A, #4FC3F7); border-radius: 5px; transition: width .5s; }
.progress-text { font-size: 14px; font-weight: 700; min-width: 40px; }
.next-checkup { padding-top: 12px; border-top: 1px solid rgba(0,0,0,.06); }
.next-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
.next-name { font-size: 16px; font-weight: 600; }

.current-recommend { background: var(--stage-early-bg, #FFF3E0); border: 1px solid var(--stage-early-color, #FFB74D); border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--stage-early-color); }

.action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.action-bar-title { font-size: 16px; font-weight: 700; }

.checkup-list { display: flex; flex-direction: column; gap: 12px; }

.checkup-card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border-left: 4px solid #e2e8f0; }
.checkup-card.is-mandatory { border-left-color: #F06292; }
.checkup-card.is-custom { border-left-color: #4FC3F7; border-left-style: dashed; }
.checkup-card.is-completed { background: #E8F5E9; border-left-color: #66BB6A; }
.checkup-card.is-current { box-shadow: 0 0 0 2px #FFB74D, 0 4px 12px rgba(0,0,0,.08); }

.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.card-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-right { display: flex; align-items: center; gap: 8px; }

.week-badge { background: #E1F5FE; color: #4FC3F7; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; }
.is-custom .week-badge { background: rgba(79,195,247,.12); }
.is-completed .week-badge { background: #E8F5E9; color: #66BB6A; }
.checkup-name { font-size: 15px; font-weight: 700; }
.completed-mark { font-size: 18px; }

.date-input-small {
  padding: 4px 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 13px;
  background: white;
  color: var(--text-color, #1e293b);
  width: 130px;
}

.card-body { margin-bottom: 12px; }
.checkup-items { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.checkup-item-tag { background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 6px; font-size: 12px; color: #64748b; }
.is-completed .checkup-item-tag { background: rgba(102,187,106,.1); border-color: rgba(102,187,106,.3); color: #66BB6A; }
.checkup-desc { font-size: 13px; color: #94a3b8; line-height: 1.6; }

/* 子项分类上传 */
.sub-items-section { margin-bottom: 12px; }
.sub-items-empty { font-size: 12px; color: #94a3b8; text-align: center; padding: 12px 0; }
.sub-item-row { padding: 6px 0; border-bottom: 1px solid #f1f5f9; transition: background .15s; }
.sub-item-row:last-child { border-bottom: none; }
.sub-item-row.collapsed { opacity: .75; }
.sub-item-header {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 4px 0; border-radius: 6px; transition: background .15s;
}
.sub-item-header:hover { background: rgba(0,0,0,.02); }
.sub-item-name { font-size: 13px; font-weight: 500; color: #334155; flex: 1; min-width: 80px; }
.sub-item-cat-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600;
  background: #f1f5f9; color: #64748b; flex-shrink: 0;
}
.sub-item-cat-tag.cat-b超 { background: #E1F5FE; color: #0288D1; }
.sub-item-cat-tag.cat-血检 { background: #FCE4EC; color: #C62828; }
.sub-item-cat-tag.cat-尿检 { background: #FFF3E0; color: #E65100; }
.sub-item-cat-tag.cat-血压 { background: #F3E5F5; color: #7B1FA2; }
.sub-item-cat-tag.cat-血糖 { background: #E8F5E9; color: #2E7D32; }
.sub-item-cat-tag.cat-胎心 { background: #FFF8E1; color: #F57F17; }
.sub-item-count { font-size: 11px; color: var(--primary-color, #e8a0bf); font-weight: 600; flex-shrink: 0; }
.sub-item-fold { font-size: 10px; color: #94a3b8; flex-shrink: 0; transition: transform .2s; }
.sub-item-upload-btn {
  font-size: 11px; color: var(--primary-color, #e8a0bf); cursor: pointer;
  padding: 2px 8px; border: 1px dashed var(--primary-color, #e8a0bf); border-radius: 6px;
  transition: background .2s; white-space: nowrap; flex-shrink: 0;
}
.sub-item-upload-btn:hover { background: rgba(232,160,191,.08); }
.sub-item-nas-btn {
  font-size: 12px; cursor: pointer; padding: 2px 4px; opacity: .6;
  transition: opacity .2s; flex-shrink: 0;
}
.sub-item-nas-btn:hover { opacity: 1; }
.sub-item-reports {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px;
  margin-top: 8px; padding: 8px; background: #fafbfc; border-radius: 8px; border: 1px solid #f1f5f9;
}
.report-thumb-sm {
  position: relative; width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
  cursor: pointer; border: 1px solid #e2e8f0; background: white;
  transition: border-color .15s, transform .15s;
}
.report-thumb-sm:hover { border-color: var(--primary-color, #e8a0bf); transform: scale(1.05); }
.report-img-sm { width: 100%; height: 100%; object-fit: cover; }
.report-pdf-sm { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; font-size: 20px; }
.pdf-label-sm { font-size: 8px; color: #94a3b8; display: block; max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.report-del-sm {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: rgba(255,77,79,.85); color: white;
  border: none; cursor: pointer; font-size: 9px; display: flex;
  align-items: center; justify-content: center; opacity: 0; transition: opacity .15s;
}
.report-thumb-sm:hover .report-del-sm { opacity: 1; }

/* 自定义子项编辑器 */
.custom-items-editor { width: 100%; }
.custom-item-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.custom-item-del {
  width: 20px; height: 20px; border-radius: 50%; background: #fee2e2; color: #ef4444;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  font-size: 11px; flex-shrink: 0; transition: background .15s;
}
.custom-item-del:hover { background: #fecaca; }
.custom-items-hint { font-size: 11px; color: #94a3b8; margin-top: 4px; }

.report-section { margin-bottom: 12px; padding: 12px 14px; background: #f8fafc; border-radius: 10px; }
.report-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.report-label { font-size: 13px; font-weight: 600; color: #64748b; }

/* 分类标签平铺 */
.category-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.cat-tab {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 12px; border: 1px solid #e2e8f0; border-radius: 16px;
  background: white; font-size: 12px; cursor: pointer;
  transition: background-color .2s, border-color .2s, color .2s; color: #64748b; font-weight: 500;
}
.cat-tab:hover { border-color: var(--primary-color); }
.cat-tab.active {
  background: var(--primary-color, #e8a0bf); color: white; border-color: transparent;
}
.cat-count { background: rgba(0,0,0,.1); font-size: 10px; padding: 0 5px; border-radius: 8px; min-width: 16px; text-align: center; }
.cat-tab.active .cat-count { background: rgba(255,255,255,.3); }

/* 上传按钮区 */
.upload-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.upload-link { font-size: 12px; color: var(--primary-color, #e8a0bf); font-weight: 600; cursor: pointer; white-space: nowrap; padding: 5px 12px; border: 1px dashed var(--primary-color, #e8a0bf); border-radius: 8px; transition: background .2s; text-decoration: none; }
.upload-link:hover { background: rgba(232,160,191,.08); }
.nas-upload { color: var(--stage-mid-color, #4FC3F7) !important; border-color: #4FC3F7 !important; }
.nas-upload:hover { background: rgba(79,195,247,.06) !important; }
.current-cat-hint { font-size: 11px; color: #94a3b8; margin-left: auto; }

/* 报告缩略图 */
.report-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.report-thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; cursor: pointer; border: 2px solid transparent; background: white; transition: transform .15s, border-color .15s; }
.report-thumb:hover { transform: scale(1.05); border-color: var(--primary-color, #e8a0bf); }
.report-img { width: 100%; height: 100%; object-fit: cover; }
.report-pdf-icon { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 2px; padding: 4px; }
.pdf-icon { font-size: 28px; }
.pdf-name { font-size: 9px; color: #94a3b8; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 74px; }
.thumb-cat-tag {
  position: absolute; top: 0; left: 0; right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,.55));
  color: white; font-size: 9px; padding: 10px 4px 3px; text-align: center;
  z-index: 1; font-weight: 600;
}
.report-delete-btn { position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(255,77,79,.9); color: white; border: none; cursor: pointer; font-size: 9px; display: flex; align-items: center; justify-content: center; z-index: 2; }
.report-empty { font-size: 12px; color: #94a3b8; text-align: center; padding: 12px 0; }

.card-footer { display: flex; justify-content: flex-end; }
.completed-text { font-size: 13px; color: #66BB6A; font-weight: 600; }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; }
.empty-icon { font-size: 64px; opacity: .5; margin-bottom: 16px; }
.empty-text { font-size: 16px; color: #64748b; }

/* NAS browser */
.nas-browser { display: flex; flex-direction: column; height: 100%; }
.nas-breadcrumb { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; margin-bottom: 8px; }
.nas-current-path { font-size: 13px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nas-file-list { flex: 1; overflow-y: auto; }
.nas-entry { display: flex; align-items: center; gap: 10px; padding: 10px 8px; cursor: pointer; border-radius: 8px; }
.nas-entry:hover { background: #f1f5f9; }
.nas-entry-icon { font-size: 20px; }
.nas-entry-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nas-entry-size { font-size: 12px; color: #94a3b8; }
.nas-empty { text-align: center; padding: 40px; color: #94a3b8; }
.nas-loading { text-align: center; padding: 40px; color: #94a3b8; }

.native-date-input { width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }

@media (max-width: 768px) {
  .checkup-schedule-view { padding: 8px; }
  .summary-section { padding: 16px; border-radius: 12px; }
  .summary-stats { flex-direction: column; align-items: flex-start; gap: 10px; }
  .stat-progress { width: 100%; }
  .stat-value { font-size: 24px; }
  .card-header { flex-direction: column; align-items: flex-start; }
  .card-left { width: 100%; }
  .card-right { width: 100%; justify-content: space-between; }
  .report-section { padding: 10px 8px; }
  .report-header { flex-wrap: wrap; gap: 4px; }

  /* 分类标签移动端 */
  .category-tabs { gap: 4px; margin-bottom: 8px; overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
  .cat-tab { padding: 4px 10px; font-size: 11px; white-space: nowrap; flex-shrink: 0; }

  /* 上传栏 */
  .upload-bar { flex-direction: row; gap: 6px; }
  .upload-link { padding: 4px 10px; font-size: 11px; }
  .current-cat-hint { display: none; }

  /* 报告缩略图 */
  .report-thumb { width: 64px; height: 64px; }
  .pdf-name { max-width: 54px; font-size: 8px; }
  .date-input-small { width: 100px; font-size: 12px; }
  .checkup-card { padding: 12px; }
  .sub-item-name { font-size: 12px; min-width: 60px; }
  .sub-item-reports { gap: 4px; padding: 6px; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); }
}
@media (max-width: 480px) {
  .category-tabs { gap: 3px; }
  .cat-tab { padding: 3px 8px; font-size: 10px; }
  .upload-bar { justify-content: center; }
  .report-thumb { width: 56px; height: 56px; }
}
</style>
