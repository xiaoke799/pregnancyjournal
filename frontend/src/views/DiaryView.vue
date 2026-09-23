<template>
  <div class="diary-view">
    <div class="diary-header">
      <div class="diary-header-left">
        <h2>📖 孕期日记</h2>
        <span v-if="pregnancyStore.currentPregnancy" class="diary-pregnancy-info">
          孕{{ gestationalWeeks }}周+{{ gestationalDays }}天 | {{ daysUntilDue }}天后预产期
        </span>
      </div>
      <n-button type="primary" round @click="openNewDiary">
        <template #icon>✏️</template>
        写日记
      </n-button>
    </div>

    <div v-if="loading" class="diary-loading">
      <n-spin size="large" />
      <p>加载日记中...</p>
    </div>

    <div v-else-if="diaries.length === 0" class="diary-empty">
      <span class="empty-icon">📖</span>
      <h3>还没有日记</h3>
      <p>记录孕期的每一天，留住珍贵的回忆</p>
      <n-button type="primary" @click="openNewDiary">写第一篇日记</n-button>
    </div>

    <div v-else class="diary-list">
      <div v-for="diary in diaries" :key="diary.id" class="diary-card" @click="viewDiary(diary)">
        <div class="diary-date-header">
          <span class="date-text">{{ formatFullDate(diary.entry_date || diary.record_date) }}</span>
          <span v-if="diary.mood" class="diary-mood-emoji" :title="getMoodLabel(diary.mood)">{{ getMoodEmoji(diary.mood) }}</span>
          <span class="week-text">孕{{ getWeekInfo(diary.entry_date || diary.record_date) }}周</span>
          <span v-if="diary.title" class="diary-title-inline">{{ diary.title }}</span>
        </div>
        <div class="diary-content-preview" :class="{ collapsed: !expandedDiaries[diary.id] }" v-html="renderDiaryContent(diary.content || diary.note)"></div>
        <button
          v-if="plainTextLength(diary) > 200"
          class="diary-expand-btn"
          @click.stop="toggleExpand(diary.id)"
        >{{ expandedDiaries[diary.id] ? '收起 ↑' : '展开全文 ↓' }}</button>
        <div class="diary-footer">
          <span class="diary-time">{{ formatTime(diary.created_at) }}</span>
          <div class="diary-actions">
            <n-button size="tiny" quaternary @click.stop="editDiary(diary)">✏️ 编辑</n-button>
            <n-button size="tiny" quaternary type="error" @click.stop="deleteDiary(diary)">🗑️ 删除</n-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 写日记弹窗 -->
    <n-modal
      v-model:show="showDiaryModal"
      preset="card"
      :title="editingDiary ? '✏️ 编辑日记' : '✏️ 写日记'"
      style="max-width: 600px; width: 95vw;"
      :mask-closable="true"
      @after-leave="resetDiaryForm"
    >
      <div class="diary-form">
        <div class="form-group">
          <label>日期</label>
          <input
            type="date"
            class="diary-date-input"
            :value="diaryForm.record_date"
            @input="(e: Event) => diaryForm.record_date = (e.target as HTMLInputElement).value"
          />
        </div>
        <div class="form-group">
          <label>标题（可选）</label>
          <n-input
            v-model:value="diaryForm.title"
            placeholder="给今天起个标题..."
          />
        </div>
        <div class="form-group">
          <label>日记内容</label>
          <div v-if="editor" class="diary-toolbar">
            <n-button-group size="tiny">
              <n-button :type="editor.isActive('bold') ? 'primary' : 'default'" @click="editor.chain().focus().toggleBold().run()" title="加粗"><strong>B</strong></n-button>
              <n-button :type="editor.isActive('italic') ? 'primary' : 'default'" @click="editor.chain().focus().toggleItalic().run()" title="斜体"><em>I</em></n-button>
              <n-button :type="editor.isActive('heading', { level: 2 }) ? 'primary' : 'default'" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()" title="标题2">H2</n-button>
              <n-button :type="editor.isActive('heading', { level: 3 }) ? 'primary' : 'default'" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()" title="标题3">H3</n-button>
              <n-button :type="editor.isActive('bulletList') ? 'primary' : 'default'" @click="editor.chain().focus().toggleBulletList().run()" title="无序列表">• 列表</n-button>
              <n-button :type="editor.isActive('orderedList') ? 'primary' : 'default'" @click="editor.chain().focus().toggleOrderedList().run()" title="有序列表">1. 列表</n-button>
              <n-button @click="handleInsertImage" title="插入图片">🖼️ 图片</n-button>
            </n-button-group>
          </div>
          <div class="diary-editor-wrapper">
            <EditorContent :editor="editor" class="diary-editor" />
          </div>
          <input ref="imageInputRef" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" @change="onImageSelected" />
        </div>
        <div class="form-group">
          <label>心情</label>
          <div class="mood-selector">
            <button
              v-for="m in moodOptions"
              :key="m.value"
              class="mood-btn"
              :class="{ active: diaryForm.mood === m.value }"
              @click="diaryForm.mood = m.value"
            >
              {{ m.emoji }} {{ m.label }}
            </button>
          </div>
        </div>
      </div>
      <template #action>
        <n-button @click="showDiaryModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveDiary">
          {{ editingDiary ? '保存修改' : '保存日记' }}
        </n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { NButton, NModal, NButtonGroup, NInput, NDatePicker, NSpin, useMessage } from 'naive-ui'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { usePregnancyStore } from '@/stores/pregnancy'
