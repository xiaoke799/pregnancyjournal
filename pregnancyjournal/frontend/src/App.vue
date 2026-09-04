<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <router-view v-slot="{ Component, route }">
            <component :is="Component" :key="route.path" />
          </router-view>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { onErrorCaptured } from 'vue'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'

onErrorCaptured((err, _instance, info) => {
  console.error('[App ErrorBoundary]', err, info)
  return false
})

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
</style>
