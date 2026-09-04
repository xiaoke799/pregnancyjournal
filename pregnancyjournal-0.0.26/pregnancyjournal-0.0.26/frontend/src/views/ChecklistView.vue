<template>
  <div class="checklist-view">
    <!-- 顶部进度总览（挂钩必备项） -->
    <div class="progress-overview" v-if="checklists.length > 0">
      <div class="overview-stats">
        <div class="stat-num">{{ mandatoryChecked }}/{{ mandatoryTotal }}</div>
        <div class="stat-label">🔥 必备已准备</div>
      </div>
      <div class="overview-bar">
        <div class="bar-fill" :style="{ width: mandatoryPercent + '%' }"></div>
      </div>
      <span class="overview-pct">{{ mandatoryPercent }}%</span>
    </div>
    <div class="progress-sub" v-if="checklists.length > 0">
      <span>全部 {{ totalChecked }}/{{ totalItems }} · {{ totalPercent }}%</span>
    </div>

    <!-- 刷新默认清单按钮 -->
    <div class="refresh-section">
      <button class="refresh-btn" @click="refreshAllDefaults" :disabled="refreshing">
        <span v-if="refreshing">刷新中...</span>
        <span v-else>🔄 刷新默认清单（含必备标签）</span>
      </button>
    </div>

    <!-- 各清单卡片 -->
    <div v-for="cl in checklists" :key="cl.id" class="checklist-card" :class="{ 'card-expanded': expandedLists.has(cl.id) }">
      <div class="card-header" @click="toggleExpand(cl.id)">
        <div class="card-title-row">
          <span class="expand-icon" :class="{ 'expanded': expandedLists.has(cl.id) }">▶</span>
          <span class="card-icon">{{ getChecklistIcon(cl.type) }}</span>
          <h3 class="card-title">{{ cl.name }}</h3>
          <n-tag size="tiny" type="error" :bordered="false" v-if="clProgress(cl) && clProgress(cl).mandatory_total > 0">🔥 {{ clProgress(cl).mandatory_checked }}/{{ clProgress(cl).mandatory_total }}</n-tag>
        </div>
        <!-- 始终可见的快捷操作栏 -->
        <div class="card-quick-actions">
          <button class="quick-add-btn" @click.stop="showAddItemFor(cl)" title="添加自定义物品">+ 添加物品</button>
        </div>
        <div class="card-desc" v-if="getChecklistDesc(cl.type)">{{ getChecklistDesc(cl.type) }}</div>
        <div class="card-progress" v-if="clProgress(cl) && clProgress(cl).total > 0">
          <div class="card-bar-wrap">
            <div class="card-bar-fill" :style="{ width: clProgress(cl).mandatory_percentage + '%' }"></div>
          </div>
          <span class="progress-text">🔥 {{ clProgress(cl).mandatory_percentage }}%</span>
        </div>
      </div>

      <!-- 条目列表（按分类分组） -->
      <div class="items-body" v-show="expandedLists.has(cl.id)">
        <!-- 添加物品输入行（置顶显示） -->
        <div class="add-item-row" :class="{ 'active': activeAddChecklistId === cl.id }" ref="addInputRefs">
          <input
            v-model="newItemNames[cl.id]"
            placeholder="输入物品名称，回车或点击+添加..."
            class="add-input"
            :class="{ 'active': activeAddChecklistId === cl.id }"
            @keyup.enter="addCustomItem(cl)"
            @focus="showAddItemFor(cl)"
          />
          <select v-model="newItemCats[cl.id]" class="add-cat-select" v-if="!newItemCats[cl.id]?.startsWith('__new__:')">
            <option value="">选择分类</option>
            <option v-for="cat in getCategories(cl)" :key="cat" :value="cat">{{ cat }}</option>
            <option value="__new__:👩 妈妈">👩 新分类</option>
            <option value="__new__:_none_">不分类</option>
          </select>
          <input
            v-else
            :value="newItemCats[cl.id].split(':',2)[1] === '_none_' ? '' : (newItemCustomCat[cl.id] || '')"
            @input="(e: any) => { newItemCustomCat[cl.id] = e.target.value; newItemCats[cl.id] = e.target.value ? `__custom__:${newItemCats[cl.id].split(':')[1]}${e.target.value}` : newItemCats[cl.id] }"
            placeholder="新分类名"
            class="add-cat-input"
            @keyup.enter="addCustomItem(cl)"
          />
          <button class="add-btn" @click="addCustomItem(cl)" :disabled="!newItemNames[cl.id]?.trim()">+</button>
        </div>

        <template v-if="Object.keys(groupedItems(cl.id)).length > 0">
          <div v-for="(group, catName) in groupedItems(cl.id)" :key="catName" class="item-group">
            <div class="group-header" @click="toggleGroup(cl.id, catName)">
              <span class="expand-icon group-expand" :class="{ 'expanded': expandedGroups[cl.id]?.has(catName) }">▶</span>
              <span class="group-icon">📁</span>
              <span class="group-name">{{ catName }}</span>
              <span class="group-count">{{ group.checked }}/{{ group.items.length }}</span>
              <span class="group-percentage" v-if="catName !== '_none_'">{{ group.percentage }}%</span>
            </div>
            <div class="group-items" v-show="expandedGroups[cl.id]?.has(catName) || catName === '_none_'">
              <label
                v-for="item in filterItems(group.items, cl.id)"
                :key="item.id"
                class="item-row"
                :class="{ checked: item.is_checked === 1, custom: item.is_custom === 1, mandatory: item.is_mandatory === 1 }"
              >
                <input
                  type="checkbox"
                  :checked="item.is_checked === 1"
                  @change="toggleItem(item)"
                  class="item-checkbox"
                />
                <span class="item-name">{{ item.name }}</span>
                <span v-if="item.is_mandatory === 1" class="mandatory-badge">必备</span>
                <span v-if="item.is_custom === 1" class="custom-badge">自定义</span>
                <button
                  v-if="item.is_custom === 1"
                  class="delete-custom-btn"
                  @click.prevent="deleteItem(item)"
                >✕</button>
              </label>
            </div>
          </div>
        </template>
        <div v-else class="empty-items">暂无条目</div>

        <!-- 筛选按钮 -->
        <div class="filter-row">
          <button
            class="filter-btn"
            :class="{ active: getChecklistFilter(cl.id).status === 'all' }"
            @click="getChecklistFilter(cl.id).status = 'all'"
          >全部</button>
          <button
            class="filter-btn mandatory-filter"
            :class="{ active: getChecklistFilter(cl.id).status === 'mandatory' }"
            @click="getChecklistFilter(cl.id).status = 'mandatory'"
          >🔥 必备</button>
          <button
            class="filter-btn"
            :class="{ active: getChecklistFilter(cl.id).status === 'unchecked' }"
            @click="getChecklistFilter(cl.id).status = 'unchecked'"
          >未准备</button>
          <button
            class="filter-btn"
            :class="{ active: getChecklistFilter(cl.id).status === 'checked' }"
            @click="getChecklistFilter(cl.id).status = 'checked'"
          >已准备</button>
        </div>

        <!-- 搜索 -->
        <div class="search-row">
          <input
            v-model="getChecklistFilter(cl.id).search"
            placeholder="搜索物品..."
            class="search-input"
          />
          <button v-if="getChecklistFilter(cl.id).search" class="clear-search" @click="getChecklistFilter(cl.id).search = ''">✕</button>
        </div>

      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="checklists.length === 0 && !loading" class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无清单数据</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { checklistApi } from '@/api/checklist'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

