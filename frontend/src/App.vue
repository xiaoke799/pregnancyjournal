<template>
  <n-config-provider
    :theme="appStore.effectiveDark ? darkTheme : lightTheme"
    :theme-overrides="appStore.effectiveDark ? darkThemeOverrides : lightThemeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <!-- 错误边界：某个视图渲染崩溃时不再整页空白，而是给出可操作的出口 -->
          <div v-if="hasError" class="app-error-boundary">
            <div class="app-error-card">
              <div class="app-error-emoji">😵‍💫</div>
              <div class="app-error-title">这个页面出错了</div>
              <div class="app-error-desc">{{ errorMessage || '页面渲染时发生异常，已阻止整页空白。' }}</div>
              <div class="app-error-actions">
                <n-button type="primary" @click="goHome">返回首页</n-button>
                <n-button @click="reloadPage">刷新页面</n-button>
              </div>
            </div>
          </div>
          <router-view v-else v-slot="{ Component, route }">
            <component :is="Component" :key="route.path" />
          </router-view>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, watch, onErrorCaptured } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useAppStore } from '@/stores/app'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  NButton,
  zhCN,
  dateZhCN,
  darkTheme,
  lightTheme,
  type GlobalThemeOverrides,
} from 'naive-ui'

// ============ 错误边界 ============
// 捕获子组件渲染异常，避免单个视图崩溃导致整个应用白板（历史上 PDF 导出触发
// 后端进程退出后，前端表现为点图标白板；这里再兜一层，让用户能自己恢复）
const hasError = ref(false)
const errorMessage = ref('')
const route = useRoute()
const router = useRouter()

onErrorCaptured((err, _instance, info) => {
  console.error('[App ErrorBoundary]', err, info)
  errorMessage.value = (err as Error)?.message || String(err)
  hasError.value = true
  return false
})

// 跳转到其他路由时自动清除错误状态
watch(() => route.fullPath, () => { hasError.value = false })

// 孕期档案预取：**故意不 await**。
// 以前这个请求要等首页组件下载完、挂载后才发出（首页 onMounted 里 await 它，
// 拿到结果再去请求看板数据），等于把「下载组件」和「取数据」串成了两步。
// 这里在应用壳层就先发出去，让它与首页组件的下载并行，首屏能省一个来回。
// store 内部有并发去重，首页再调一次会复用同一个请求，不会打两遍。
const pregnancyStore = usePregnancyStore()
pregnancyStore.fetchActivePregnancy().catch(() => {
  // 没有档案 / 网络异常都不影响渲染，各视图自己有兜底，这里静默即可
})

function reloadPage() { window.location.reload() }
function goHome() {
  hasError.value = false
  router.push('/').catch(() => { window.location.reload() })
}

// ============ 深色模式 ============
// 把 store 里的 themeMode（浅色/深色/跟随系统）换算成「实际是否深色」，再：
//   ① 给 <html> 加/去 `dark` 类 —— 激活 variables.css 里那套 html.dark CSS 变量
//      （页面底色、卡片、文字、边框、阴影全跟着翻暗）；
//   ② 把 Naive UI 的 darkTheme + 深色 themeOverrides 传给 n-config-provider
//      （Naive 组件自身的底色/文字由它的 theme 控制，光靠 html.dark 类翻不了）。
// 之前 currentTheme 是死状态、config-provider 只传 theme-overrides 没传 theme，
// 于是「深色」永远不生效（铁律 #18 说的「深色模式未接上」）。
const appStore = useAppStore()

