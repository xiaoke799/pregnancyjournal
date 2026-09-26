<script setup lang="ts">
/**
 * 通用线性 SVG 图标。
 * 用于替换界面上「结构性位置」的表情符号（搜索框、删除按钮、文件类型标记等）。
 * 描边图形不会像彩色 emoji 那样被 Android WebView 的深色模式强制反色。
 *
 * 用法：<AppIcon name="search" :size="16" />
 * 新增图标：往 ICONS 里加一条即可（path 数据基于 24x24 视框）。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 图标名，见下方 ICONS */
    name: string
    /** 边长，单位 px；也可传字符串如 '1em' */
    size?: number | string
    /** 描边粗细 */
    stroke?: number | string
  }>(),
  { size: 16, stroke: 2 }
)

const ICONS: Record<string, string[]> = {
  // 放大镜：搜索框前缀
  search: [
    'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
    'M21 21l-4.35-4.35',
  ],
  // 叉号：关闭 / 删除条目
  close: ['M18 6L6 18M6 6l12 12'],
  // 垃圾桶：删除
  trash: [
    'M3 6h18',
    'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
    'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
    'M10 11v6M14 11v6',
  ],
  // 显示器：从 NAS 选择
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  // 文件夹：目录 / 可读写
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  // 文件：普通文件
  file: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    'M14 2v6h6',
  ],
  // 锁：只读 / 无权限
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  // 铅笔：新建 / 编辑
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  // 相机：照片占位
  camera: [
    'M3 8a2 2 0 0 1 2-2h2l1.6-2.4h6.8L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  ],
  // 摄影机：视频占位
  video: ['M23 7l-7 5 7 5V7z', 'M14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z'],
  // 图片：无法预览的兜底
  image: [
    'M3 5h18v14H3z',
    'M8.5 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z',
    'M21 15l-5-5L5 21',
  ],
  // 书：日记本 / 导出 PDF
  book: [
    'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z',
    'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  ],

  // ===== 记录类型（首页快速记录入口，跨 6 个文件共用同一套名字）=====
  // 天平：体重
  weight: ['M12 3v18', 'M5 21h14', 'M8 7h8', 'M8 7 4 14h8L8 7z', 'M16 7l-4 7h8z'],
  // 心形：胎心
  heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'],
  // 温度计：体温
  thermometer: ['M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z'],
  // 秒表：宫缩
  timer: ['M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 10v4', 'M9 2h6'],
  // 剪贴板：症状 / 记录清单
  clipboard: [
    'M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2',
    'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
    'M8 13h8M8 17h5',
  ],
  // 对勾：已完成徽章
  check: ['M20 6L9 17l-5-5'],
}

const paths = computed(() => ICONS[props.name] || [])

// 兜底：字典里没有这个名字时，把 name 当**文本内容**渲染。
// 存在的意义：界面上有一批「内容型」图标（记录类型的心情、症状、便便、服药、运动…），
// 用彩色符号比线稿更容易一眼认出，所以它们不进 ICONS，直接带原始字符进来。
// ⚠️ 之前没有这层兜底 —— 字典未命中就渲染空 SVG，
// 结果记录页一大片格子是空白（填上钻井符号的位置全都空了）。
const isGlyph = computed(() => paths.value.length === 0 && !!props.name)
const glyphStyle = computed(() => ({
  fontSize: typeof props.size === 'number' ? `${props.size}px` : props.size,
}))
</script>

<template>
  <svg
    v-if="paths.length"
    class="app-icon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    :stroke-width="stroke"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
  <span
    v-else-if="isGlyph"
    class="app-icon app-icon-glyph"
    :style="glyphStyle"
    aria-hidden="true"
  >{{ name }}</span>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  vertical-align: -0.15em;
}

/* 内容型符号（如心情、症状）走文本渲染，不需要描边属性 */
.app-icon-glyph {
  fill: none;
  stroke: none;
  line-height: 1;
  text-align: center;
  vertical-align: -0.15em;
}
</style>