const checklists = ref<any[]>([])
const loading = ref(false)
const refreshing = ref(false)
const expandedLists = ref<Set<string>>(new Set())
const expandedGroups = ref<Record<string, Set<string>>>({})
const newItemNames = reactive<Record<string, string>>({})
const newItemCats = reactive<Record<string, string>>({})
const newItemCustomCat = reactive<Record<string, string>>({})
const activeAddChecklistId = ref<string | null>(null)
const searchQuery = ref('')
const filterStatus = ref<'all' | 'checked' | 'unchecked' | 'mandatory'>('all')
// 按清单ID独立维护的筛选状态（支持每个清单独立的搜索/筛选）
const perChecklistFilter = reactive<Record<string, { search: string; status: 'all' | 'checked' | 'unchecked' | 'mandatory' }>>({})

function getChecklistFilter(checklistId: string) {
  if (!perChecklistFilter[checklistId]) {
    perChecklistFilter[checklistId] = { search: '', status: 'all' }
  }
  return perChecklistFilter[checklistId]
}

interface ItemGroup {
  items: any[]
  checked: number
  percentage: number
}

function getChecklistIcon(type: string): string {
  const map: Record<string, string> = {
    delivery_room: '🛏️',
    hospital: '🏥',
    confinement: '🤱',
  }
  return map[type] || '📋'
}

