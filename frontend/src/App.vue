<template>
  <n-message-provider>
    <router-view v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </router-view>
  </n-message-provider>
</template>

<script setup lang="ts">
import { onErrorCaptured } from 'vue'
import { NMessageProvider } from 'naive-ui'

// 全局错误捕获：防止子组件错误导致整个应用崩溃无法导航
onErrorCaptured((err, instance, info) => {
  console.error('[App ErrorBoundary]', err, info)
  // 返回 false 阻止错误继续向上传播，保持应用可用
  return false
})
</script>

<style>
#app {
  width: 100%;
  height: 100vh;
}
</style>