// 系统深色偏好的监听已经收进 store（图表要读），这里只负责把结果落到 DOM 上。
// immediate: 首屏就按存储/系统偏好定好，避免亮→暗闪一下。
watch(() => appStore.effectiveDark, (v) => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', v)
  }
}, { immediate: true })

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#c44680',
    primaryColorHover: '#b13a72',
    primaryColorPressed: '#9c3164',
    primaryColorSuppl: '#d2649a',
    infoColor: '#4fb6e8',
    infoColorHover: '#3aa3d5',
    infoColorPressed: '#2c8fbb',
    successColor: '#4ea750',
    successColorHover: '#41953f',
    successColorPressed: '#338432',
    warningColor: '#f0a020',
    warningColorHover: '#e08e10',
    warningColorPressed: '#cb7c08',
    errorColor: '#e64646',
    errorColorHover: '#d23636',
    errorColorPressed: '#bd2828',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontFamily: '"PingFang SC","Noto Sans SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI",sans-serif',
    fontWeightStrong: '600',
    textColorBase: '#1f1730',
    textColor1: '#1f1730',
    textColor2: '#5c5275',
    textColor3: '#847a99',
    bodyColor: 'transparent',
    cardColor: '#ffffff',
    modalColor: '#fffafd',
    popoverColor: '#fffafd',
    dividerColor: '#f1ebf2',
    borderColor: '#efe7ef',
    hoverColor: 'rgba(196, 70, 128, 0.06)',
    pressedColor: 'rgba(196, 70, 128, 0.1)',
    actionColor: '#fff5fa',
    tableHeaderColor: '#fff5fa',
    inputColor: '#fffafd',
    inputColorDisabled: '#f6f0f6',
  },
  Button: {
    borderRadiusTiny: '6px',
    borderRadiusSmall: '8px',
    borderRadiusMedium: '10px',
    borderRadiusLarge: '12px',
    fontWeight: '600',
    paddingMedium: '0 18px',
  },
  Card: {
    borderRadius: '16px',
    paddingMedium: '20px',
    paddingLarge: '24px',
    color: '#ffffff',
  },
  Modal: {
    peers: {
      Card: {
        borderRadius: '20px',
        paddingMedium: '24px',
      },
    },
  },
  Drawer: {
    borderRadius: '20px',
  },
  Dialog: {
    borderRadius: '16px',
    iconMargin: '0 12px 0 0',
  },
  Input: {
    borderRadius: '10px',
    heightMedium: '40px',
    border: '1px solid #efe7ef',
    borderHover: '1px solid #c44680',
    borderFocus: '1px solid #c44680',
    boxShadowFocus: '0 0 0 3px rgba(196, 70, 128, 0.12)',
  },
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '10px',
        heightMedium: '40px',
        border: '1px solid #efe7ef',
        borderHover: '1px solid #c44680',
        borderFocus: '1px solid #c44680',
        boxShadowFocus: '0 0 0 3px rgba(196, 70, 128, 0.12)',
      },
    },
  },
  DatePicker: {
    peers: {
      Input: {
        borderRadius: '10px',
      },
    },
  },
  Tag: {
    borderRadius: '8px',
    fontWeightStrong: '600',
  },
  Tabs: {
    tabFontWeightActive: '600',
    tabPaddingMediumLine: '10px 18px',
  },
  Message: {
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(31, 23, 48, 0.12)',
  },
  Notification: {
    borderRadius: '14px',
  },
  Switch: {
    railColorActive: '#c44680',
  },
  Checkbox: {
    colorChecked: '#c44680',
    borderChecked: '1px solid #c44680',
    borderFocus: '1px solid #c44680',
    boxShadowFocus: '0 0 0 3px rgba(196, 70, 128, 0.18)',
  },
  Radio: {
    dotColorActive: '#c44680',
    boxShadowActive: 'inset 0 0 0 1px #c44680',
    boxShadowHover: 'inset 0 0 0 1px #c44680',
    boxShadowFocus: 'inset 0 0 0 1px #c44680, 0 0 0 3px rgba(196, 70, 128, 0.18)',
  },
  Progress: {
    railColor: '#f1ebf2',
    fillColor: '#c44680',
  },
  Slider: {
    fillColor: '#c44680',
    fillColorHover: '#b13a72',
    handleColor: '#ffffff',
  },
}

