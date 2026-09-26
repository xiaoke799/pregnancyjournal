<template>
  <div class="album-view">
    <!-- 顶部操作栏 -->
    <div class="album-header">
      <h2 class="album-title">孕期相册</h2>
      <n-button type="primary" size="small" @click="showUploadDialog = true">上传</n-button>
    </div>

    <!-- 相册分类 Tab -->
    <div class="album-tabs">
      <div v-for="tab in albumTabs" :key="tab.key"
        class="album-tab" :class="{ active: activeAlbumTab === tab.key }"
        @click="activeAlbumTab = tab.key">{{ tab.icon }} {{ tab.label }}</div>
    </div>

    <!-- 空状态 -->
    <div v-if="filteredPhotos.length === 0 && !loading" class="empty-state">
      <div class="empty-icon"><AppIcon name="camera" :size="48" /></div>
      <div class="empty-text">记录你珍贵的孕期时光</div>
      <n-button type="primary" @click="showUploadDialog = true">上传第一张照片</n-button>
      <div class="empty-hint">支持 JPG、PNG、WebP、GIF、BMP、HEIC/HEIF 与常见视频格式</div>
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
            <div class="card-media" @click="previewItem(item)">
              <!-- 照片 -->
              <img
                v-if="item.media_type !== 'video' && !item._imgFailed"
                :src="thumbnailUrl(item.id)"
                :alt="item.note || ''"
                class="media-thumb"
                @error="onImageError(item)"
              />
              <div
                v-else-if="item.media_type !== 'video' && item._imgFailed"
                class="media-thumb media-fallback"
                title="无法预览：文件缺失，或该格式浏览器不支持（如 TIFF）"
              >
                <AppIcon name="camera" :size="32" />
              </div>
              <!-- 视频缩略图：后端不做视频抽帧，直接让浏览器渲染首帧（#t 让浏览器去取那一帧） -->
              <div v-else class="video-thumb-wrapper">
                <video
                  v-if="!item._videoFailed"
                  :src="fileUrl(item.id) + '#t=0.5'"
                  class="media-thumb"
                  preload="metadata"
                  muted
                  playsinline
                  @error="onVideoError(item)"
                ></video>
                <div
                  v-else
                  class="media-thumb media-fallback"
                  title="无法预览：该视频编码浏览器不支持（常见于 iPhone 的 HEVC）"
                >
                  <AppIcon name="video" :size="32" />
                </div>
                <div class="video-play-overlay">
                  <div class="play-icon">▶</div>
                </div>
              </div>
            </div>
            <div class="card-text">
              <div class="card-date">{{ formatDate(item.created_at) }} · 孕{{ item.gestational_week || '?' }}周</div>
              <div v-if="item.note" class="card-note">{{ item.note }}</div>
              <div class="card-actions">
                <button class="card-action-btn" @click.stop="editPhoto(item)">编辑</button>
                <button class="card-action-btn card-action-del" @click.stop="confirmDeletePhoto(item)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 上传对话框 -->
    <n-modal
      v-model:show="showUploadDialog"
      preset="card"
      title="上传照片/视频"
      style="max-width: 480px; width: 95vw;"
      :mask-closable="true"
    >
      <div style="padding: 8px 0;">
        <n-form label-placement="top">
          <n-form-item label="选择文件">
            <!-- ⚠️ 这里必须包一层纵向容器：n-form-item 的内容区是横向 flex，
                 把格式说明和文件框平铺在一起的话，说明会被挤成一条 63px 宽的
                 "竖排文字"（手机端实测），整块还把对话框顶出屏幕 —— 就是用户
                 反馈的「提示撑大页面」。包起来后各占一行，宽度跟随对话框。 -->
            <div class="file-col">
              <input
                ref="fileInputRef"
                type="file"
                accept="image/*,video/*"
                class="file-input"
                @change="onFileSelect"
              />
              <div v-if="uploadFile" class="file-name">{{ uploadFile.name }}（{{ fileSizeText }}）</div>
              <!-- 上传中的进度反馈（用户实测反馈：点「上传」后毫无变化，像没反应。
                   视频常有几十 MB，必须有可见的"在传、传到哪了"，否则会被当成卡死） -->
              <div v-if="uploading" class="upload-progress">
                <n-progress type="line" :percentage="uploadProgress" :height="8" :border-radius="4"
                  color="#c44680" rail-color="#f1ebf2" :show-indicator="false" />
                <div class="upload-progress-text">正在上传 {{ uploadProgress }}% —— 视频较大时请稍等，不要关闭页面</div>
              </div>
              <div class="format-hint">
                <div><span class="fh-label">照片</span>JPG、PNG、WebP、GIF、BMP、HEIC/HEIF —— iPhone 拍的 HEIC 会自动转成 JPG 保存（原图保留）</div>
                <div><span class="fh-label">视频</span>MP4、MOV、WebM、M4V 等常见格式，单个文件最大 100MB</div>
                <div class="fh-muted">iPhone 录的 HEVC 视频（.MOV）在电脑浏览器上放不出来，手机上或下载后可正常观看；TIFF 图片暂不支持（浏览器无法预览）</div>
              </div>
            </div>
          </n-form-item>
          <n-form-item label="分类">
            <div class="photo-type-select">
              <span v-for="pt in photoTypeOptions" :key="pt.key"
                class="pt-option" :class="{ selected: uploadPhotoType === pt.key }"
                @click="uploadPhotoType = pt.key">{{ pt.icon }} {{ pt.label }}</span>
            </div>
          </n-form-item>
          <n-form-item label="日期">
            <input
              type="date"
              class="album-date-input"
              :value="uploadDate"
              @input="uploadDate = ($event.target as HTMLInputElement).value"
            />
          </n-form-item>
          <n-form-item label="描述">
            <n-input v-model:value="uploadNote" type="textarea" :rows="2" placeholder="添加描述（可选）" />
          </n-form-item>
        </n-form>
      </div>
      <template #action>
        <n-button @click="showUploadDialog = false">取消</n-button>
        <n-button type="primary" :disabled="!uploadFile" :loading="uploading" @click="handleUploadSubmit">上传</n-button>
      </template>
    </n-modal>

    <!-- 照片全屏预览 -->
    <n-modal v-model:show="showImagePreview" preset="card" :style="{ maxWidth: '90vw', maxHeight: '90vh' }" :closable="true">
      <div style="text-align: center;">
        <img
          v-if="!imagePreviewFailed"
          :src="previewImageUrl"
          style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px;"
          @error="imagePreviewFailed = true"
        />
        <div v-else style="padding: 32px 16px; color: #64748b; font-size: 14px; line-height: 1.8;">
          <div style="margin-bottom: 8px;"><AppIcon name="image" :size="32" /></div>
          <div>这个文件无法在浏览器里预览</div>
          <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">可能是文件已丢失，或该格式浏览器不支持（如 TIFF）</div>
          <a :href="previewImageUrl" download style="display: inline-block; margin-top: 12px; color: #7c3aed;">下载原文件</a>
        </div>
        <div v-if="previewItemData" style="margin-top: 16px; text-align: left; padding: 12px; background: #f8fafc; border-radius: 8px;">
          <div style="font-weight: 600; margin-bottom: 8px;">{{ previewItemData.dateText }} · 孕{{ previewItemData.week || '?' }}周</div>
          <div v-if="previewItemData.note" style="color: #64748b; font-size: 14px; line-height: 1.6;">{{ previewItemData.note }}</div>
          <div style="color: #94a3b8; font-size: 12px; margin-top: 8px;">{{ previewItemData.typeLabel }}</div>
        </div>
      </div>
    </n-modal>

    <!-- 视频播放弹窗 -->
    <n-modal v-model:show="showVideoPreview" preset="card" :style="{ maxWidth: '90vw' }" :closable="true" title="视频播放">
      <video
        v-if="showVideoPreview && !videoPreviewFailed"
        :src="previewVideoUrl"
        controls
        autoplay
        @error="videoPreviewFailed = true"
        style="width: 100%; max-height: 80vh;"
      ></video>
      <div v-else-if="videoPreviewFailed" style="padding: 24px 8px; color: #64748b; font-size: 14px; line-height: 1.8;">
        <div style="margin-bottom: 8px;"><AppIcon name="video" :size="32" /></div>
        <div>当前浏览器无法播放这个视频</div>
        <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">
          常见于 iPhone 录制的 HEVC / H.265 格式：手机上的浏览器一般能播，电脑端的 Chrome / Edge 不行。
        </div>
        <a :href="previewVideoUrl" download style="display: inline-block; margin-top: 12px; color: #7c3aed;">下载视频</a>
        <span style="font-size: 13px; color: #94a3b8;">（用手机或 VLC 等本地播放器打开）</span>
      </div>
    </n-modal>

    <!-- 编辑照片/视频对话框 -->
    <n-modal
      v-model:show="showEditDialog"
      preset="card"
      title="编辑照片信息"
      style="max-width: 480px; width: 95vw;"
      :mask-closable="true"
    >
      <div style="padding: 8px 0;">
        <n-form label-placement="top">
          <n-form-item label="日期">
            <input
              type="date"
              class="album-date-input"
              :value="editDate"
              @input="editDate = ($event.target as HTMLInputElement).value"
            />
          </n-form-item>
          <n-form-item label="分类">
            <div class="photo-type-select">
              <span v-for="pt in photoTypeOptions" :key="pt.key"
                class="pt-option" :class="{ selected: editPhotoType === pt.key }"
                @click="editPhotoType = pt.key">{{ pt.icon }} {{ pt.label }}</span>
            </div>
          </n-form-item>
          <n-form-item label="描述">
            <n-input v-model:value="editNote" type="textarea" :rows="2" placeholder="修改描述..." />
          </n-form-item>
        </n-form>
      </div>
      <template #action>
        <n-button @click="showEditDialog = false">取消</n-button>
        <n-button type="primary" @click="handleEditSave">保存</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NButton, NModal, NForm, NFormItem, NInput, NProgress, NDatePicker, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { photoApi } from '@/api/photo'
