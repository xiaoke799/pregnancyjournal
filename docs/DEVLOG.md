# 开发日志 / Dev Log

记录孕程记各版本的关键开发情况，倒序排列。

Development milestones for Pregnancy Journal, newest first.

---

## v0.0.27（2026-09-04）· 统一网关迁移 + 实测修复版

本版本是动版最大的一次底层调整：整个应用从「独立 TCP 端口」模式迁移到「飞牛统一网关」模式，并彻底重建了打包发布流程。

### 统一网关迁移

前后端通信模式全面切换：`ui/config` 改为 `gatewaySocket: app.sock` + `gatewayPrefix: /app/pregnancyjournal`，后端 `server.js` 不再监听 TCP 端口，改为监听 Unix Socket（由 `FNOS_SOCKET_PATH` 指定），并增加网关前缀剥离中间件（对裸前缀访问做 301 归一）。认证层去掉了 JWT，改用网关注入的 `X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username` 请求头。`cmd/main` 启动脚本按官方模板模式重写：`setsid` 会话脱离进程、启动后轮询验证 `app.sock` 就绪、`stop` 按进程路径精确清理。

### 打包流程重建与体积优化

搭建了 `build.ps1` 一键打包流水线（源码完整性校验 → 前端 assets 依赖图清理 → 生产依赖安装 → cmd 脚本编码规范化 → stage 组装 → fnpack 打包 → 解包验证）。此前打包目录里堆积了历次 Vite 构建的 1039 个冗余 assets（约 116MB），按 `index.html` 依赖图清理后仅保留 39 个可达文件，安装包从 115MB 降至 14.6MB。同时修复了多个导致安装失败的包结构问题（缺失 config/privilege、资源声明、重复目录、运行时数据混入等）。

### 实测问题修复

安装实测通过后，根据浏览器控制台反馈修复了三个功能问题：其一，`fetchActivePregnancy` 缺少 catch，无活跃孕期档案时异常直接炸掉首页（ErrorBoundary 白屏），已补置空处理；其二，`GET /checkups/custom` 被 `GET /checkups/:id` 路由遮蔽（Express 按注册顺序匹配），导致自定义产检查询报「记录不存在」、新增后列表恒为空，已为 `:id` 路由增加 UUID 校验放行具名路由；其三，相册日期用了 `dayjs().format('yyyy-MM-dd')`，小写令牌被 dayjs 当字面量输出为 `yyyy-09-Fr`，已改为大写 `YYYY-MM-DD`。另修复了 `frontend/public/config`（旧端口模式）在构建时覆盖网关配置的问题，明确其为 config 的唯一源头。

### 发布状态

- 安装包 `pregnancyjournal_v0.0.27.fpk`（14.6MB），68 项打包校验全部通过，x86-64 / ARM64 双架构，NAS 实测可安装运行
- 源码完整推送至 GitHub（xiaoke799/pregnancyjournal），Release 资产、tag、README 均已同步为修复后版本

---

## v0.0.26（2026-08-23）

安全加固版本：API 路由全面引入 UUID 格式校验、文件上传类型白名单与 50MB 大小限制；版本号对齐（config.js 与 manifest 统一为 0.0.26）；代码结构重组，新增 `server/node/` 与 `ui/` 目录；完善多条路由逻辑。

---

## v0.0.25 及之前

项目主体功能开发期：孕期档案与孕周计算、产检日程、每日健康记录（体重/血压/HCG/尿酸/睡眠/运动/宫缩/胎动等）、饮食推荐与食物安全查询、待产清单、日记、相册、数据看板与导出、提醒推送、企业微信集成等核心模块陆续完成并上架测试。
