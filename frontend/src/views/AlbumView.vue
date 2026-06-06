<template>
  <div class="album-view">
    <!-- 顶部操作栏 -->
    <div class="album-header">
      <h2 class="album-title">📷 孕期相册</h2>
      <n-button type="primary" size="small" @click="showUploadDialog = true">➕ 上传</n-button>
    </div>

    <!-- 相册分类 Tab -->
    <div class="album-tabs">
      <div v-for="tab in albumTabs" :key="tab.key"
        class="album-tab" :class="{ active: activeAlbumTab === tab.key }"
        @click="activeAlbumTab = tab.key">{{ tab.icon }} {{ tab.label }}</div>
    </div>

    <!-- 空状态 -->
    <div v-if="filteredPhotos.length === 0 && !loading" class="empty-state">
      <div class="empty-icon">📷</div>
      <div class="empty-text">记录你珍贵的孕期时光</div>
      <n-button type="primary" @click="showUploadDialog = true">上传第一张照片</n-button>
    </div>

    <!-- 时间线视图 -->
    <div v-else class="timeline-container">
      <div
        v-for="(group, gIdx) in groupedPhotos"
        :key="group.monthKey"
        class="timeline-month"
      >
        <!-- 月份分组标题 -->
        <div class="month-header">{{ group.monthLabel }}</div>

        <!-- 时间线项目 -->
        <div
          v-for="(item, iIdx) in group.items"
          :key="item.id"
          class="timeline-item"
        >
          <!-- 左侧时间轴线 -->
          <div class="timeline-axis">
            <div class="axis-line"></div>
            <div class="axis-dot" :class="{ 'dot-video': item.media_type === 'video' }"></div>
          </div>

          <!-- 右侧内容卡片 -->
          <div class="timeline-card">
            <div class="card-date">{{ formatDate(item.created_at) }} · 孕{{ item.gestational_week || '?' }}周</div>
            <div class="card-media" @click="previewItem(item)">
              <!-- 照片 -->
              <img
                v-if="item.media_type !== 'video' && !item._imgFailed"
                :src="thumbnailUrl(item.id)"
                :alt="item.note || ''"
                class="media-thumb"
                @error="onImageError(item)"
              />
              <div v-else-if="item.media_type !== 'video' && item._imgFailed" class="media-thumb media-fallback">
                📷
              </div>
              <!-- 视频缩略图 -->
              <div v-else class="video-thumb-wrapper">
                <img
                  :src="thumbnailUrl(item.id)"
                  :alt="item.note || ''"
                  class="media-thumb"
                />
                <div class="video-play-overlay">
                  <div class="play-icon">▶</div>
                </div>
              </div>
            </div>
            <div v-if="item.note" class="card-note">{{ item.note }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传对话框 -->
    <n-modal v-model:show="showUploadDialog" preset="dialog" title="上传照片/视频" positive-text="上传" negative-text="取消"
      :positive-button-props="{ disabled: !uploadFile }"
      @positive-click="handleUploadSubmit"
    >
      <n-form label-placement="left" label-width="80">
        <n-form-item label="选择文件">
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*,video/*"
            class="file-input"
            @change="onFileSelect"
          />
          <div v-if="uploadFile" class="file-name">{{ uploadFile.name }}</div>
        </n-form-item>
        <n-form-item label="分类">
          <div class="photo-type-select">
            <span v-for="pt in photoTypeOptions" :key="pt.key"
              class="pt-option" :class="{ selected: uploadPhotoType === pt.key }"
              @click="uploadPhotoType = pt.key">{{ pt.icon }} {{ pt.label }}</span>
          </div>
        </n-form-item>
        <n-form-item label="日期">
          <n-date-picker v-model:formatted-value="uploadDate" type="date" value-format="yyyy-MM-dd" style="width: 100%" clearable />
        </n-form-item>
        <n-form-item label="描述">
          <n-input v-model:value="uploadNote" type="textarea" :rows="2" placeholder="添加描述（可选）" />
        </n-form-item>
      </n-form>
    </n-modal>

    <!-- 照片全屏查看 -->
    <n-modal v-model:show="showImagePreview" preset="card" :style="{ maxWidth: '90vw', maxHeight: '90vh' }" :closable="true">
      <img :src="previewImageUrl" style="width: 100%; max-height: 80vh; object-fit: contain;" />
    </n-modal>

    <!-- 视频播放弹窗 -->
    <n-modal v-model:show="showVideoPreview" preset="card" :style="{ maxWidth: '90vw' }" :closable="true" title="视频播放">
      <video
        v-if="showVideoPreview"
        :src="previewVideoUrl"
        controls
        autoplay
        style="width: 100%; max-height: 80vh;"
      ></video>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NButton, NModal, NForm, NFormItem, NInput, NDatePicker, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { photoApi } from '@/api/photo'
import { usePhotoUpload } from '@/composables/usePhotoUpload'
import dayjs from 'dayjs'

const pregnancyStore = usePregnancyStore()
const { upload, uploading } = usePhotoUpload()
const message = useMessage()

interface PhotoItem {
  id: string
  pregnancy_id: string
  photo_type: string
  gestational_week: number | null
  file_path: string
  thumbnail_path: string | null
  note: string | null
  media_type: string
  created_at: string
  _imgFailed?: boolean
}

interface PhotoGroup {
  monthKey: string
  monthLabel: string
  items: PhotoItem[]
}

const allPhotos = ref<PhotoItem[]>([])
const loading = ref(false)
const showUploadDialog = ref(false)
const uploadFile = ref<File | null>(null)
const uploadNote = ref('')
const uploadDate = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

// 照片预览
const showImagePreview = ref(false)
const previewImageUrl = ref('')
const showVideoPreview = ref(false)
const previewVideoUrl = ref('')
const activeAlbumTab = ref('all')
const uploadPhotoType = ref('belly')

const albumTabs = [
  { key: 'all', icon: '📷', label: '全部' },
  { key: 'maternity', icon: '🤰', label: '孕妇照' },
  { key: 'belly', icon: '🫄', label: '孕肚照' },
  { key: 'baby', icon: '👶', label: '婴儿照' },
  { key: 'video', icon: '🎬', label: '视频' },
]

const photoTypeOptions = [
  { key: 'maternity', icon: '🤰', label: '孕妇照' },
  { key: 'belly', icon: '🫄', label: '孕肚照' },
  { key: 'baby', icon: '👶', label: '婴儿照' },
]

/** 按分类过滤后的照片 */
const filteredPhotos = computed(() => {
  if (activeAlbumTab.value === 'all') return allPhotos.value
  if (activeAlbumTab.value === 'video') return allPhotos.value.filter(p => p.media_type === 'video')
  return allPhotos.value.filter(p => p.photo_type === activeAlbumTab.value)
})

/** 缩略图 URL */
function thumbnailUrl(id: string): string {
  return photoApi.thumbnailUrl(id)
}

/** 原图 URL */
function fileUrl(id: string): string {
  return photoApi.fileUrl(id)
}

/** 格式化日期 */
function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return dayjs(dateStr).format('MM/DD')
}