function getChecklistDesc(type: string): string {
  const map: Record<string, string> = {
    delivery_room: '生产时产房用品',
    hospital: '待产用品、及生产完住院用品',
    confinement: '坐月子用品',
  }
  return map[type] || ''
}

function clProgress(cl: any): any {
  if (!cl.items || !Array.isArray(cl.items)) return null
  const total = cl.items.length
  const checked = cl.items.filter((i: any) => i.is_checked === 1).length
  const mandatoryTotal = cl.items.filter((i: any) => i.is_mandatory === 1).length
  const mandatoryChecked = cl.items.filter((i: any) => i.is_mandatory === 1 && i.is_checked === 1).length
  return {
    total,
    checked,
    percentage: total > 0 ? Math.round(checked / total * 100) : 0,
    mandatory_total: mandatoryTotal,
    mandatory_checked: mandatoryChecked,
    mandatory_percentage: mandatoryTotal > 0 ? Math.round(mandatoryChecked / mandatoryTotal * 100) : 0
  }
}

const totalItems = computed(() =>
  checklists.value.reduce((sum, cl) => sum + (cl.items?.length || 0), 0)
)

const totalChecked = computed(() =>
  checklists.value.reduce((sum, cl) =>
    sum + (cl.items?.filter((i: any) => i.is_checked === 1).length || 0), 0)
)

const totalPercent = computed(() =>
  totalItems.value > 0 ? Math.round(totalChecked.value / totalItems.value * 100) : 0
)

const mandatoryTotal = computed(() =>
  checklists.value.reduce((sum, cl) =>
    sum + (cl.items?.filter((i: any) => i.is_mandatory === 1).length || 0), 0)
)

const mandatoryChecked = computed(() =>
  checklists.value.reduce((sum, cl) =>
    sum + (cl.items?.filter((i: any) => i.is_mandatory === 1 && i.is_checked === 1).length || 0), 0)
)

const mandatoryPercent = computed(() =>
  mandatoryTotal.value > 0 ? Math.round(mandatoryChecked.value / mandatoryTotal.value * 100) : 0
)

function groupedItems(checklistId: string): Record<string, ItemGroup> {
  const cl = checklists.value.find(c => c.id === checklistId)
  if (!cl?.items) return {}
  const groups: Record<string, ItemGroup> = {}
  for (const item of cl.items) {
    const cat = item.category || '_none_'
    if (!groups[cat]) groups[cat] = { items: [], checked: 0, percentage: 0 }
    groups[cat].items.push(item)
    if (item.is_checked === 1) groups[cat].checked++
  }
  for (const cat of Object.keys(groups)) {
    const g = groups[cat]
    g.percentage = g.items.length > 0 ? Math.round(g.checked / g.items.length * 100) : 0
  }
  return groups
}

function getCategories(cl: any): string[] {
  if (!cl.items) return []
  const cats = new Set<string>()
  for (const item of cl.items) {
    if (item.category) cats.add(item.category)
  }
  return Array.from(cats)
}

