<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
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
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  NButton,
  zhCN,
  dateZhCN,
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

function reloadPage() { window.location.reload() }
function goHome() {
  hasError.value = false
  router.push('/').catch(() => { window.location.reload() })
}

const themeOverrides: GlobalThemeOverrides = {
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
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    dividerColor: '#f1ebf2',
    borderColor: '#efe7ef',
    hoverColor: 'rgba(196, 70, 128, 0.06)',
    pressedColor: 'rgba(196, 70, 128, 0.1)',
    actionColor: '#fff5fa',
    tableHeaderColor: '#fff5fa',
    inputColor: '#ffffff',
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
  background: #fff;
  border: 1px solid #f1ebf2;
  border-radius: 20px;
  padding: 28px 24px;
  text-align: center;
  box-shadow: 0 8px 30px rgba(31, 23, 48, 0.08);
}
.app-error-emoji { font-size: 40px; line-height: 1; }
.app-error-title { font-size: 17px; font-weight: 600; color: #1f1730; margin-top: 12px; }
.app-error-desc {
  font-size: 13px; color: #5c5275; margin-top: 8px; line-height: 1.6;
  word-break: break-all; max-height: 120px; overflow: auto;
}
.app-error-actions { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
</style>
