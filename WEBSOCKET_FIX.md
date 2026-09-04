# 孕程记 — WebSocket 拒绝连接问题排查与修复

## 问题现象

应用安装后打开，浏览器控制台反复出现以下错误：
```
WebSocket connection to 'ws://<host>/app/pregnancyjournal/ws?type=main' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
```

前端体验：页面显示"拒绝连接"提示，应用无法与桌面建立通信通道。

---

## 根因分析

### 根本原因：三个叠加错误

经过阅读飞牛 OS 官方 SDK 文档 (`fnos-app-dev/references/gateway.md`) 才发现，问题由三个相互叠加的配置/代码错误共同导致：

#### 错误 1：`app/ui/config` 使用了错误的访问模型配置

❌ **原来的错误配置**（独立端口模式）：
```json
{
  "protocol": "http",
  "port": "3867"
}
```

这告诉飞牛网关："这个应用跑在独立端口 3867 上"。网关于是尝试直接 TCP 连接 `127.0.0.1:3867`，而我们的服务实际监听在 Unix Socket（`/var/apps/.../target/app.sock`）上，TCP 端口无人监听 → **拒绝连接**。

✅ **正确配置**（统一网关模式）：
```json
{
  "gatewayPrefix": "/app/pregnancyjournal",
  "gatewaySocket": "app.sock",
  "url": "/app/pregnancyjournal",
  "allUsers": true
}
```

根据官方文档 `references/gateway.md` 第 14-30 行，`protocol` / `port` 字段在统一网关入口会被**忽略**，必须使用 `gatewayPrefix` + `gatewaySocket`。

#### 错误 2：WebSocket 使用了独立的 Unix Socket 而非 Upgrade 复用

❌ **原来的错误方案**：创建独立的 `http.Server` 监听 `app.ws` 文件来处理 WebSocket。这种方案假设网关会将 WebSocket 请求转发到独立的 Socket 文件，但官方文档明确说明：应该复用同一个网关前缀和 Socket。

> 官方文档 (gateway.md 第 109-115 行)：
> ```
> ## WebSocket
> 复用同一个网关前缀和 Socket：
> const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
> const wsUrl = `${wsProtocol}//${window.location.host}/app/myapp/ws`;
> const socket = new WebSocket(wsUrl);
> ```

✅ **正确方案**：在主 HTTP Server 上监听 `upgrade` 事件，当路径匹配 `/ws` 时处理 WebSocket 握手。网关统一将 HTTPS/WSS 请求转发到同一个 `app.sock`。

#### 错误 3：`cmd/main` 未导出 `FNOS_SOCKET_PATH`

❌ **原来的错误**：`cmd/main` 启动命令中没有 `FNOS_SOCKET_PATH` 环境变量，导致：
- `config.js` 无法判断是否在网关环境中运行
- `getGatewayUser()` 在任何情况下都信任 `X-Trim-*` Header（有安全隐患，官方明确警告）
- server.js 需要硬编码 Socket 路径

✅ **正确方案**：按官方文档 (gateway.md 第 50-55 行) 在 `cmd/main` 中添加：
```bash
export FNOS_SOCKET_PATH="${TRIM_APPDEST}/app.sock"
```

---

## 最终解决方案

### 修改文件清单

| 文件 | 改动 |
|------|------|
| `app/ui/config` | 改用 `gatewayPrefix` + `gatewaySocket`，删除 `protocol` / `port` / `wsSocket` |
| `cmd/main` | 添加 `export FNOS_SOCKET_PATH="${TRIM_APPDEST}/app.sock"` |
| `app/server/node/config.js` | 新增 `FNOS_SOCKET_PATH` 字段 |
| `app/server/node/server.js` | 优先用 `FNOS_SOCKET_PATH` 确定监听路径 |
| `app/server/node/websocket.js` | 从独立 Socket 改为 `server.on('upgrade', ...)` 复用主 Server |
| `frontend/src/main.ts` | 保留 BFCache 处理监听器 |

### 验证清单

打包部署后确认：

1. [ ] 进程启动成功：`cat /var/apps/pregnancyjournal/var/info.log` 无报错
2. [ ] Socket 文件存在：`ls -la /var/apps/pregnancyjournal/target/app.sock`
3. [ ] HTTP API 可访问：应用打开后页面正常显示
4. [ ] 浏览器控制台无 WebSocket 错误

---

## 关键教训

> **统一网关的正确配置只有三个字段**：
> 1. `gatewayPrefix` — 路径前缀
> 2. `gatewaySocket` — Socket 文件名（无路径）
> 3. `gatewayUrl` — 触发 URL
>
> **WebSocket 不需要独立配置**：复用同一 Socket / 同一 Server，通过协议升级处理。
>
> **`FNOS_SOCKET_PATH` 是关键环境变量**：cmd/main 必须导出，后端据此判断是否真正在网关环境运行。

---

*修复日期：2026-09-03 | 版本：0.0.27 | 根因定位方法：阅读官方 SDK `references/gateway.md` 权威文档*