import { diaryApi } from '@/api/diary'
import client from '@/api/client'
import { getApiBase } from '@/utils/api-base'
import dayjs from 'dayjs'
import { calculateGestationalAge } from '@/utils/gestational'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

const diaries = ref<any[]>([])
const loading = ref(false)
const showDiaryModal = ref(false)
const editingDiary = ref<any>(null)
const saving = ref(false)
const expandedDiaries = ref<Record<string, boolean>>({})

function toggleExpand(id: string) {
  expandedDiaries.value[id] = !expandedDiaries.value[id]
}

/** 从富文本HTML中提取纯文本（去除标签） */
function stripHtml(html: string): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

const moodOptions = [
  { value: 1, emoji: '😢', label: '很差' },
  { value: 2, emoji: '😔', label: '不好' },
  { value: 3, emoji: '😐', label: '一般' },
  { value: 4, emoji: '😊', label: '不错' },
  { value: 5, emoji: '😄', label: '很好' },
]

const gestationalAge = computed(() => {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  if (!lmp) return { weeks: 0, days: 0 }
  return calculateGestationalAge(lmp)
})
const gestationalWeeks = computed(() => gestationalAge.value.weeks)
const gestationalDays = computed(() => gestationalAge.value.days)
const daysUntilDue = computed(() => {
  if (!pregnancyStore.currentPregnancy?.due_date) return '--'
  return Math.max(0, dayjs(pregnancyStore.currentPregnancy.due_date).diff(dayjs(), 'day'))
})

const diaryForm = ref({
  record_date: dayjs().format('YYYY-MM-DD'),
  title: '',
  note: '',
  mood: 3,
})

// ====== 富文本编辑器（TipTap）：排版 + 图文混排 ======
const uploadedImages = ref<string[]>([])
const imageInputRef = ref<HTMLInputElement | null>(null)

const editor = useEditor({
  content: '',
  extensions: [
    StarterKit,
    Image.configure({ HTMLAttributes: { class: 'diary-image' } }),
    Placeholder.configure({ placeholder: '记录今天的感受、宝宝的胎动、身体的变化...' }),
  ],
  onUpdate: ({ editor: e }) => {
    diaryForm.value.note = e.getHTML()
    syncImageUrls()
  },
})

function syncImageUrls() {
  const html = editor.value?.getHTML() || ''
  uploadedImages.value = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
}

