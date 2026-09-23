/** 孕程记 - 全局应用状态 Store。 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false)
  const currentTheme = ref<'light' | 'dark'>('light')
  const initialized = ref(false)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setInitialized(value: boolean) {
    initialized.value = value
  }

  return {
    sidebarCollapsed,
    currentTheme,
    initialized,
    toggleSidebar,
    setInitialized,
  }
})
