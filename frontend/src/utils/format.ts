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

/**
 * 心情分（1~5）→ emoji 的**唯一真源**。
 *
 * 【为什么必须收敛到一处】这份映射曾经在 6 个文件里各抄了一份，
 * 结果抄着抄着就漂移了：首页用的是 ['😕','🙂']，其它页面用的是 ['😔','😊'] ——
 * 同一个心情分，在首页和日记页显示的脸不一样。
 * 凡是"多处必须保持一致"的字面量，都该有一个唯一出处，否则必然漂移。
 *
 * 下标即分值，第 0 位空着（心情分从 1 开始）。
 */
export const MOOD_EMOJIS = ['', '😢', '😔', '😐', '😊', '😄'] as const

/**
 * 取心情对应的 emoji。没填心情（null / undefined / 0 / 非法值）时返回 fallback。
 *
 * @param fallback 未填心情时的兜底显示。**默认空字符串**：没记录心情就不该凭空
 *   显示一张脸。个别页面历史上用了固定兜底（如 '😐'），为保持原有观感可显式传入。
 */
export function getMoodEmoji(
  mood: number | string | null | undefined,
  fallback = '',
): string {
  const n = typeof mood === 'string' ? Number(mood) : mood
  if (!n || Number.isNaN(n)) return fallback
  return MOOD_EMOJIS[n] || fallback
}

export interface MoodOption {
  value: number
  emoji: string
  label: string
}

/**
 * 心情选择器的选项（分值 / emoji / 文案）。
 *
 * 这段数组此前在「记录弹窗」「记录页」「日记页」各抄了一份，内容完全一样 ——
 * 三份同时存在就意味着以后改文案得改三处，漏一处就又不一致了。
 * emoji 直接取自 MOOD_EMOJIS，从根上避免再出现字符漂移。
 */
export const MOOD_OPTIONS: MoodOption[] = [
  { value: 1, emoji: MOOD_EMOJIS[1], label: '很差' },
  { value: 2, emoji: MOOD_EMOJIS[2], label: '不好' },
  { value: 3, emoji: MOOD_EMOJIS[3], label: '一般' },
  { value: 4, emoji: MOOD_EMOJIS[4], label: '不错' },
  { value: 5, emoji: MOOD_EMOJIS[5], label: '很好' },
]
