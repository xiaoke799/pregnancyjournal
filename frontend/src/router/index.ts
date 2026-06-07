/** 孕程记 - 前端路由配置。 */

import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '首页' } },
      { path: 'record', name: 'record', component: () => import('@/views/RecordView.vue'), meta: { title: '记录' } },
      { path: 'calendar', redirect: '/record' },
      { path: 'album', name: 'album', component: () => import('@/views/AlbumView.vue'), meta: { title: '相册' } },
      { path: 'diary', name: 'diary', component: () => import('@/views/DiaryView.vue'), meta: { title: '日记' } },
      { path: 'checkup-schedule', name: 'checkup-schedule', component: () => import('@/views/CheckupScheduleView.vue'), meta: { title: '产检' } },
      { path: 'diet', name: 'diet', component: () => import('@/views/DietView.vue'), meta: { title: '饮食' } },
      { path: 'checklist', name: 'checklist', component: () => import('@/views/ChecklistView.vue'), meta: { title: '清单' } },
      { path: 'stats', name: 'stats', component: () => import('@/views/StatsView.vue'), meta: { title: '统计' } },
      { path: 'reference', redirect: '/diet' },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } },
    ],
  },
  { path: '/contraction-timer', name: 'contraction-timer', component: () => import('@/views/ContractionTimerView.vue'), meta: { title: '宫缩计时', fullscreen: true } },
  { path: '/fetal-movement-counter', name: 'fetal-movement-counter', component: () => import('@/views/FetalMovementCounterView.vue'), meta: { title: '胎动计数', fullscreen: true } },
  { path: '/setup', name: 'setup', component: () => import('@/views/SetupWizardView.vue'), meta: { title: '初始设置' } },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// 直接放行所有路由，不再检查设置状态
router.beforeEach(() => {
  return true
})

export default router