function toggleExpand(id: string) {
  if (expandedLists.value.has(id)) {
    expandedLists.value.delete(id)
  } else {
    expandedLists.value.add(id)
  }
  expandedLists.value = new Set(expandedLists.value)
}

function toggleGroup(checklistId: string, groupName: string) {
  if (!expandedGroups.value[checklistId]) {
    expandedGroups.value[checklistId] = new Set()
  }
  if (expandedGroups.value[checklistId].has(groupName)) {
    expandedGroups.value[checklistId].delete(groupName)
  } else {
    expandedGroups.value[checklistId].add(groupName)
  }
  expandedGroups.value = { ...expandedGroups.value }
}

function filterItems(items: any[], checklistId: string): any[] {
  const f = getChecklistFilter(checklistId)
  let filtered = items
  if (f.status === 'checked') {
    filtered = filtered.filter(item => item.is_checked === 1)
  } else if (f.status === 'unchecked') {
    filtered = filtered.filter(item => item.is_checked === 0)
  } else if (f.status === 'mandatory') {
    filtered = filtered.filter(item => item.is_mandatory === 1)
  }
  if (f.search.trim()) {
    const query = f.search.toLowerCase()
    filtered = filtered.filter(item => item.name.toLowerCase().includes(query))
  }
  return filtered
}

async function toggleItem(item: any) {
  try {
    await checklistApi.updateItem(item.id, { is_checked: item.is_checked === 1 ? 0 : 1 })
    item.is_checked = item.is_checked === 1 ? 0 : 1
  } catch { message.error('更新失败') }
}

async function addCustomItem(cl: any) {
  const name = newItemNames[cl.id]?.trim()
  if (!name) return
  let cat = newItemCats[cl.id] || ''
  if (cat.startsWith('__new__:')) {
    cat = ''
  } else if (cat.startsWith('__custom__:')) {
    cat = cat.substring('__custom__:'.length)
  }
  try {
    await checklistApi.addItem(cl.id, { name, category: cat || undefined, is_custom: 1 })
    newItemNames[cl.id] = ''
    newItemCats[cl.id] = ''
    newItemCustomCat[cl.id] = ''
    activeAddChecklistId.value = null
    message.success('已添加')
    await loadChecklists()
  } catch { message.error('添加失败') }
}

function showAddItemFor(cl: any) {
  console.log('[Checklist] showAddItemFor:', cl.id, cl.name)
  // 如果已经激活了这个清单，关闭它
  if (activeAddChecklistId.value === cl.id) {
    activeAddChecklistId.value = null
    return
  }
  // 激活添加模式
  activeAddChecklistId.value = cl.id
  // 自动展开卡片
  if (!expandedLists.value.has(cl.id)) {
    expandedLists.value.add(cl.id)
    expandedLists.value = new Set(expandedLists.value)
  }
  // 等待DOM更新后滚动到输入框并聚焦
  nextTick(() => {
    const input = document.querySelector('.add-item-row.active .add-input') as HTMLInputElement
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => input.focus(), 300)
    }
  })
}

async function deleteItem(item: any) {
  try {
    await checklistApi.deleteItem(item.id)
    await loadChecklists()
    message.success('已删除')
  } catch { message.error('删除失败') }
}

async function loadChecklists() {
  if (!pregnancyStore.currentPregnancy) return
  loading.value = true
  try {
    // 首次加载时确保默认清单已初始化（写操作通过专用 POST 端点触发）
    await checklistApi.ensureDefaults(pregnancyStore.currentPregnancy.id)
    const res: any = await checklistApi.list(pregnancyStore.currentPregnancy.id)
    if (res.code === 0) {
      const data = res.data
      checklists.value = Array.isArray(data) ? data : []
      for (const cl of checklists.value) {
        expandedLists.value.add(cl.id)
        if (!expandedGroups.value[cl.id]) {
          expandedGroups.value[cl.id] = new Set()
          const groups = groupedItems(cl.id)
          for (const catName of Object.keys(groups)) {
            expandedGroups.value[cl.id].add(catName)
          }
        }
      }
    }
  } finally { loading.value = false }
}

