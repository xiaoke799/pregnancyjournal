import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.css'

const app = createApp(App)
const pinia = createPinia()

// 全局错误捕获
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err, info)
}

app.use(pinia)
app.use(router)
app.mount('#app')
