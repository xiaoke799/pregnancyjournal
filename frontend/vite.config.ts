import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // API 代理：前端 dev 模式下 /api 请求转发到后端
      // 注意：不代理 /app/pregnancy-journal/api，因为后端已设置 root_path
      // 去掉前缀会导致 OpenAPI 文档路径异常
      '/api': {
        target: 'http://localhost:8680',
        changeOrigin: true,
      },
    },
  },
  base: '/',
  build: {
    outDir: '../app/ui',
    emptyOutDir: false,
  },
})