/** 按月份分组 */
const groupedPhotos = computed<PhotoGroup[]>(() => {
  const groups: Map<string, PhotoGroup> = new Map()
  for (const photo of filteredPhotos.value) {
    const date = dayjs(photo.created_at)
    const monthKey = date.format('YYYY-MM')
    const monthLabel = date.format('YYYY年M月')
    if (!groups.has(monthKey)) {
      groups.set(monthKey, { monthKey, monthLabel, items: [] })
    }
    groups.get(monthKey)!.items.push(photo)
  }
  // 每组内按时间倒序
  for (const group of groups.values()) {
    group.items.sort((a, b) => dayjs(b.created_at).valueOf() - dayjs(a.created_at).valueOf())
  }
  return Array.from(groups.values())
})

/** 预览照片/视频 */
function previewItem(item: PhotoItem) {
  if (item.media_type === 'video') {
    previewVideoUrl.value = fileUrl(item.id)
    showVideoPreview.value = true
  } else {
    previewImageUrl.value = fileUrl(item.id)
    showImagePreview.value = true
  }
}

/** 文件选择 */
function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    uploadFile.value = file
  }
}

/** 提交上传 */
async function handleUploadSubmit(): Promise<boolean> {
  if (!uploadFile.value || !pregnancyStore.currentPregnancy) return false

  const file = uploadFile.value
  const isVideo = file.type.startsWith('video/')
  const pregnancyId = pregnancyStore.currentPregnancy.id
  const currentWeek = pregnancyStore.gestationalAge?.weeks

  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('pregnancy_id', pregnancyId)
    formData.append('photo_type', uploadPhotoType.value)
    formData.append('media_type', isVideo ? 'video' : 'photo')
    if (currentWeek != null) formData.append('gestational_week', String(currentWeek))
    if (uploadNote.value) formData.append('note', uploadNote.value)

    await photoApi.upload(formData)
    message.success('上传成功')
    uploadFile.value = null
    uploadNote.value = ''
    uploadDate.value = null
    if (fileInputRef.value) fileInputRef.value.value = ''
    await loadPhotos()
    return true
  } catch {
    message.error('上传失败，请重试')
    return false
  }
}

