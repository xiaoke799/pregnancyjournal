<template>
  <div class="diary-view">
    <div class="diary-header">
      <h2>📖 孕期日记</h2>
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
          <span class="date-text">{{ formatFullDate(diary.record_date) }}</span>
          <span class="week-text">孕{{ getWeekInfo(diary.record_date) }}周</span>
        </div>
        <div class="diary-content-preview">
          {{ diary.note || '无内容' }}
        </div>
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
          <n-date-picker
            v-model:formatted-value="diaryForm.record_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
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
          <n-input
            v-model:value="diaryForm.note"
            type="textarea"
            :rows="8"
            placeholder="记录今天的感受、宝宝的胎动、身体的变化..."
          />
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
import { ref, computed, onMounted } from 'vue'
import { NButton, NModal, NInput, NDatePicker, NSpin, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'
import { calculateGestationalAge } from '@/utils/gestational'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

const diaries = ref<any[]>([])
const loading = ref(false)
const showDiaryModal = ref(false)
const editingDiary = ref<any>(null)
const saving = ref(false)

const moodOptions = [
  { value: 1, emoji: '😢', label: '很差' },
  { value: 2, emoji: '😔', label: '不好' },
  { value: 3, emoji: '😐', label: '一般' },
  { value: 4, emoji: '😊', label: '不错' },
  { value: 5, emoji: '😄', label: '很好' },
]

const diaryForm = ref({
  record_date: dayjs().format('YYYY-MM-DD'),
  title: '',
  note: '',
  mood: 3,
})

async function loadDiaries() {
  if (!pregnancyStore.currentPregnancy?.id) return
  loading.value = true
  try {
    const res: any = await dailyRecordApi.list(
      pregnancyStore.currentPregnancy.id,
      { page: 1, page_size: 100 }
    )
    if (res.code === 0) {
      diaries.value = (res.data?.items || res.data?.list || res.data || [])
        .filter((r: any) => r.note)
        .sort((a: any, b: any) => dayjs(b.record_date).valueOf() - dayjs(a.record_date).valueOf())
    }
  } catch (e) {
    console.error('Failed to load diaries:', e)
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
  showDiaryModal.value = true
}

function editDiary(diary: any) {
  editingDiary.value = diary
  diaryForm.value = {
    record_date: diary.record_date,
    title: diary.title || '',
    note: diary.note || '',
    mood: diary.mood || 3,
  }
  showDiaryModal.value = true
}

async function saveDiary() {
  if (!diaryForm.value.note.trim()) {
    message.warning('请输入日记内容')
    return
  }
  if (!pregnancyStore.currentPregnancy?.id) {
    message.warning('请先创建孕期档案')
    return
  }
  
  saving.value = true
  try {
    const data = {
      pregnancy_id: pregnancyStore.currentPregnancy.id,
      record_date: diaryForm.value.record_date,
      note: diaryForm.value.note,
      mood: String(diaryForm.value.mood),
    }
    
    if (editingDiary.value) {
      await dailyRecordApi.update(editingDiary.value.id, data)
      message.success('日记已更新')
    } else {
      await dailyRecordApi.create(data)
      message.success('日记已保存')
    }
    
    showDiaryModal.value = false
    await loadDiaries()
  } catch (e) {
    console.error('Failed to save diary:', e)
    message.error('保存失败，请重试')
  } finally {
    saving.value = false
  }
}

async function deleteDiary(diary: any) {
  if (!confirm('确定要删除这篇日记吗？')) return
  try {
    await dailyRecordApi.delete(diary.id)
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

onMounted(async () => {
  if (!pregnancyStore.currentPregnancy) {
    await pregnancyStore.fetchActivePregnancy()
  }
  loadDiaries()
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

.diary-content-preview {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-secondary, #64748b);
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

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
