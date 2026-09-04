# 更新日志 / Changelog

所有显著变更都会记录在此文件 / All notable changes are documented here.

---

## [0.0.28] - 2026-09-04

### 修复 / Fixed
- **应用中心启用失败**  - 禁用高危字段`disable_authorization_path=false`，避免应用中心误判需要UI授权变更导致启用被拦截
- **依赖配置补全**  - 新增`ctl_stop=true`字段，对齐飞牛官方应用规范
- **版本统一**  - 全链路统一版本号为0.0.28，避免版本不一致导致的识别问题

---

## [0.0.27] - 2026-09-03

### 迁移 / Migration
- **迁移至飞牛 OS 统一网关** — 由 CGI 模式切换为统一网关常驻服务模式，监听 Unix Socket
- 访问路径从 `/cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1` 变更为 `/app/pregnancyjournal/api/v1`
- 由 TCP 端口改为 Unix Socket（`${TRIM_APPDEST}/target/app.sock`）
- 获取 NAS 登录态网关头（X-Trim-Userid / X-Trim-Isadmin / X-Trim-Username）
- 支持桌面 WebSocket 通信通道

### 修复 / Fixed
- **网关配置** — config 添加 `gatewaySocket`、`gatewayPrefix`、`url` 字段，去除 `port`
- **日记心情** — 修复心情保存后 UI 不显示 emoji 的问题
- **相册日期** — 上传改用 HTML5 `<input type="date">`，绕开 Naive UI DatePicker + date-fns v4 兼容性问题
- **相册编辑/删除** — 新增编辑、删除按钮及完整交互（照片日期/分类/描述可修改）
- **相册预览** — 预览弹窗显示孕周、日期、描述等元数据
- **首页提醒时间** — 时间选择器宽度 100→110px，完整显示时间选项
- **产检完成 UI** — 修复点击"标记完成"后不立即显示"已完成"的响应式问题（立即更新本地状态 + 后台同步）
- **启动顺序** — 修复数据库初始化晚于路由加载导致调度器执行报错的问题
- **日志格式** — 修复 daily-record 日志调用缺少分类参数导致尾部输出 `undefined` 的问题
- **BFCache 处理** — 添加 pageshow/pagehide 监听防止浏览器缓存恢复后 WebSocket 断开

### 基础设施 / Infrastructure
- **日志系统** — 重构为结构化 JSON 日志（异步写入、文件轮转、级别过滤、查询/统计 API）
- **FPK 打包** — 使用官方 `fnpack_tool.exe` 打包，输出标准格式（从 866MB tar 降至 74MB）
- **前端错误捕获** — 全局 Vue errorHandler + Promise rejection + window error 监听

---

## [0.0.10] - 2026

### 变更 / Changed
- 重大 UI 重构 — 导航切换优化
- 记录页单列布局 + 独立滚动 + 数据预览
- 添加记录拆分为 10 种独立小弹窗（体重血压血糖等）
- 日历记录点修复
