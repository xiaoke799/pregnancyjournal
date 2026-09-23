# 孕程记 / Pregnancy Journal

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-FnOS%20x86--64%20%2F%20ARM64-8c8c8c.svg)](https://www.fnos.com/)
[![Version](https://img.shields.io/badge/version-0.0.28-green.svg)](manifest)

> 飞牛 OS 原生应用 · 数据 100% 本地存储 · 零上云
>
> FnOS Native App · 100% Local Data Storage · Zero Cloud Upload

---

## 简介 / Introduction

**孕程记**是[飞牛 OS](https://www.fnos.com/)（fnOS）上的一款原生应用，可一键从飞牛应用中心安装。所有数据保存在你的 NAS 本地，不收集、不上传、不同步任何个人数据至任何云端。

**Pregnancy Journal** is a native app for [FnOS](https://www.fnos.com/) (Feiniu OS), installable directly from the FnOS App Center. All data stays on your NAS — no collection, no upload, no sync to any cloud server.

### 隐私承诺 / Privacy Promise

- 🔒 **数据完全本地存储** — All data stored locally on NAS
- 🔒 **零上云** — Zero cloud upload
- 🔒 **零追踪** — No analytics, ads, or tracking SDKs
- 🔒 **零第三方数据传输** — No third-party data sharing
- 🔒 **您完全掌控数据** — You own your data, export anytime

---

## 安装要求 / Requirements

- **系统**: 飞牛 OS >= 1.1.3100 / FnOS >= 1.1.3100
- **运行时**: Node.js v22（应用中心自动安装 / auto-installed by App Center）
- **平台**: x86-64 / ARM64
- **架构**: 飞牛统一网关模式（FnOS unified gateway, app.sock）

### 安装方式 / Installation

从 [Releases](https://github.com/xiaoke799/pregnancyjournal/releases) 页面下载 `pregnancyjournal_v0.0.28.fpk`（约 14.6MB，以 Releases 页最新版为准），然后在飞牛 OS 的「应用中心 → 手动安装」中上传即可。

Download `pregnancyjournal_v0.0.28.fpk` (≈14.6MB; always grab the latest on the Releases page) from [Releases](https://github.com/xiaoke799/pregnancyjournal/releases), then upload it in FnOS App Center via Manual Install.

> 应用依赖已完整内置在安装包中，安装后无需联网下载任何组件。
> All dependencies are bundled in the package — no network download needed after install.

---

## 功能特性 / Features

| 功能 / Feature | 说明 / Description |
|---|---|
| 📋 产检记录 | 产检日程管理、自定义产检、报告上传、指标追踪 / Checkup scheduling, custom checkups, report upload & tracking |
| 📈 体重曲线 | 孕期体重变化可视化 / Weight change visualization |
| ⏱️ 宫缩计时 | 宫缩频率与持续时间记录 / Contraction timing & duration |
| 📷 相册分类 | 孕期照片按阶段分类管理 / Photo management by pregnancy stage |
| 🍽️ 饮食推荐 | 孕期食谱与食物安全查询 / Diet recommendations & food safety lookup |
| ✅ 待产清单 | 待产包与入院准备清单 / Hospital bag & preparation checklist |
| 📝 日记功能 | 富文本孕期日记 / Rich-text pregnancy diary |
| 👶 胎动计数 | 胎动记录与统计 / Fetal movement counting & statistics |
| 🩺 每日健康记录 | HCG、尿酸、睡眠、运动、饮食、服药习惯等 / Daily logs: HCG, uric acid, sleep, exercise, diet & habits |
| 🏷️ 日历标签 | 日历视图自定义标签标记 / Custom calendar tags & labels |
| 🔔 提醒推送 | 产检、补充剂、自定义提醒 / Checkup, supplement & custom reminders |
| 📊 数据看板 | 综合统计仪表盘 / Dashboard with comprehensive stats |
| 📤 数据导出 | 备份与恢复、PDF导出 / Backup, restore & PDF export |
| 🔗 企业微信 | 消息推送集成 / WeCom message integration |

---

## 技术架构 / Architecture

### 飞牛 OS 应用结构 / FnOS App Structure

```
pregnancyjournal/                    # 仓库根 = 应用根 / repo root == app root
├── manifest                # 飞牛 OS 应用清单 / FnOS app manifest
├── cmd/                    # 应用生命周期脚本 / Lifecycle scripts
│   ├── install_init        #   安装前 / Pre-install
│   ├── install_callback    #   安装回调 / Install callback
│   ├── config_init         #   配置初始化 / Config init
│   ├── config_callback     #   配置回调 / Config callback
│   ├── uninstall_init      #   卸载前 / Pre-uninstall
│   └── upgrade_callback    #   升级回调 / Upgrade callback
├── wizard/                 # 安装向导 / Installation wizard
├── config/                 # 应用权限与资源限制 / App privilege & resource
├── app/                    # 运行时载荷（整包为 app.tgz）/ Runtime payload (becomes app.tgz)
│   ├── server/node/        #   后端服务 / Backend service (Node.js)
│   │   ├── routes/         #     API 路由 / API routes
│   │   ├── services/       #     业务逻辑 / Business logic
│   │   ├── data/           #     内置只读知识库 / Bundled read-only assets
│   │   ├── db.js           #     SQLite 数据库 / SQLite database
│   │   ├── storage-migrate.js  # 升级时迁移历史数据 / Migrate legacy data on upgrade
│   │   └── server.js       #     服务入口 / Server entry
│   └── ui/                 #   前端构建产物（gitignored）/ Frontend build output
├── frontend/               # 前端源码 / Frontend source
│   ├── public/config       #   网关配置（构建时自动复制到 app/ui/config）
│   └── src/
│       ├── api/            # API 客户端 / API client
│       ├── components/     # 组件 / Components
│       ├── views/          # 页面 / Views
│       └── stores/         # 状态管理 / State management
├── docs/                   # 文档 / Documentation
├── ICON.PNG                # 应用图标 64x64 / App icon
├── ICON_256.PNG            # 应用图标 256x256 / App icon
├── LICENSE                 # Apache-2.0
├── CHANGELOG.md            # 变更日志 / Changelog
└── build.ps1               # 一键打包脚本 / One-click packaging script
```

> 说明：`manifest` / `cmd/` / `config/` / `wizard/` / `ICON*.PNG` / `LICENSE` 位于仓库根，
> 由 fnpack 打进 `.fpk` 外层；`app/` 整体打包成包内的 `app.tgz`，安装时解到设备上的
> `TRIM_APPDEST`（即 `/vol1/@appcenter/pregnancyjournal`）。
>
> Note: `manifest`, `cmd/`, `config/`, `wizard/`, `ICON*.PNG` and `LICENSE` live at the repo
> root and are packed into the outer `.fpk`; the whole `app/` directory becomes `app.tgz`
> inside the package and is extracted to `TRIM_APPDEST` on the device.

### 统一网关模式 / Unified Gateway Mode

自 v0.0.27 起，应用接入飞牛统一网关，不再占用 TCP 端口：

Since v0.0.27, the app integrates with the FnOS unified gateway instead of binding a TCP port:

- 前端通过 `gatewaySocket: app.sock` + `gatewayPrefix: /app/pregnancyjournal` 接入
- 后端监听 Unix Socket（`FNOS_SOCKET_PATH`），自动剥离网关前缀
- 认证基于网关注入的 `X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username` 请求头
- 启动脚本 `cmd/main` 使用 `setsid` 会话脱离进程，并验证 socket 就绪后才返回

### 技术栈 / Tech Stack

- **前端**: Vue 3 + TypeScript + Vite + Naive UI + ECharts + TipTap
- **后端**: Node.js + Express + SQLite (sql.js) + WebSocket
- **打包**: fnpack（FnOS 应用打包工具 / FnOS packaging tool）+ PowerShell 一键脚本

---

## 开发构建 / Development & Build

### 环境要求 / Requirements

- Node.js >= 18
- PowerShell 7（一键打包脚本需要 / required by the packaging script）
- 飞牛 OS 开发环境与 fnpack（用于 .fpk 打包 / for .fpk packaging）

### 本地开发 / Local Development

```bash
git clone https://github.com/xiaoke799/pregnancyjournal.git
cd pregnancyjournal          # 仓库根即应用根 / repo root is the app root

# 后端 / Backend
cd app/server/node
npm install
node server.js

# 前端 / Frontend（另开一个终端 / in a separate terminal）
cd frontend
npm install
npm run dev
```

### 打包 .fpk / Package FnOS App

```powershell
# 一键打包：清理冗余assets -> 构建校验 -> 安装生产依赖 -> 规范cmd编码 -> 组装stage -> fnpack打包 -> 解包验证
pwsh ./build.ps1
```

手动流程 / Manual steps:

```bash
# 1. 构建前端：产物输出到 app/ui，并把 frontend/public/config 一起带过去
#    （vite base 固定为 /app/pregnancyjournal/，即飞牛网关前缀）
cd frontend && npm install && npm run build

# 2. 组装 stage 后调用 fnpack（build.ps1 做的就是这件事，建议直接用脚本）
#    注意必须用 fnpack 的 build 子命令，手打 tar 会导致安装报 code 10111
fnpack build --directory <组装好的 stage 目录>
```

> 注意：`frontend/public/config` 是网关配置的**唯一源文件**，Vite 构建时会自动复制到
> `app/ui/config`。请只改源文件，不要手工改 `app/ui/config`。
>
> Note: `frontend/public/config` is the single source of truth for the gateway config.
> Vite copies it to `app/ui/config` during build — edit only the source file.

> 打包细节（stage 要放哪些东西、为什么不能用"先整拷再删"、包内如何校验）见
> `DEPLOY_NOTES.md`。

---

## 文档 / Documentation

- [系统设计](docs/system_design.md) / System design
- [开发日志](docs/DEVLOG.md) / Dev log

---

## 许可证 / License

本项目采用 [Apache License 2.0](LICENSE) 开源协议。

This project is licensed under the [Apache License 2.0](LICENSE).

---

## 免责声明 / Disclaimer

本软件提供孕期健康数据的记录和参考功能，但：

- 不提供医疗诊断 — 所有健康建议仅供参考，不能替代专业医疗意见
- 不保证数据准确性 — 用户应自行核实所有记录数据
- 不承担健康责任 — 任何健康决策请咨询专业医生

This software provides pregnancy health data recording and reference functions, but:

- Does NOT provide medical diagnosis — all health advice is for reference only
- Does NOT guarantee data accuracy — users should verify all recorded data
- Does NOT assume health responsibility — consult a professional doctor for health decisions

---

## 关于 / About

**作者**: xiaoke799

**项目主页**: https://github.com/xiaoke799/pregnancyjournal

**致谢**: 本项目为开源学习项目，所有代码均为独立原创编写。

Author: xiaoke799

Homepage: https://github.com/xiaoke799/pregnancyjournal

Acknowledgment: This project is an open-source learning initiative. All code is independently written.
