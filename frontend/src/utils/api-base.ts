/** 运行时推导 API 根路径。
 *
 * 生产（FnOS 统一网关）：页面位于 /app/pregnancyjournal[/...]，
 * API 在 <网关前缀>/api/v1。直接从 location.pathname 提取 /app/<appname>
 * 前缀，兼容入口 URL 有无尾斜杠两种情况（无尾斜杠时相对路径解析会丢前缀）。
 *
 * 开发（vite dev server）：页面在 /，返回 /api/v1（由 vite proxy 转发）。
 */
export function getApiBase(): string {
  const m = window.location.pathname.match(/^(\/app\/[^/]+)/)
  return m ? `${m[1]}/api/v1` : '/api/v1'
}
