/** 孕程记 - 前端路由配置。 */

import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getSetupStatus } from '@/api/app-config'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '首页' } },
      { path: 'record', name: 'record', component: () => import('@/views/RecordView.vue'), meta: { title: '记录' } },
      { path: 'calendar', redirect: '/record' },
      { path: 'album', name: 'album', component: () => import('@/views/AlbumView.vue'), meta: { title: '相册' } },
      { path: 'checkup-schedule', name: 'checkup-schedule', component: () => import('@/views/CheckupScheduleView.vue'), meta: { title: '产检' } },
      { path: 'diet', name: 'diet', component: () => import('@/views/DietView.vue'), meta: { title: '饮食' } },
      { path: 'checklist', name: 'checklist', component: () => import('@/views/ChecklistView.vue'), meta: { title: '清单' } },
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

const SETUP_CACHE_KEY = 'pregnancy_setup_status'
const CACHE_TTL = 5 * 60 * 1000

interface SetupCache {
  isComplete: boolean
  timestamp: number
}

function getSetupFromCache(): boolean | null {
  try {
    const raw = sessionStorage.getItem(SETUP_CACHE_KEY)
    if (!raw) return null
    const cache: SetupCache = JSON.parse(raw)
    if (Date.now() - cache.timestamp > CACHE_TTL) {
      sessionStorage.removeItem(SETUP_CACHE_KEY)
      return null
    }
    return cache.isComplete
  } catch {
    return null
  }
}

function setSetupToCache(isComplete: boolean) {
  try {
    const cache: SetupCache = {
      isComplete,
      timestamp: Date.now(),
    }
    sessionStorage.setItem(SETUP_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

let setupChecked = false
let isSetupComplete = false

export function resetSetupCheck() {
  setupChecked = false
  isSetupComplete = false
  sessionStorage.removeItem(SETUP_CACHE_KEY)
}

router.beforeEach(async (to) => {
  if (to.path === '/setup') {
    return true
  }

  if (setupChecked && isSetupComplete) {
    return true
  }

  const cached = getSetupFromCache()
  if (cached !== null) {
    setupChecked = true
    isSetupComplete = cached
    if (!cached) {
      return { path: '/setup' }
    }
    return true
  }

  try {
    const res: any = await getSetupStatus()
    if (res && res.code === 0 && res.data) {
      isSetupComplete = res.data.is_setup_complete === true
      setupChecked = true
      setSetupToCache(isSetupComplete)
      if (!isSetupComplete) {
        return { path: '/setup' }
      }
    } else {
      setupChecked = true
      isSetupComplete = true
      setSetupToCache(true)
    }
  } catch {
    setupChecked = true
    isSetupComplete = true
    setSetupToCache(true)
  }

  return true
})

export default router
