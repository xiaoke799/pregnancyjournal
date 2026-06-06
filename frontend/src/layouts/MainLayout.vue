<template>
  <div class="main-layout" :class="{ 'is-mobile': isMobile }">
    <aside v-if="!isMobile" class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="logo-wrap">
          <span class="logo-emoji">🌸</span>
          <span class="app-title" v-if="!appStore.sidebarCollapsed">孕程记</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          active-class="active"
        >
          <span class="nav-indicator"></span>
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label" v-if="!appStore.sidebarCollapsed">{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <button
          class="toggle-btn"
          @click="appStore.toggleSidebar"
          :title="appStore.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        >
          <span class="toggle-icon">{{ appStore.sidebarCollapsed ? '›' : '‹' }}</span>
        </button>
      </div>
    </aside>

    <main class="main-content" :class="{ 'has-tabbar': isMobile }">
      <div class="content-inner">
        <router-view />
      </div>
    </main>

    <nav v-if="isMobile" class="tabbar">
      <router-link
        v-for="item in tabbarItems"
        :key="item.path"
        :to="item.path"
        class="tabbar-item"
        active-class="tabbar-active"
      >
        <span class="tabbar-icon">{{ item.icon }}</span>
        <span class="tabbar-label">{{ item.label }}</span>
        <span class="tabbar-dot"></span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useResize } from '@/composables/useResize'

const appStore = useAppStore()
const { isMobile } = useResize()

const navItems = [
  { path: '/', icon: '🏠', label: '首页' },
  { path: '/record', icon: '📝', label: '记录' },
  { path: '/diary', icon: '📖', label: '日记' },
  { path: '/album', icon: '📷', label: '相册' },
  { path: '/checkup-schedule', icon: '🏥', label: '产检' },
  { path: '/diet', icon: '🍎', label: '饮食' },
  { path: '/checklist', icon: '✅', label: '清单' },
  { path: '/settings', icon: '⚙️', label: '设置' },
]

// 手机端 tabbar 显示核心入口（产检是核心功能，必须显示）
const tabbarItems = computed(() => navItems.filter(i =>
  ['/', '/record', '/checkup-schedule', '/diary', '/checklist', '/settings'].includes(i.path)
))
</script>

<style scoped>
.main-layout {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

/* ============ 侧边栏 ============ */
.sidebar {
  width: var(--sidebar-width, 224px);
  background: linear-gradient(180deg, #ffffff 0%, #fff8fb 100%);
  border-right: 1px solid var(--border-color-soft);
  display: flex;
  flex-direction: column;
  transition: width 0.3s var(--ease-out-quart);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 60%;
  height: 240px;
  background: radial-gradient(circle at top right, rgba(244, 140, 176, 0.18), transparent 70%);
  pointer-events: none;
}

.sidebar.collapsed {
  width: var(--sidebar-width-collapsed, 64px);
}

.sidebar-header {
  padding: 22px 16px 18px;
  position: relative;
  z-index: 1;
}

.logo-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
}

.logo-emoji {
  font-size: 26px;
  line-height: 1;
  filter: drop-shadow(0 2px 6px rgba(196, 70, 128, 0.3));
  animation: floatY 4s ease-in-out infinite;
}

.app-title {
  font-size: 19px;
  font-weight: 800;
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.sidebar.collapsed .sidebar-header {
  padding: 22px 8px 18px;
  text-align: center;
}

.sidebar.collapsed .logo-wrap {
  justify-content: center;
  padding: 6px 0;
}

/* ============ 导航项 ============ */
.sidebar-nav {
  flex: 1;
  padding: 8px 12px;
  overflow-y: auto;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav::-webkit-scrollbar { width: 0; }

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  padding: 11px 14px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  text-decoration: none;
  transition: all var(--transition-base);
  gap: 12px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}

.nav-indicator {
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 22px;
  background: var(--gradient-primary);
  border-radius: 0 3px 3px 0;
  transition: transform var(--transition-base);
  transform-origin: center;
}

.nav-item:hover {
  background: rgba(196, 70, 128, 0.06);
  color: var(--primary-color);
}

.nav-item.active {
  background: linear-gradient(135deg, rgba(244, 140, 176, 0.14), rgba(196, 70, 128, 0.1));
  color: var(--primary-color);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.nav-item.active .nav-indicator {
  transform: translateY(-50%) scaleY(1);
}

.nav-item.active .nav-icon {
  transform: scale(1.12);
}

.nav-icon {
  font-size: 18px;
  width: 22px;
  text-align: center;
  flex-shrink: 0;
  transition: transform var(--transition-base);
}

.nav-label {
  font-size: 14px;
  white-space: nowrap;
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 12px 0;
}

.sidebar.collapsed .nav-indicator {
  left: -12px;
}

/* ============ 侧边栏底部 ============ */
.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border-color-soft);
  display: flex;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.toggle-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: var(--bg-tint-pink);
  border: 1px solid var(--border-color-soft);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.toggle-btn:hover {
  background: var(--primary-100);
  color: var(--primary-color);
  border-color: var(--primary-200);
  transform: scale(1.05);
}

.toggle-icon {
  line-height: 1;
  font-weight: 700;
}

/* ============ 主内容区 ============ */
.main-content {
  flex: 1;
  overflow-y: auto;
  background: transparent;
  -webkit-overflow-scrolling: touch;
  position: relative;
}

.content-inner {
  min-height: 100%;
}

.main-content.has-tabbar {
  padding-bottom: calc(var(--tabbar-height, 60px) + var(--safe-bottom, 0px));
}

/* ============ Tabbar (手机端) ============ */
.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--tabbar-height, 60px);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border-top: 1px solid var(--border-color-soft);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0 4px;
  padding-bottom: var(--safe-bottom, 0);
  z-index: 100;
  box-shadow: 0 -4px 20px rgba(31, 23, 48, 0.06);
}

.tabbar-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 6px;
  color: var(--text-hint);
  text-decoration: none;
  transition: color var(--transition-fast);
  min-width: 0;
  flex: 1;
  border-radius: var(--radius-md);
}

.tabbar-item:active {
  background: rgba(196, 70, 128, 0.08);
}

.tabbar-icon {
  font-size: 20px;
  line-height: 1;
  transition: transform var(--transition-base);
}

.tabbar-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.2px;
}

.tabbar-dot {
  position: absolute;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--primary-color);
  opacity: 0;
  transform: scale(0);
  transition: all var(--transition-base);
}

.tabbar-active {
  color: var(--primary-color);
  font-weight: 600;
}

.tabbar-active .tabbar-icon {
  transform: translateY(-2px) scale(1.1);
  filter: drop-shadow(0 4px 8px rgba(196, 70, 128, 0.35));
}

.tabbar-active .tabbar-dot {
  opacity: 1;
  transform: scale(1);
}

/* ============ 响应式 ============ */
@media (max-width: 768px) {
  .main-layout.is-mobile {
    flex-direction: column;
  }

  .main-content {
    padding: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}

@keyframes floatY {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

html.dark .sidebar {
  background: linear-gradient(180deg, #1a1730 0%, #211a3a 100%);
}

html.dark .sidebar::after {
  background: radial-gradient(circle at top right, rgba(240, 166, 200, 0.1), transparent 70%);
}

html.dark .tabbar {
  background: rgba(26, 23, 48, 0.88);
}
</style>