import AppIcon from '@/components/common/AppIcon.vue'
import { usePhotoUpload } from '@/composables/usePhotoUpload'
import dayjs from 'dayjs'

const pregnancyStore = usePregnancyStore()
const { uploading } = usePhotoUpload()
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
  _videoFailed?: boolean
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
const uploadDate = ref<string>(dayjs().format('YYYY-MM-DD'))
/** 上传进度（0-100），由 photoApi.upload 的 onUploadProgress 回调驱动 */
const uploadProgress = ref(0)

/** 已选文件的大小文案（选中那一刻就能看到，方便判断大视频要等多久） */
const fileSizeText = computed(() => {
  const f = uploadFile.value
  if (!f) return ''
  const mb = f.size / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`
})
const fileInputRef = ref<HTMLInputElement | null>(null)

// 照片预览
const showImagePreview = ref(false)
const previewImageUrl = ref('')
const imagePreviewFailed = ref(false)
const showVideoPreview = ref(false)
const previewVideoUrl = ref('')
const videoPreviewFailed = ref(false)
const activeAlbumTab = ref('all')
const uploadPhotoType = ref('belly')

// 编辑照片
const showEditDialog = ref(false)
const editingPhoto = ref<PhotoItem | null>(null)
const editDate = ref('')
const editNote = ref('')
const editPhotoType = ref('belly')

// 预览信息
const previewItemData = ref<{ dateText: string; week: number | null; note: string; typeLabel: string } | null>( null)

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
    videoPreviewFailed.value = false
    showVideoPreview.value = true
  } else {
    previewImageUrl.value = fileUrl(item.id)
    imagePreviewFailed.value = false
    showImagePreview.value = true
  }
  // 同时填充预览信息面板
  const typeMap: Record<string, string> = { maternity: '🤰 孕妇照', belly: '🫄 孕肚照', baby: '👶 婴儿照' }
  previewItemData.value = {
    dateText: dayjs(item.created_at).format('YYYY年MM月DD日'),
    week: item.gestational_week,
    note: item.note || '',
    typeLabel: typeMap[item.photo_type] || item.photo_type
  }
}

/** 编辑照片 */
function editPhoto(item: PhotoItem) {
  editingPhoto.value = item
  editDate.value = item.created_at.slice(0, 10)
  editNote.value = item.note || ''
  editPhotoType.value = item.photo_type
  showEditDialog.value = true
}

/** 保存编辑 */
async function handleEditSave(): Promise<boolean> {
  if (!editingPhoto.value) return false
  try {
    await photoApi.update(editingPhoto.value.id, {
      photo_date: editDate.value,
      note: editNote.value,
      photo_type: editPhotoType.value,
    })
    message.success('保存成功')
    showEditDialog.value = false
    await loadPhotos()
    return true
  } catch {
    message.error('保存失败')
    return false
  }
}

/** 确认删除照片 */
function confirmDeletePhoto(item: PhotoItem) {
  if (!confirm(`确定要删除这张${item.media_type === 'video' ? '视频' : '照片'}吗？`)) return
  deletePhoto(item)
}

/** 执行删除照片 */
async function deletePhoto(item: PhotoItem) {
  try {
    await photoApi.delete(item.id)
    message.success('删除成功')
    await loadPhotos()
  } catch {
    message.error('删除失败')
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
  // ⚠️ 这里的每个提前退出都必须给人话提示 —— 静默 return 会让用户觉得"点了没反应"
  //    （2026-09-26 用户实测：上传视频点击后毫无反馈。复现脚本 repro_album_video_upload.js：
  //      ① 无孕期档案时静默 return（请求不发、零提示）；② 上传全程按钮无 loading；
  //      ③ 超 100MB 被后端拒绝，但原因被 catch 吞掉只显示"上传失败"。）
  if (!uploadFile.value) { message.warning('请先选择要上传的文件'); return false }
  if (!pregnancyStore.currentPregnancy) {
    // 直链/刷新进来时档案可能还没加载：补取一次；仍没有则明确提示（不再静默返回）
    try { await pregnancyStore.fetchActivePregnancy() } catch { /* 下面统一提示 */ }
  }
  if (!pregnancyStore.currentPregnancy) { message.warning('请先在首页创建孕期档案，再来上传'); return false }

  const file = uploadFile.value
  // 与后端一致的上限（photo.js: multer limits.fileSize = 100MB）。
  // 超限的文件后端会拒绝，但"先传完 100MB 再被拒"对手机流量极不友好 —— 选中后立刻判、立刻说。
  const MAX_UPLOAD_MB = 100
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    message.error(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），最大支持 ${MAX_UPLOAD_MB}MB —— 请先压缩或裁剪后再上传`)
    return false
  }
  const isVideo = file.type.startsWith('video/')
  const pregnancyId = pregnancyStore.currentPregnancy.id
  const currentWeek = pregnancyStore.gestationalAge?.weeks

  uploading.value = true
  uploadProgress.value = 0
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('pregnancy_id', pregnancyId)
    formData.append('photo_type', uploadPhotoType.value)
    formData.append('media_type', isVideo ? 'video' : 'photo')
    if (currentWeek != null) formData.append('gestational_week', String(currentWeek))
    if (uploadDate.value) formData.append('photo_date', uploadDate.value)
    if (uploadNote.value) formData.append('note', uploadNote.value)

    await photoApi.upload(formData, (pct) => { uploadProgress.value = pct })
    message.success(isVideo ? '视频上传成功' : '照片上传成功')
    uploadFile.value = null
    uploadNote.value = ''
    uploadDate.value = dayjs().format('YYYY-MM-DD')
    uploadProgress.value = 0
    if (fileInputRef.value) fileInputRef.value.value = ''
    showUploadDialog.value = false
    await loadPhotos()
    return true
  } catch (e: any) {
    // 透传后端给出的真实原因（如「文件过大，最大支持 100MB」）；
    // axios 自身的英文错误（timeout / Network Error）翻译成人话，不要把原因吞成一句泛泛的失败
    const raw = String(e?.message || '')
    const msg = /timeout/i.test(raw)
      ? '上传超时（网络慢或文件较大）—— 请重试，或先压缩文件再传'
      : /network/i.test(raw)
        ? '网络中断，上传没有完成，请重试'
        : (raw || '上传失败，请重试')
    message.error(msg)
    return false
  } finally {
    uploading.value = false
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

/** 视频缩略图加载失败（编码不被浏览器支持时）→ 退化成占位图标 */
function onVideoError(item: PhotoItem) {
  item._videoFailed = true
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

.empty-hint {
  margin-top: 12px;
  font-size: 12px;
  color: #94a3b8;
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
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.timeline-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
}

.card-date {
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
  margin-bottom: 6px;
}

.card-text {
  flex: 1;
  min-width: 0;
}

.card-media {
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  width: 140px;
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
.file-col {
  /* n-form-item 内容区默认横向 flex：这里竖排，且宽度吃满对话框（防挤扁/溢出） */
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}
.file-input {
  margin-bottom: 8px;
  max-width: 100%;
}

.album-date-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}
.album-date-input:focus {
  border-color: var(--primary-color, #c44680);
  outline: none;
  box-shadow: 0 0 0 3px rgba(196, 70, 128, 0.12);
}

.file-name {
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  margin-top: 4px;
  word-break: break-all;
}

/* 上传进度（大文件/视频时给"确实在传"的反馈） */
.upload-progress {
  margin: 2px 0 8px;
}
.upload-progress-text {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  margin-top: 4px;
  overflow-wrap: anywhere;
}

/* 上传对话框里的「支持格式」说明 */
.format-hint {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: #64748b;
  /* 中英混排的长说明：允许在任意字符间断行，杜绝撑宽容器 */
  overflow-wrap: anywhere;
}
.format-hint .fh-label {
  display: inline-block;
  min-width: 34px;
  margin-right: 6px;
  color: #7c3aed;
  font-weight: 500;
}
.format-hint .fh-muted {
  color: #94a3b8;
}

/* 卡片操作按钮 */
.card-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.card-action-btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 16px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary, #64748b);
}
.card-action-btn:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.card-action-del:hover {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #dc2626;
}

/* 日期选择器在弹窗中的 z-index 修复 */
:deep(.n-date-picker) {
  z-index: 1000;
}

/* 响应式 */
@media (max-width: 768px) {
  .album-view { padding: 8px; }
  .album-header { margin-bottom: 12px; }
  .album-title { font-size: 17px; }
  .album-tabs { gap: 4px; }
  .album-tab { padding: 5px 10px; font-size: 12px; }
  /* 手机端：卡片上下布局（图片在上，文字在下）。
     整体目标：一屏能看到约两张卡片（用户反馈「页面很大、交互难」）——
     图更矮、内边距更小、时间线轴收窄，把宽度还给内容。 */
  .timeline-card { flex-direction: column; gap: 8px; padding: 10px; margin-bottom: 10px; }
  .card-media { width: 100%; max-width: none; }
  .media-thumb { max-height: 150px; width: 100%; object-fit: cover; }
  .timeline-item { gap: 6px; }
  .timeline-axis { width: 14px; }
  .axis-dot { width: 8px; height: 8px; margin-top: 18px; border-width: 1px; }
  .month-header { font-size: 14px; padding: 10px 0 6px; }
  .card-date { font-size: 12px; }
  .card-actions { margin-top: 6px; }
  .card-action-btn { padding: 4px 10px; }
  /* 空状态与提示：长英文词组（HEIC/HEIF 等）不允许撑破窄屏 */
  .empty-hint { padding: 0 12px; overflow-wrap: anywhere; }
}
</style>
