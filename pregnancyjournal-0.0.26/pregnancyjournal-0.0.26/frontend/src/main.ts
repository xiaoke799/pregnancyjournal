import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.css'

// Naive UI 全局注册（必须，否则NDatePicker等组件不渲染）
import naive from 'naive-ui'

const app = createApp(App)
const pinia = createPinia()

// 全局错误捕获
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err, info)
}

app.use(pinia)
app.use(router)
app.use(naive)
app.mount('#app')
