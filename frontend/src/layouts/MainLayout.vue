<template>
  <div class="main-layout" :class="{ 'is-mobile': isMobile }">
    <aside v-if="!isMobile" class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
      <div class="sidebar-header">
        <span class="app-title" v-if="!appStore.sidebarCollapsed">孕程记</span>
        <span class="app-title-short" v-else>孕</span>
      </div>
      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          active-class="active"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label" v-if="!appStore.sidebarCollapsed">{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <button class="toggle-btn" @click="appStore.toggleSidebar">
          {{ appStore.sidebarCollapsed ? '→' : '←' }}
        </button>
      </div>
    </aside>

    <main class="main-content" :class="{ 'has-tabbar': isMobile }">
      <router-view v-slot="{ Component, route }">
        <KeepAlive :include="['DashboardView', 'RecordView', 'AlbumView', 'CheckupScheduleView', 'DietView', 'ChecklistView']">
          <component :is="Component" :key="route.path" />
        </KeepAlive>
      </router-view>
    </main>

    <nav v-if="isMobile" class="tabbar">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="tabbar-item"
        active-class="tabbar-active"
      >
        <span class="tabbar-icon">{{ item.icon }}</span>
        <span class="tabbar-label">{{ item.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useResize } from '@/composables/useResize'

const appStore = useAppStore()
const { isMobile } = useResize()

const navItems = [
  { path: '/', icon: '🏠', label: '首页' },
  { path: '/record', icon: '📝', label: '记录' },
  { path: '/album', icon: '📷', label: '相册' },
  { path: '/checkup-schedule', icon: '🏥', label: '产检' },
  { path: '/diet', icon: '🍎', label: '饮食' },
  { path: '/checklist', icon: '✅', label: '清单' },
  { path: '/settings', icon: '⚙️', label: '设置' },
]
</script>

<style scoped>
.main-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 200px;
  background: var(--bg-sidebar, #fff);
  border-right: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;
}

.sidebar.collapsed {
  width: 60px;
}

.sidebar-header {
  padding: 20px 16px;
  text-align: center;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.app-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--primary-color, #e8a0bf);
}

.app-title-short {
  font-size: 24px;
  font-weight: 700;
  color: var(--primary-color, #e8a0bf);
}

.sidebar-nav {
  flex: 1;
  padding: 8px 0;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  color: var(--text-secondary, #64748b);
  text-decoration: none;
  transition: background-color 0.2s, color 0.2s;
  gap: 12px;
}

.nav-item:hover {
  background: rgba(232, 160, 191, 0.1);
  color: var(--primary-color, #e8a0bf);
}

.nav-item.active {
  background: rgba(232, 160, 191, 0.15);
  color: var(--primary-color, #e8a0bf);
  font-weight: 600;
}

.nav-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.nav-label {
  font-size: 14px;
  white-space: nowrap;
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 12px 0;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border-color, #e2e8f0);
  text-align: center;
}

.toggle-btn {
  background: none;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  color: var(--text-secondary, #64748b);
  font-size: 14px;
}

.toggle-btn:hover {
  background: var(--border-color, #e2e8f0);
}

.main-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-color, #f8fafc);
  padding: 24px;
}

.main-content.has-tabbar {
  padding-bottom: 72px;
}

.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: #fff;
  border-top: 1px solid var(--border-color, #e2e8f0);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0 4px;
  padding-bottom: env(safe-area-inset-bottom, 0);
  z-index: 100;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
}

.tabbar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 10px;
  color: var(--text-hint, #94a3b8);
  text-decoration: none;
  transition: color 0.2s;
  min-width: 48px;
  border-radius: 8px;
}

.tabbar-item:active {
  background: rgba(232, 160, 191, 0.08);
}

.tabbar-active {
  color: var(--primary-color, #e8a0bf);
}

.tabbar-icon {
  font-size: 20px;
  line-height: 1;
}

.tabbar-label {
  font-size: 10px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .main-layout.is-mobile {
    flex-direction: column;
    height: 100dvh;
  }

  .main-content {
    padding: 16px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}
</style>
