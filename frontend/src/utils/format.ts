/** 孕程记 - 格式化工具。 */
import dayjs from 'dayjs'

/**
 * 判断一个值是不是**真实存在**的 `YYYY-MM-DD` 日期字符串 —— 全项目唯一真源。
 *
 * 🔴 为什么不能直接写 `dayjs(s, 'YYYY-MM-DD', true).isValid()`：
 *    本项目**没有** `dayjs.extend(customParseFormat)` ⇒ dayjs 会**忽略** format 与 strict 参数，
 *    退回默认解析，而默认解析对越界日期是「溢出进位」而不是判无效。实测（dayjs 1.11.21）：
 *      `2026-13-45` → 判定有效，format 出 `2027-02-14`
 *      `2026-02-30` → 判定有效，format 出 `2026-03-02`
 *      `0000-00-00` → 判定有效，format 出 `1899-11-30`
 *      `2026-12-32` → 判定有效，format 出 `2027-01-01`
 *    ⇒ 校验形同虚设：本该报错中止，实际把数据静默写到了另一个日期（比"落到今天"更隐蔽，
 *      因为用户完全不知道自己记到了哪天）。
 *
 * 所以这里用「正则定形 + 回环比对」：先要求严格 4-2-2 的数字形态，再要求 dayjs 解析回来
 * 格式化后必须**与原字符串逐字相同** —— 只要发生过溢出进位，两边就不相等，立刻被拦下。
 */
export function isValidDateStr(s: unknown): boolean {
  if (typeof s !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return dayjs(s).format('YYYY-MM-DD') === s
}

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

/**
 * 睡眠质量：取值域 + 归一 + 文案的**唯一真源**。
 *
 * 【为什么必须收敛】`sleep_quality` 这个字段曾经有两套取值域：
 *   - 记录页的快捷小弹窗写**中文**（好 / 一般 / 差）
 *   - 「添加记录」大弹窗写**英文**（good / fair / poor），而且它读的时候会把中文转成英文再写回
 * ⇒ 用户点开「睡眠」编辑一下、**什么都不改直接保存**，库里的值就从「好」悄悄变成「good」；
 *   而各处的展示口径又不一样（记录列表和首页做了双语归一，统计面板是原样渲染）——
 *   于是同一列里中英文混排，导出里也是。
 *
 * 现在统一为：**存储一律英文**（与内部判定、大弹窗一致），**展示一律走 `sleepQualityLabel()`**。
 * 历史中文值不需要迁移：`normalizeSleepQuality()` 认两套，读的时候自动归一。
 */
export const SLEEP_QUALITY_VALUES = ['good', 'fair', 'poor'] as const
export type SleepQuality = (typeof SLEEP_QUALITY_VALUES)[number]

/** 历史中文取值 → 规范英文取值。 */
const SLEEP_QUALITY_FROM_ZH: Record<string, SleepQuality> = {
  好: 'good',
  一般: 'fair',
  差: 'poor',
}

/**
 * 把任意历史取值归一成规范英文取值。
 * 空值/认不出来的值返回 `''` —— **由调用方决定兜底**，不要在这里悄悄编一个默认值
 * （历史上首页就是这么把「没记质量」显示成「一般」的）。
 */
export function normalizeSleepQuality(q: unknown): SleepQuality | '' {
  if (q == null) return ''
  const s = String(q).trim()
  if (!s) return ''
  if ((SLEEP_QUALITY_VALUES as readonly string[]).includes(s)) return s as SleepQuality
  return SLEEP_QUALITY_FROM_ZH[s] || ''
}

/** 规范英文取值 → 中文标签。空值/认不出来返回空串（不凭空显示「一般」）。 */
export function sleepQualityLabel(q: unknown): string {
  switch (normalizeSleepQuality(q)) {
    case 'good': return '好'
    case 'fair': return '一般'
    case 'poor': return '差'
    default: return ''
  }
}

/**
 * 睡眠质量选择器选项（值 = 规范英文，文案 = 中文）。
 * 小弹窗与大弹窗都从这里取，保证写进库的是同一套值 —— 这是防止再次分裂的关键。
 */
export const SLEEP_QUALITY_OPTIONS: { value: SleepQuality; label: string }[] = [
  { value: 'poor', label: '差' },
  { value: 'fair', label: '一般' },
  { value: 'good', label: '好' },
]

/** 宫缩疼痛程度的取值域（唯一真源；两处 UI 的取值由回归脚本据此断言）。 */
export const CONTRACTION_PAIN_VALUES = ['无感', '轻微', '明显', '剧烈'] as const
export type ContractionPain = (typeof CONTRACTION_PAIN_VALUES)[number]

/**
 * 宫缩疼痛程度：历史取值归一（**读时归一，不迁移存量**）。
 *
 * 【背景】取值域 2026-09-29 由「轻微/中度/剧烈」调整为「无感/轻微/明显/剧烈」（与记录页小弹窗统一），
 * 「中度」被移除。但**库里老记录仍存着「中度」**，直接回填进下拉框会因为匹配不上任何选项
 * 而显示成一串裸文本（用户看不懂，还以为是脏数据）。
 * 这里把历史「中度」映射为语义最接近的「明显」：用户不改动直接保存 ⇒ 顺带收敛到新值域；
 * 改了 ⇒ 以用户选择为准。认不出来的值返回 ''，由调用方决定兜底（不在这里凭空造默认值）。
 */
const CONTRACTION_PAIN_LEGACY: Record<string, ContractionPain> = { 中度: '明显' }
export function normalizeContractionPain(p: unknown): ContractionPain | '' {
  if (p == null) return ''
  const s = String(p).trim()
  if (!s) return ''
  if ((CONTRACTION_PAIN_VALUES as readonly string[]).includes(s)) return s as ContractionPain
  return CONTRACTION_PAIN_LEGACY[s] || ''
}

/**
 * 运动「强度感受」取值域（唯一真源）。
 *
 * 【背景】记录页的运动快捷弹窗一直有「强度感受」单选项，但 saveExercise() 从来没把它
 * 提交给后端（库里也没有这一列）—— **用户选了等于白选**，保存后什么都不剩。
 * 现在补上 exercise_intensity 列，并把取值域收在这里：记录页小弹窗与「添加记录」大弹窗
 * 都从这里取，避免再次各写一份而漂移（铁律 #10）。
 *
 * ⚠️ 与睡眠质量不同，这里**不设默认值**：用户没点就存空，不替他"顺手"记一个「轻松」
 * （历史取值只有这三项，无历史脏值需要归一）。
 */
export const EXERCISE_INTENSITY_VALUES = ['轻松', '中等', '较累'] as const
export type ExerciseIntensity = (typeof EXERCISE_INTENSITY_VALUES)[number]
export const EXERCISE_INTENSITY_OPTIONS: { value: ExerciseIntensity; label: string }[] =
  EXERCISE_INTENSITY_VALUES.map((v) => ({ value: v, label: v }))
