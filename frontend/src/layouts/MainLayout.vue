<template>
  <div class="main-layout" :class="{ 'is-mobile': isMobile }">
    <aside v-if="!isMobile" class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
      <div class="sidebar-header">
        <div class="logo-wrap">
          <svg class="logo-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
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
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="(d, di) in item.paths" :key="di" :d="d" />
          </svg>
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
        <svg class="tabbar-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="(d, di) in item.paths" :key="di" :d="d" />
        </svg>
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
  { path: '/', label: '首页', paths: [
    'M3 9.5L12 3l9 6.5V19a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z',
  ] },
  { path: '/record', label: '记录', paths: [
    'M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2',
    'M10 2h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
    'M8 12.5h8M8 16.5h5',
  ] },
  { path: '/diary', label: '日记', paths: [
    'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z',
    'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  ] },
  { path: '/album', label: '相册', paths: [
    'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z',
    'M8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z',
    'M21 15.5l-5-5L5 21',
  ] },
  { path: '/checkup-schedule', label: '产检', paths: [
    'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
    'M16 2v4M8 2v4M3 10h18',
    'M8.5 15l2.5 2.5 4.5-4.5',
  ] },
  { path: '/diet', label: '饮食', paths: [
    'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2',
    'M7 2v20',
    'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z',
  ] },
  { path: '/checklist', label: '清单', paths: [
    'M3 6l2 2 3-3',
    'M3 13l2 2 3-3',
    'M13 6h8M13 13h8',
  ] },
  { path: '/settings', label: '设置', paths: [
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  ] },
]

// 手机端 tabbar 显示所有功能入口（与电脑端侧边栏一致）
const tabbarItems = computed(() => navItems.filter(i =>
  ['/', '/record', '/diary', '/album', '/checkup-schedule', '/diet', '/checklist', '/settings'].includes(i.path)
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
  user-select: none;
  -webkit-user-select: none;
}

.logo-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  cursor: default;
}

.logo-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  color: var(--primary-color);
  filter: drop-shadow(0 2px 6px rgba(196, 70, 128, 0.3));
  animation: floatY 4s ease-in-out infinite;
}

/* 导航/标签栏用线性矢量图标（统一 fill:none + stroke），
   不依赖系统 emoji 字体 —— 各家系统/Android WebView 强制反色都不会变形 */
.logo-icon,
.nav-icon,
.tabbar-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
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
  width: 22px;
  height: 22px;
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
  /* height 必须把安全区算进去：全局是 box-sizing: border-box，
     若只写 60px 而 padding-bottom 等于安全区高度，内容区会被压扁（全面屏尤其明显）。 */
  height: calc(var(--tabbar-height, 60px) + var(--safe-bottom, 0px));
  /* 用【不透明】背景，不再依赖 backdrop-filter：
     部分安卓机型（如 vivo 的浏览器 / 系统 WebView）对 backdrop-filter 支持不完整，
     半透明背景 + 毛玻璃失效时会表现为「导航栏透明 / 发虚」；
     若再叠加安卓的强制反色，问题更明显。纯不透明背景在所有机型上表现一致。 */
  /* 走令牌而非硬写色值：--bg-card 在亮色是 #ffffff、在 html.dark 是 #1a1730，
     两者恰好就是原来的硬写值。这样深色模式无需额外的 .tabbar 覆盖规则，
     将来主题色一改即自动跟随（铁律 17：配色一律走令牌）。 */
  background: var(--bg-card);
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
  width: 22px;
  height: 22px;
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
    /* 顶部安全区：viewport-fit=cover 后页面会延伸到状态栏下方，不补会被遮挡 */
    padding-top: var(--safe-top, 0px);
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
</style>
