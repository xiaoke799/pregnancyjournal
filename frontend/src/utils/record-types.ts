/**
 * 记录类别元数据（icon / label / color / addable）—— **唯一真源**。
 *
 * 【为什么抽出来】这份数组原本只存在于 RecordList.vue 内部，而统计页
 * `StatsView/StatsPanel.vue` 的 MetricCard 也要用同一个类目色 ⇒ 运动色在两边各写一遍
 * （`#22c55e`），改一处忘一处就会两页配色不一致。现在统一从这里取。
 *
 * ⚠️ 新增记录类型时：这里加一行即可，顶部菜单（RecordView）、记录列表（RecordList）、
 *    统计页（StatsPanel）三处都读同一份，不会再有「加了类型但某处没有入口」的事
 *    （用药类型当初就是三处全漏，数据通路齐了却录不进去）。
 */

export interface CategoryDef {
  type: string
  icon: string
  label: string
  color: string
  addable: boolean
  badge?: string
  badgeColor?: string
}

export const allCategories: CategoryDef[] = [
  { type: 'weight', icon: 'weight', label: '体重', color: '#a78bfa', addable: true },
  { type: 'blood_pressure', icon: '🩺', label: '血压', color: '#ef4444', addable: true },
  { type: 'fetal_movement', icon: '🦶', label: '胎动', color: '#a78bfa', addable: true },
  { type: 'contraction', icon: 'timer', label: '宫缩', color: '#f43f5e', addable: true },
  { type: 'fetal_heart_rate', icon: 'heart', label: '测胎心', color: '#f472b6', addable: true },
  { type: 'temperature', icon: 'thermometer', label: '体温', color: '#ef4444', addable: true },
  // 三围（胸/腰/臀）：与 RecordView 顶部「＋ 添加记录」菜单保持一致。
  // 【历史问题】腰围当初只加进了那个小菜单，没加到本列表，用户在记录页主入口根本看不到它。
  { type: 'waist', icon: '📏', label: '三围', color: '#14b8a6', addable: true },
  { type: 'edema', icon: '🦵', label: '水肿', color: '#0ea5e9', addable: true },
  { type: 'symptoms', icon: 'clipboard', label: '症状', color: '#34d399', addable: true },
  { type: 'discharge', icon: '💧', label: '分泌物', color: '#06b6d4', addable: true },
  { type: 'skin', icon: '✨', label: '皮肤状况', color: '#d946ef', addable: true },
  { type: 'urination', icon: '🚻', label: '排尿情况', color: '#22d3ee', addable: true },
  { type: 'stool', icon: '💩', label: '便便', color: '#a3e635', addable: true },
  { type: 'sleep', icon: '😴', label: '睡眠', color: '#818cf8', addable: true },
  { type: 'water', icon: '💧', label: '饮水', color: '#38bdf8', addable: true },
  { type: 'diet', icon: '🍎', label: '饮食备注', color: '#fb923c', addable: true },
  { type: 'exercise', icon: '🏃', label: '运动', color: '#22c55e', addable: true },
  { type: 'supplement', icon: '💊', label: '营养补充', color: '#06b6d4', addable: true },
  // 用药：2026-09-29 补。此前这一类**完全没有入口**（顶部菜单/记录列表/quickAdd 三处都漏了），
  // 而它的数据通路一直是齐的 —— 列表里本就有 hasDataForType/getPreview 的 medication 分支，
  // 只是永远没有类别能命中它，那两段代码等于死代码。
  { type: 'medication', icon: '💊', label: '用药', color: '#9333ea', addable: true },
  { type: 'habit', icon: '✅', label: '好习惯', color: '#6366f1', addable: true },
  { type: 'blood_glucose', icon: '🩸', label: '孕期血糖', color: '#f59e0b', addable: true },
  { type: 'hcg', icon: '🧬', label: 'hCG', color: '#8b5cf6', addable: true },
  { type: 'uric_acid', icon: '🧪', label: '尿酸', color: '#ec4899', addable: true },
  { type: 'mood', icon: '😊', label: '心情', color: '#f87171', addable: true },
  { type: 'plan', icon: '📌', label: '计划', color: '#14b8a6', addable: true },
  { type: 'intimacy', icon: '💑', label: '爱爱', color: '#f43f5e', addable: true },
]

/** 取某个类型的类目色；未知类型返回中性色（别让页面因为一个脏 type 就崩）。 */
export function categoryColor(type: string): string {
  const c = allCategories.find((x) => x.type === type)
  return c ? c.color : '#94a3b8'
}

/** 取某个类型的完整元数据（label/icon 等）；未知类型返回 null，由调用方兜底。 */
export function categoryOf(type: string): CategoryDef | null {
  return allCategories.find((x) => x.type === type) || null
}
