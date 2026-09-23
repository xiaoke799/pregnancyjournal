/** 孕程记 - 照片/视频上传 Hook。 */

import { ref } from 'vue'
import { photoApi } from '@/api/photo'

export function usePhotoUpload() {
  const uploading = ref(false)
  const progress = ref(0)

  async function upload(
    file: File,
    pregnancyId: string,
    photoType: string,
    options: {
      gestationalWeek?: number
      gestationalDay?: number
      milestoneType?: string
      checkupId?: string
      note?: string
      mediaType?: string
    } = {}
  ) {
    uploading.value = true
    progress.value = 0

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('pregnancy_id', pregnancyId)
      formData.append('photo_type', photoType)
      // 自动判断媒体类型
      const isVideo = file.type.startsWith('video/')
      formData.append('media_type', options.mediaType || (isVideo ? 'video' : 'photo'))
      if (options.gestationalWeek != null) formData.append('gestational_week', String(options.gestationalWeek))
      if (options.gestationalDay != null) formData.append('gestational_day', String(options.gestationalDay))
      if (options.milestoneType) formData.append('milestone_type', options.milestoneType)
      if (options.checkupId) formData.append('checkup_id', options.checkupId)
      if (options.note) formData.append('note', options.note)

      const res: any = await photoApi.upload(formData)
      progress.value = 100
      return res
    } finally {
      uploading.value = false
    }
  }

  return { uploading, progress, upload }
}
