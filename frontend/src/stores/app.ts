/** 孕程记 - 全局应用状态 Store。 */

import { defineStore } from 'pinia'
import { computed, ref, onScopeDispose } from 'vue'

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

  // ===== 实际是否深色（effectiveDark）=====
  // ⚠️ 放在 store 而不是 App.vue：图表是 canvas 渲染，**不吃 CSS 变量**，
  //    必须让它们也能读到「当前是否深色」，否则深色下坐标轴/标签是深字压深底、看不见。
  //    App.vue 仍负责把这个值落到 <html> 的 dark 类上（激活 variables.css 那套变量）。
  const systemDark = ref(false)
  let themeMql: MediaQueryList | null = null
  function onThemeMql(e: MediaQueryListEvent) { systemDark.value = e.matches }

  if (typeof window !== 'undefined' && window.matchMedia) {
    themeMql = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = themeMql.matches
    // 旧浏览器没有 addEventListener → 兼容写法
    if (themeMql.addEventListener) themeMql.addEventListener('change', onThemeMql)
    else if ((themeMql as any).addListener) (themeMql as any).addListener(onThemeMql)
  }
  onScopeDispose(() => {
    if (!themeMql) return
    if (themeMql.removeEventListener) themeMql.removeEventListener('change', onThemeMql)
    else if ((themeMql as any).removeListener) (themeMql as any).removeListener(onThemeMql)
  })

  const effectiveDark = computed(() =>
    themeMode.value === 'dark' || (themeMode.value === 'system' && systemDark.value),
  )

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
    effectiveDark,
    setThemeMode,
    toggleSidebar,
    setInitialized,
  }
})
