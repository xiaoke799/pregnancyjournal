import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// 前端版本号的唯一真源 = 仓库根 manifest（与 app/server/node/config.js 的 APP_VERSION、
// build.ps1 的 $Version、CHANGELOG.md 同批同步）。
// 【为什么必须在这里注入】以前没有注入 import.meta.env.VITE_APP_VERSION，
// 于是 main.ts 里 `|| '0.0.27'` 的兜底被永久烤进产物 —— 明明是 v0.0.28 的包，
// 浏览器控制台和日志里都打印 "孕程记 v0.0.27 已加载"，排查时误导性极强。
function readManifestVersion(): string {
  try {
    const txt = readFileSync(resolve(__dirname, '../manifest'), 'utf8')
    const m = txt.match(/^\s*version\s*=\s*([0-9][0-9.]*)\s*$/m)
    if (m) return m[1]
  } catch {
    /* dev 环境或缺少 manifest 时走下面的占位符 */
  }
  return '0.0.0'
}

export default defineConfig({
  plugins: [vue()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(readManifestVersion()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // API 代理：前端 dev 模式下 /api 请求转发到后端
      // 注意：不代理 /app/pregnancyjournal/api，因为后端已设置 root_path
      // 去掉前缀会导致 OpenAPI 文档路径异常
      '/api': {
        target: 'http://localhost:8680',
        changeOrigin: true,
      },
    },
  },
  base: '/app/pregnancyjournal/',
  build: {
    outDir: '../app/ui',
    emptyOutDir: false,
  },
})