async function refreshAllDefaults() {
  if (!pregnancyStore.currentPregnancy) return
  refreshing.value = true
  try {
    for (const cl of checklists.value) {
      await checklistApi.initDefault(cl.id)
    }
    message.success('默认清单已刷新')
    await loadChecklists()
  } catch {
    message.error('刷新失败')
  } finally { refreshing.value = false }
}

onMounted(() => {
  loadChecklists()
})

watch(() => pregnancyStore.currentPregnancy?.id, (pid) => {
  if (pid) loadChecklists()
})
</script>

<style scoped>
.checklist-view { max-width: 680px; margin: 0 auto; padding: 16px; }

/* 总览 */
.progress-overview {
  display: flex; align-items: center; gap: 14px;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white; border-radius: 14px; padding: 18px 20px;
  margin-bottom: 6px; box-shadow: 0 3px 12px rgba(239,68,68,.25);
}
.overview-stats { text-align: center; min-width: 76px; }
.stat-num { font-size: 26px; font-weight: 800; line-height: 1; }
.stat-label { font-size: 11px; opacity: .95; margin-top: 2px; }
.overview-bar { flex: 1; height: 10px; background: rgba(255,255,255,.35); border-radius: 5px; overflow: hidden; }
.bar-fill { height: 100%; background: white; border-radius: 5px; transition: width .4s; }
.overview-pct { font-size: 20px; font-weight: 800; min-width: 48px; text-align: right; }
.progress-sub {
  text-align: right; font-size: 12px; color: #64748b;
  padding: 0 4px 16px 4px;
}

