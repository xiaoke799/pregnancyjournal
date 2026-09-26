<template>
  <div class="stats-view">
    <StatsPanel size="page" />
  </div>
</template>

<script setup lang="ts">
/**
 * 独立「统计」页 —— 只负责套一层页面外壳（最大宽度 / 内边距）。
 * 卡片清单、时段切换、汇总数字全部来自 views/StatsView/StatsPanel.vue，
 * 与记录页的「统计」标签共用同一份实现。
 *
 * ⚠️ 历史上这里是另一份 240 行的复制粘贴代码（同样 12 张卡各自写死），
 *    与记录页那份互相漂移；已统一收进 StatsPanel，新增指标只改那一处。
 */
import StatsPanel from './StatsView/StatsPanel.vue'
</script>

<style scoped>
.stats-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 16px;
  min-height: 100%;
}

/* 移动端 */
@media (max-width: 768px) {
  .stats-view { padding: 10px; }
}
</style>