// 深色模式的 Naive UI 覆写：与 variables.css 的 html.dark 变量对齐（卡片/文字/边框翻暗，
// 品牌粉在深底上提亮为 --primary-color 的暗色值 #f0a6c8，保证对比度）。
const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#f0a6c8',
    primaryColorHover: '#f7b9d4',
    primaryColorPressed: '#d8849c',
    primaryColorSuppl: '#f0a6c8',
    infoColor: '#9ad4ef',
    infoColorHover: '#b3e0f5',
    infoColorPressed: '#7cc8e8',
    successColor: '#93d49b',
    successColorHover: '#a7ddae',
    successColorPressed: '#7cc488',
    warningColor: '#f2cd7a',
    warningColorHover: '#f5d98f',
    warningColorPressed: '#e6bf5f',
    errorColor: '#f2a0a0',
    errorColorHover: '#f5b0b0',
    errorColorPressed: '#e88a8a',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontFamily: '"PingFang SC","Noto Sans SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI",sans-serif',
    fontWeightStrong: '600',
    textColorBase: '#ece9f3',
    textColor1: '#ece9f3',
    textColor2: '#b6afc7',
    textColor3: '#8a83a0',
    bodyColor: 'transparent',
    cardColor: '#1a1730',
    modalColor: '#221d3b',
    popoverColor: '#221d3b',
    dividerColor: '#251f3a',
    borderColor: '#2c2640',
    hoverColor: 'rgba(240, 166, 200, 0.08)',
    pressedColor: 'rgba(240, 166, 200, 0.12)',
    actionColor: '#2a1e2d',
    tableHeaderColor: '#2a1e2d',
    inputColor: '#221d3b',
    inputColorDisabled: '#1c172e',
  },
  Button: {
    borderRadiusTiny: '6px',
    borderRadiusSmall: '8px',
    borderRadiusMedium: '10px',
    borderRadiusLarge: '12px',
    fontWeight: '600',
    paddingMedium: '0 18px',
  },
  Card: {
    borderRadius: '16px',
    paddingMedium: '20px',
    paddingLarge: '24px',
    color: '#1a1730',
  },
  Modal: {
    peers: {
      Card: {
        borderRadius: '20px',
        paddingMedium: '24px',
      },
    },
  },
  Drawer: {
    borderRadius: '20px',
  },
  Dialog: {
    borderRadius: '16px',
    iconMargin: '0 12px 0 0',
  },
  Input: {
    borderRadius: '10px',
    heightMedium: '40px',
    border: '1px solid #2c2640',
    borderHover: '1px solid #f0a6c8',
    borderFocus: '1px solid #f0a6c8',
    boxShadowFocus: '0 0 0 3px rgba(240, 166, 200, 0.18)',
  },
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '10px',
        heightMedium: '40px',
        border: '1px solid #2c2640',
        borderHover: '1px solid #f0a6c8',
        borderFocus: '1px solid #f0a6c8',
        boxShadowFocus: '0 0 0 3px rgba(240, 166, 200, 0.18)',
      },
    },
  },
  DatePicker: {
    peers: {
      Input: {
        borderRadius: '10px',
      },
    },
  },
  Tag: {
    borderRadius: '8px',
    fontWeightStrong: '600',
  },
  Tabs: {
    tabFontWeightActive: '600',
    tabPaddingMediumLine: '10px 18px',
  },
  Message: {
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  Notification: {
    borderRadius: '14px',
  },
  Switch: {
    railColorActive: '#f0a6c8',
  },
  Checkbox: {
    colorChecked: '#f0a6c8',
    borderChecked: '1px solid #f0a6c8',
    borderFocus: '1px solid #f0a6c8',
    boxShadowFocus: '0 0 0 3px rgba(240, 166, 200, 0.22)',
  },
  Radio: {
    dotColorActive: '#f0a6c8',
    boxShadowActive: 'inset 0 0 0 1px #f0a6c8',
    boxShadowHover: 'inset 0 0 0 1px #f0a6c8',
    boxShadowFocus: 'inset 0 0 0 1px #f0a6c8, 0 0 0 3px rgba(240, 166, 200, 0.22)',
  },
  Progress: {
    railColor: '#251f3a',
    fillColor: '#f0a6c8',
  },
  Slider: {
    fillColor: '#f0a6c8',
    fillColorHover: '#f7b9d4',
    handleColor: '#ffffff',
  },
}
</script>

<style>
#app {
  width: 100%;
  min-height: 100vh;
}

/* 错误边界兜底样式 */
.app-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 24px;
}
.app-error-card {
  max-width: 380px;
  width: 100%;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #f1ebf2);
  border-radius: 20px;
  padding: 28px 24px;
  text-align: center;
  box-shadow: var(--shadow-lg, 0 8px 30px rgba(31, 23, 48, 0.08));
}
.app-error-emoji { font-size: 40px; line-height: 1; }
.app-error-title { font-size: 17px; font-weight: 600; color: var(--text-color, #1f1730); margin-top: 12px; }
.app-error-desc {
  font-size: 13px; color: var(--text-secondary, #5c5275); margin-top: 8px; line-height: 1.6;
  word-break: break-all; max-height: 120px; overflow: auto;
}
.app-error-actions { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
</style>