/** 转义 HTML 特殊字符 */
function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 净化 HTML：移除 script/style、事件属性、危险协议（防 XSS） */
function sanitizeHtml(s: string): string {
  let h = s || ''
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '')
  h = h.replace(/<style[\s\S]*?<\/style>/gi, '')
  h = h.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
  h = h.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"')
  return h
}

/** 判断内容是否为富文本 HTML（旧日记为纯文本） */
function isHtmlContent(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s || '')
}

/** 列表/预览渲染：HTML 直接净化输出，纯文本则保留换行 */
function renderDiaryContent(raw: string): string {
  if (!raw) return ''
  if (isHtmlContent(raw)) return sanitizeHtml(raw)
  return escapeHtml(raw).replace(/\n/g, '<br>')
}

/** 编辑时回填编辑器：HTML 净化，纯文本包裹为段落并保留换行 */
function toEditorContent(raw: string): string {
  if (!raw) return ''
  if (isHtmlContent(raw)) return sanitizeHtml(raw)
  return '<p>' + escapeHtml(raw).replace(/\n/g, '<br>') + '</p>'
}

/** 取纯文本长度，用于"展开全文"判断 */
function plainTextLength(diary: any): number {
  const raw = diary.content || diary.note || ''
  if (!raw) return 0
  return raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().length
}

/** 点击插入图片按钮 */
function handleInsertImage() {
  imageInputRef.value?.click()
}

/** 图片上传并插入编辑器 */
async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    message.warning('图片大小不能超过 5MB')
    input.value = ''
    return
  }
  try {
    message.loading('正在上传图片...', { duration: 0 })
    const formPayload = new FormData()
    formPayload.append('file', file)
    const res: any = await client.post('/daily-records/diary-image', formPayload, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
    if (res.code === 0 && res.data?.url) {
      // 用网关前缀拼完整地址（开发/生产环境都能加载）
      const fullUrl = getApiBase() + res.data.url.replace(/^\/api\/v1/, '')
      editor.value?.chain().focus().setImage({ src: fullUrl }).run()
      message.success('图片已插入')
    } else {
      message.error(res.message || '图片上传失败')
    }
  } catch (err: any) {
    message.error(err?.message || '图片上传失败')
  } finally {
    message.destroyAll()
    input.value = ''
  }
}

async function loadDiaries() {
  if (!pregnancyStore.currentPregnancy?.id) return
  loading.value = true
  try {
    // 使用独立的日记 API（diary_entry 表），不是 daily-record
    const res: any = await diaryApi.list(
      pregnancyStore.currentPregnancy.id,
      { page: 1, page_size: 100 }
    )
    console.log('[Diary] loadDiaries:', res)
    if (res.code === 0) {
      const raw = res.data?.items || res.data?.list || res.data || []
      diaries.value = raw.sort((a: any, b: any) => {
        const da = a.entry_date || a.record_date || ''
        const db_ = b.entry_date || b.record_date || ''
        // 有日期的排前面，空日期排最后；同按倒序（最新在前）
        if (!da && !db_) return 0
        if (!da) return 1
        if (!db_) return -1
        return dayjs(db_).valueOf() - dayjs(da).valueOf()
      })
    }
  } catch (e) {
    console.error('[Diary] load error:', e)
    message.error('加载日记失败')
  } finally {
    loading.value = false
  }
}

function openNewDiary() {
  editingDiary.value = null
  diaryForm.value = {
    record_date: dayjs().format('YYYY-MM-DD'),
    title: '',
    note: '',
    mood: 3,
  }
  uploadedImages.value = []
  nextTick(() => editor.value?.commands.setContent(''))
  showDiaryModal.value = true
}

function editDiary(diary: any) {
  editingDiary.value = diary
  diaryForm.value = {
    record_date: diary.entry_date || diary.record_date || dayjs().format('YYYY-MM-DD'),
    title: diary.title || '',
    note: diary.content || diary.note || '',
    mood: diary.mood || 3,
  }
  uploadedImages.value = []
  nextTick(() => {
    editor.value?.commands.setContent(toEditorContent(diary.content || diary.note || ''))
    syncImageUrls()
  })
  showDiaryModal.value = true
}

