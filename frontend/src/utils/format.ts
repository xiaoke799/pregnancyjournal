/** 孕程记 - 格式化工具。 */

/** 格式化体重。 */
export function formatWeight(weight: number | null | undefined): string {
  if (weight == null) return '--'
  return `${weight.toFixed(1)} kg`
}

/** 格式化血压。 */
export function formatBloodPressure(bp: string | null | undefined): string {
  return bp || '--/--'
}

/** 格式化孕周。 */
export function formatGestationalWeek(weeks: number, days: number): string {
  return `${weeks}周${days}天`
}

/** 格式化指标状态颜色。 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'low': return '#1890FF'
    case 'high': return '#FF4D4F'
    case 'normal': return '#52C41A'
    default: return '#9CA3AF'
  }
}

/** 格式化指标状态文字。 */
export function getStatusText(status: string): string {
  switch (status) {
    case 'low': return '偏低'
    case 'high': return '偏高'
    case 'normal': return '正常'
    default: return '--'
  }
}

/** 格式化心情。 */
export function getMoodEmoji(mood: number | null | undefined): string {
  if (!mood) return ''
  const emojis = ['', '😢', '😔', '😐', '😊', '😄']
  return emojis[mood] || ''
}
