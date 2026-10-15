<template>
  <div class="summary-card">
    <div class="sm-head">
      <span class="sm-title">
        <span class="sm-dot" :style="{ background: color }"></span>{{ title }}
      </span>
      <span class="sm-days">{{ days }} 天有记录</span>
    </div>

    <div v-if="rows.length" class="sm-rows">
      <div v-for="r in rows" :key="r.label" class="sm-row">
        <span class="sm-label" :title="r.label">{{ r.label }}</span>
        <span class="sm-bar">
          <span class="sm-bar-fill" :style="{ width: r.percent + '%', background: color }"></span>
        </span>
        <span class="sm-count">{{ r.count }}</span>
      </div>
    </div>
    <div v-else class="sm-hint">
      记了 {{ days }} 天（这类多为自由文字，不做取值分布）
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 统计页的「汇总卡」——给**文字 / 选项型**记录用的卡片。
 *
 * 【为什么需要它】统计页原有 13 张 MetricCard 全是「数值 + 曲线」，而水肿、症状、
 * 分泌物、皮肤、排尿、便便、饮食备注、营养补充、用药、好习惯、心情、计划、爱爱
 * 这 13 类根本没有数值可画 —— 结果是「记录页能录、列表能看、统计里完全不可见」。
 * 这些类别的价值在**频次与分布**（这个月吐了几次、水肿大多是什么程度），不是趋势线。
 *
 * ⚠️ 刻意不做的事：不解析 JSON 结构去画更花的图。这些字段里混着
 *   `[{name}]` / `{count}` / 纯文本三种形状，按形状分支写死很容易在数据变形状时静默算错。
 *   统一口径（有记录的天数 + 可枚举取值的频次）永远不会给出**错误**的数字。
 */
defineProps<{
  title: string
  color: string
  /** 有记录的天数 */
  days: number
  /** 取值分布（已算好百分比、已排序）；空数组表示这类没有可枚举取值 */
  rows: { label: string; count: number; percent: number }[]
}>()
</script>

<style scoped>
.summary-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color-soft, #e2e8f0);
  border-radius: var(--radius-lg, 14px);
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 12px;
}
.sm-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 12px;
}
.sm-title {
  font-size: 15px; font-weight: 600; color: var(--text-color, #1e293b);
  display: flex; align-items: center; gap: 8px;
}
.sm-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sm-days { font-size: 13px; color: var(--text-secondary, #64748b); font-variant-numeric: tabular-nums; }
.sm-rows { display: flex; flex-direction: column; gap: 8px; }
.sm-row { display: flex; align-items: center; gap: 10px; }
.sm-label {
  width: 84px; flex: none; font-size: 13px; color: var(--text-secondary, #64748b);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sm-bar {
  flex: 1; height: 8px; border-radius: 4px; overflow: hidden;
  background: var(--bg-color-2, #f1f5f9);
}
.sm-bar-fill { display: block; height: 100%; border-radius: 4px; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
.sm-count {
  width: 32px; flex: none; text-align: right; font-size: 13px;
  color: var(--text-color, #1e293b); font-variant-numeric: tabular-nums;
}
.sm-hint { font-size: 13px; color: var(--text-hint, #94a3b8); }
</style>