/** 加载照片列表 */
async function loadPhotos() {
  if (!pregnancyStore.currentPregnancy) return
  loading.value = true
  try {
    const pid = pregnancyStore.currentPregnancy.id
    const res: any = await photoApi.list(pid)
    const photos: PhotoItem[] = res?.data || []
    photos.sort((a, b) => dayjs(b.created_at).valueOf() - dayjs(a.created_at).valueOf())
    allPhotos.value = photos
  } catch {
    allPhotos.value = []
  } finally {
    loading.value = false
  }
}

async function onImageError(item: PhotoItem) {
  item._imgFailed = true
}

onMounted(async () => {
  if (!pregnancyStore.currentPregnancy) {
    await pregnancyStore.fetchActivePregnancy()
  }
  if (pregnancyStore.isActive) loadPhotos()
})
</script>

<style scoped>
.album-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 16px;
}

.album-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.album-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

/* 相册分类 Tab */
.album-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.album-tab {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  background: var(--bg-color, #f8fafc);
  border: 1px solid var(--border-color, #e2e8f0);
  white-space: nowrap;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}
.album-tab.active {
  background: var(--primary-color, #c44680);
  border-color: var(--primary-color, #c44680);
  color: white;
}

/* 上传分类选择 */
.photo-type-select {
  display: flex;
  gap: 8px;
}
.pt-option {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border-color, #e2e8f0);
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}
.pt-option.selected {
  background: var(--primary-color, #c44680);
  border-color: var(--primary-color, #c44680);
  color: white;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  color: var(--text-secondary, #64748b);
  margin-bottom: 24px;
}

/* 时间线容器 */
.timeline-container {
  position: relative;
}

.timeline-month {
  margin-bottom: 8px;
}

.month-header {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
  padding: 12px 0 8px;
  border-bottom: 2px solid var(--border-color, #e2e8f0);
  margin-bottom: 8px;
}

/* 时间线项目 */
.timeline-item {
  display: flex;
  gap: 16px;
  min-height: 80px;
}

/* 左侧时间轴 */
.timeline-axis {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 24px;
  flex-shrink: 0;
  position: relative;
}

.axis-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  background: var(--border-color, #e2e8f0);
  transform: translateX(-50%);
}

.axis-dot {
  position: relative;
  z-index: 1;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--primary-color, #c44680);
  border: 2px solid white;
  box-shadow: 0 0 0 2px var(--primary-color, #c44680);
  margin-top: 24px;
  flex-shrink: 0;
}

.axis-dot.dot-video {
  background: var(--stage-mid-color, #4FC3F7);
  box-shadow: 0 0 0 2px var(--stage-mid-color, #4FC3F7);
}

/* 右侧内容卡片 */
.timeline-card {
  flex: 1;
  background: var(--bg-card, white);
  border-radius: var(--radius-lg, 12px);
  padding: 12px;
  margin-bottom: 12px;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
  transition: transform 0.2s;
}

.timeline-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
}

.card-date {
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
  margin-bottom: 8px;
}

.card-media {
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  max-width: 300px;
}

.media-thumb {
  width: 100%;
  max-height: 240px;
  object-fit: cover;
  border-radius: 8px;
  display: block;
}

.video-thumb-wrapper {
  position: relative;
}

.video-play-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  transition: background 0.2s;
}

.video-play-overlay:hover {
  background: rgba(0, 0, 0, 0.35);
}

.play-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #333;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.card-note {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  margin-top: 8px;
  line-height: 1.5;
}

/* 上传表单 */
.file-input {
  margin-bottom: 8px;
}

.file-name {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  margin-top: 4px;
}

/* 响应式 */
@media (max-width: 768px) {
  .album-view { padding: 8px; }
  .album-header { margin-bottom: 12px; }
  .album-title { font-size: 17px; }
  .album-tabs { gap: 4px; }
  .album-tab { padding: 5px 10px; font-size: 12px; }
  .card-media { max-width: 100%; }
  .media-thumb { max-height: 160px; }
  .timeline-item { gap: 8px; }
  .month-header { font-size: 14px; }
  .card-date { font-size: 12px; }
}
</style>
