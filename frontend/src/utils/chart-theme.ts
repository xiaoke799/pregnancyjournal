/**
 * 图表（ECharts）配色 —— 深色模式专用。
 *
 * 【为什么需要它】
 * 图表是 canvas 渲染的，**不吃 CSS 变量**：`variables.css` 里 `html.dark` 那一套
 * 再全，也影响不到画在画布上的坐标轴、刻度文字、提示框。以前这些颜色是直接硬写在
 * option 里的亮色值（轴 `#e2e8f0`、刻度 `#94a3b8`、提示框白底深字），深色模式下
 * 就变成「深字压深底」—— 看不见。
 *
 * 【口径】
 * - 只管**中性色与文字色**（轴、网格线、刻度、图例、提示框、缩放条手柄）。
 *   数据系列色（紫 #AB47BC、粉 #E8A0BF 等）本身在深底上可读，保持原样，不在这里翻。
 * - 取值与 `variables.css` 的 `html.dark` 对齐（卡片 #1a1730 / 浮层 #221d3b /
 *   边框 #2c2640 / 分隔线 #251f3a / 文字 #ece9f3 / 次要 #b6afc7 / 弱化 #8a83a0）。
 *
 * 用法：在 computed 里 `const p = chartPalette(appStore.effectiveDark)`，
 *       这样主题一变图表会自动重算并重绘。
 */
export interface ChartPalette {
  /** 提示框底色 */
  tooltipBg: string
  /** 提示框边框 */
  tooltipBorder: string
  /** 提示框文字 */
  tooltipText: string
  /** 图例文字 */
  legendText: string
  /** 刻度文字（x/y 轴） */
  axisLabel: string
  /** 坐标轴线 */
  axisLine: string
  /** 网格分隔线 */
  splitLine: string
  /** 缩放条手柄填充 */
  zoomHandle: string
  /** 缩放条手柄描边 */
  zoomHandleBorder: string
  /** 缩放条拖动手柄 */
  zoomMoveHandle: string
  /** 图表内普通说明文字 */
  text: string
  /** 弱化的说明文字 */
  textWeak: string
}

const LIGHT: ChartPalette = {
  tooltipBg: 'rgba(255,255,255,.95)',
  tooltipBorder: '#e2e8f0',
  tooltipText: '#1e293b',
  legendText: '#64748b',
  axisLabel: '#94a3b8',
  axisLine: '#e2e8f0',
  splitLine: '#f1f5f9',
  zoomHandle: '#fff',
  zoomHandleBorder: '#c44680',
  zoomMoveHandle: '#e8d9e3',
  text: '#888',
  textWeak: '#999',
}

const DARK: ChartPalette = {
  tooltipBg: 'rgba(34,29,59,.95)', // #221d3b
  tooltipBorder: '#2c2640',
  tooltipText: '#ece9f3',
  legendText: '#b6afc7',
  axisLabel: '#8a83a0',
  axisLine: '#2c2640',
  splitLine: '#251f3a',
  zoomHandle: '#221d3b',
  zoomHandleBorder: '#f0a6c8',
  zoomMoveHandle: '#2c2640',
  text: '#b6afc7',
  textWeak: '#8a83a0',
}

export function chartPalette(dark: boolean): ChartPalette {
  return dark ? DARK : LIGHT
}
