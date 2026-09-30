/** 孕程记 - 全局应用状态 Store。 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false)
  const initialized = ref(false)

  // ===== 深色模式 =====
  // themeMode：用户选择（浅色 / 深色 / 跟随系统）。实际是否深色由 App.vue 按
  // 「mode==='dark' 或 (mode==='system' 且系统偏好深色)」算 effectiveDark 后落到 DOM。
  // ⚠️ 持久化到 localStorage：刷新后不丢；首次进入读不到时默认 'system'（跟系统走最省心）。
  type ThemeMode = 'light' | 'dark' | 'system'
  const THEME_KEY = 'pj-theme-mode'
  const readStored = (): ThemeMode => {
    try {
      const v = localStorage.getItem(THEME_KEY)
      if (v === 'light' || v === 'dark' || v === 'system') return v
    } catch { /* 隐私模式 / 无 localStorage 时静默回落 */ }
    return 'system'
  }
  const themeMode = ref<ThemeMode>(readStored())

  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode
    try { localStorage.setItem(THEME_KEY, mode) } catch { /* 同上 */ }
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setInitialized(value: boolean) {
    initialized.value = value
  }

  return {
    sidebarCollapsed,
    initialized,
    themeMode,
    setThemeMode,
    toggleSidebar,
    setInitialized,
  }
})