/* 清单卡片 */
.checklist-card {
  background: white; border-radius: 14px; padding: 16px;
  margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.06);
  border-left: 4px solid #e2e8f0;
  transition: border-left-color 0.3s ease;
}
.checklist-card.card-expanded {
  border-left-color: #43A047;
}
.card-header { cursor: pointer; }
.card-title-row { display: flex; align-items: center; gap: 8px; }
.expand-icon {
  font-size: 12px; color: #94a3b8; transition: transform 0.3s ease;
  display: inline-block; width: 16px; text-align: center;
}
.expand-icon.expanded { transform: rotate(90deg); }
.card-title { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 700; margin: 0; flex-wrap: wrap; flex: 1; }
.card-icon { font-size: 22px; }
.card-desc { font-size: 12px; color: #94a3b8; margin-top: 4px; padding-left: 24px; }

.card-progress { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.card-bar-wrap { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
.card-bar-fill { height: 100%; background: linear-gradient(90deg, #66BB6A, #42A5F5); border-radius: 3px; transition: width .4s; }
.progress-text { font-size: 12px; font-weight: 600; color: #43A047; min-width: 36px; }

/* 条目 */
.items-body { padding-top: 12px; }

.item-group { margin-bottom: 12px; }
.group-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  font-size: 13px; font-weight: 700; color: #475569;
  background: #f8fafc; border-radius: 8px; cursor: pointer;
  transition: background 0.2s;
}
.group-header:hover { background: #f1f5f9; }
.group-expand { font-size: 10px; }
.group-icon { font-size: 15px; }
.group-name { flex: 1; }
.group-count { font-size: 11px; font-weight: 400; color: #94a3b8; background: white; padding: 2px 8px; border-radius: 8px; }
.group-percentage { font-size: 11px; font-weight: 600; color: #43A047; min-width: 32px; text-align: right; }

.group-items { padding: 4px 0; }

.item-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 8px; cursor: pointer; transition: background .15s;
}
.item-row:hover { background: #f8fafc; }
.item-row.checked { background: #f0fdf4; }
.item-row.checked .item-name { text-decoration: line-through; color: #94a3b8; }
.item-checkbox { width: 18px; height: 18px; accent-color: #43A047; cursor: pointer; flex-shrink: 0; }
.item-name { flex: 1; font-size: 14px; color: #334155; user-select: none; }
.mandatory-badge { font-size: 10px; color: #fff; background: #ef4444; padding: 1px 6px; border-radius: 6px; font-weight: 600; }
.custom-badge { font-size: 10px; color: #fff; background: #94a3b8; padding: 1px 6px; border-radius: 6px; }
.delete-custom-btn { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 14px; padding: 2px 4px; opacity: 0.6; }
.delete-custom-btn:hover { opacity: 1; }

.empty-items { text-align: center; padding: 24px; color: #94a3b8; font-size: 14px; }

/* 筛选按钮 */
.filter-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.filter-btn {
  flex: 1; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  background: white; color: #64748b;
}
.filter-btn:hover { border-color: #94a3b8; }
.filter-btn.active { background: #43A047; color: white; border-color: #43A047; }
.filter-btn.mandatory-filter.active { background: #ef4444; border-color: #ef4444; }

/* 搜索 */
.search-row { display: flex; gap: 6px; margin-bottom: 12px; position: relative; }
.search-input {
  flex: 1; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; outline: none; background: #f8fafc;
}
.search-input:focus { border-color: var(--primary-color); background: white; }
.clear-search {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px;
}

/* 添加条目 */
.add-item-row {
  display: flex; gap: 6px; margin-top: 12px; padding-top: 12px;
  border-top: 1px dashed #e2e8f0;
  transition: all .25s ease;
}
.add-item-row.active {
  border: 1.5px solid var(--primary-color, #43A047);
  background: #f0fdf4; padding: 10px; border-radius: 10px;
  box-shadow: 0 2px 8px rgba(67,160,71,.15);
}
.add-input { flex: 1; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; outline: none; }
.add-input:focus { border-color: var(--primary-color); }
.add-input.active { border-color: var(--primary-color, #43A047); font-weight: 500; }
.add-cat-select { padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: white; max-width: 140px; }
.add-cat-input { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; outline: none; max-width: 140px; }
.add-btn { width: 36px; height: 36px; border-radius: 8px; border: none; background: var(--primary-color); color: white; font-size: 18px; font-weight: 700; cursor: pointer; transition: transform .15s; }
.add-btn:disabled { opacity: .4; cursor: not-allowed; }
.add-btn:not(:disabled):hover { transform: scale(1.1); }

/* 快捷添加按钮（卡片标题栏） */
.card-quick-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
.quick-add-btn {
  padding: 4px 14px; border: 1.5px dashed #94a3b8; border-radius: 20px;
  background: transparent; color: #64748b; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .2s;
}
.quick-add-btn:hover { border-color: #43A047; color: #43A047; background: #f0fdf4; }
.card-header:hover .quick-add-btn { opacity: 1; }

/* 空状态 */
.empty-state { text-align: center; padding: 60px 20px; }
.empty-icon { font-size: 56px; opacity: .4; margin-bottom: 12px; }
.empty-text { font-size: 16px; color: #94a3b8; }

/* 刷新按钮 */
.refresh-section { margin-bottom: 16px; }
.refresh-btn {
  width: 100%; padding: 12px; border: 2px dashed #e2e8f0; border-radius: 10px;
  background: #f8fafc; color: #64748b; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}
.refresh-btn:hover { border-color: #43A047; color: #43A047; background: #f0fdf4; }
.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 移动端适配 */
@media (max-width: 768px) {
  .checklist-view { padding: 10px; }
  .progress-overview { flex-wrap: wrap; gap: 8px; padding: 14px; }
  .overview-stats { min-width: 44px; }
  .stat-num { font-size: 22px; }
  .overview-bar { height: 8px; }
  .checklist-card { padding: 12px; border-radius: 12px; }
  .card-title { font-size: 14px; flex-wrap: wrap; }
  .card-icon { font-size: 18px; }
  .item-row { padding: 7px 8px; gap: 8px; }
  .item-name { font-size: 13px; }
  .add-item-row { flex-direction: column; align-items: stretch; }
  .add-cat-select { max-width: none; width: 100%; }
}
@media (max-width: 480px) {
  .progress-overview { flex-direction: column; text-align: center; }
  .overview-pct { text-align: center; }
}
</style>