async function saveDiary() {
  const textContent = editor.value?.getText()?.trim() || ''
  if (!textContent) {
    message.warning('请输入日记内容')
    return
  }
  if (!pregnancyStore.currentPregnancy?.id) {
    message.warning('请先创建孕期档案')
    return
  }

  saving.value = true
  try {
    // 日记使用 diary_entry 表，字段名：entry_date / content（不是 record_date / note）
    const data = {
      pregnancy_id: pregnancyStore.currentPregnancy.id,
      entry_date: diaryForm.value.record_date,
      title: diaryForm.value.title || '',
      content: diaryForm.value.note,
      mood: String(diaryForm.value.mood),
      image_urls: uploadedImages.value,
    }

    if (editingDiary.value) {
      await diaryApi.update(editingDiary.value.id, data)
      message.success('日记已更新')
    } else {
      await diaryApi.create(data)
      message.success('日记已保存')
    }

    showDiaryModal.value = false
    await loadDiaries()
  } catch (e: any) {
    console.error('[Diary] save error:', e?.message || e)
    message.error(e?.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

async function deleteDiary(diary: any) {
  if (!confirm('确定要删除这篇日记吗？')) return
  try {
    await diaryApi.delete(diary.id)
    message.success('日记已删除')
    await loadDiaries()
  } catch (e) {
    message.error('删除失败')
  }
}

function viewDiary(diary: any) {
  // 可以扩展为全屏查看模式
  editDiary(diary)
}

function resetDiaryForm() {
  editingDiary.value = null
  diaryForm.value = {
    record_date: dayjs().format('YYYY-MM-DD'),
    title: '',
    note: '',
    mood: 3,
  }
  uploadedImages.value = []
  editor.value?.commands.setContent('')
}

function formatFullDate(dateStr: string): string {
  return dayjs(dateStr).format('YYYY年M月D日')
}

function formatTime(dateStr: string): string {
  if (!dateStr) return ''
  return dayjs(dateStr).format('HH:mm')
}

function getWeekInfo(dateStr: string): string {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  if (!lmp) return '--'
  const age = calculateGestationalAge(dateStr)
  return String(age.weeks)
}

const moodEmojis: Record<string | number, string> = { 1: '😢', 2: '😔', 3: '😐', 4: '😊', 5: '😄' }
const moodLabels: Record<string | number, string> = { 1: '很差', 2: '不好', 3: '一般', 4: '不错', 5: '很好' }

function getMoodEmoji(mood: string | number): string {
  return moodEmojis[mood] || '😐'
}

function getMoodLabel(mood: string | number): string {
  return moodLabels[mood] || ''
}

onMounted(async () => {
  if (!pregnancyStore.currentPregnancy) {
    await pregnancyStore.fetchActivePregnancy()
  }
  loadDiaries()
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<style scoped>
.diary-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 16px;
}

.diary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.diary-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diary-pregnancy-info {
  font-size: 13px;
  color: var(--primary-color, #c44680);
  font-weight: 500;
}

.diary-header h2 {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
  margin: 0;
}

.diary-loading {
  text-align: center;
  padding: 60px 20px;
}

.diary-loading p {
  margin-top: 16px;
  color: var(--text-hint, #94a3b8);
}

.diary-empty {
  text-align: center;
  padding: 80px 20px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}

.empty-icon {
  font-size: 64px;
  display: block;
  margin-bottom: 16px;
}

.diary-empty h3 {
  font-size: 20px;
  color: var(--text-color, #1e293b);
  margin: 0 0 8px;
}

.diary-empty p {
  color: var(--text-hint, #94a3b8);
  margin: 0 0 24px;
}

.diary-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.diary-card {
  background: white;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.diary-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}

.diary-date-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border-color, #e2e8f0);
}

.date-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
}

.week-text {
  font-size: 12px;
  color: var(--primary-color, #c44680);
  font-weight: 600;
  background: #fdf4ff;
  padding: 2px 8px;
  border-radius: 8px;
}

.diary-title-inline {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  margin-left: 8px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diary-mood-emoji {
  font-size: 20px;
  margin-left: 6px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));
}

.diary-content-preview {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-secondary, #64748b);
  margin-bottom: 12px;
}
.diary-content-preview.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 10;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.diary-expand-btn {
  font-size: 12px; color: var(--primary-color, #c44680); cursor: pointer;
  background: none; border: none; padding: 0; margin-top: 4px;
}
.diary-expand-btn:hover { text-decoration: underline; }

.diary-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.diary-time {
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
}

.diary-actions {
  display: flex;
  gap: 4px;
}

.diary-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.diary-date-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.diary-date-input:focus {
  border-color: var(--primary-color, #c44680);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
}

.mood-selector {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mood-btn {
  padding: 6px 12px;
  border: 1.5px solid var(--border-color, #e2e8f0);
  border-radius: 20px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--text-color, #1e293b);
}

.mood-btn:hover {
  border-color: var(--primary-color, #c44680);
}

.mood-btn.active {
  background: var(--primary-color, #c44680);
  color: #fff;
  border-color: var(--primary-color, #c44680);
}

/* ====== 富文本编辑器 ====== */
.diary-toolbar {
  margin-bottom: 8px;
}
.diary-toolbar :deep(.n-button-group) {
  flex-wrap: wrap;
  gap: 2px;
}
.diary-toolbar :deep(.n-button) {
  font-size: 12px;
  padding: 0 8px;
  min-width: 32px;
}
.diary-editor-wrapper {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}
.diary-editor {
  min-height: 220px;
  max-height: 420px;
  overflow-y: auto;
  padding: 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color, #1e293b);
  outline: none;
}
.diary-editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-hint, #94a3b8);
  pointer-events: none;
  height: 0;
}
.diary-editor :deep(.tiptap) { outline: none; }
.diary-editor :deep(.tiptap h2) { font-size: 18px; font-weight: 600; margin: 16px 0 8px; }
.diary-editor :deep(.tiptap h3) { font-size: 16px; font-weight: 600; margin: 12px 0 6px; }
.diary-editor :deep(.tiptap p) { margin: 4px 0; }
.diary-editor :deep(.tiptap ul) { list-style: disc; padding-left: 20px; margin: 4px 0; }
.diary-editor :deep(.tiptap ol) { list-style: decimal; padding-left: 20px; margin: 4px 0; }
.diary-editor :deep(.tiptap li) { margin: 2px 0; }
.diary-editor :deep(.tiptap img.diary-image),
.diary-editor :deep(.tiptap img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 8px 0;
}
.diary-editor :deep(.tiptap strong) { font-weight: 600; }
.diary-editor :deep(.tiptap em) { font-style: italic; }

/* ====== 列表渲染（图文混排内容） ====== */
.diary-content-preview :deep(h2) { font-size: 17px; font-weight: 600; margin: 12px 0 6px; }
.diary-content-preview :deep(h3) { font-size: 15px; font-weight: 600; margin: 10px 0 4px; }
.diary-content-preview :deep(p) { margin: 4px 0; }
.diary-content-preview :deep(ul) { list-style: disc; padding-left: 20px; margin: 4px 0; }
.diary-content-preview :deep(ol) { list-style: decimal; padding-left: 20px; margin: 4px 0; }
.diary-content-preview :deep(li) { margin: 2px 0; }
.diary-content-preview :deep(.diary-image),
.diary-content-preview :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 8px 0;
}
.diary-content-preview :deep(strong) { font-weight: 600; }
.diary-content-preview :deep(em) { font-style: italic; }

@media (max-width: 768px) {
  .diary-view {
    padding: 12px;
  }
  
  .diary-header h2 {
    font-size: 18px;
  }
  
  .diary-card {
    padding: 16px;
  }
  
  .date-text {
    font-size: 14px;
  }
}
</style>
