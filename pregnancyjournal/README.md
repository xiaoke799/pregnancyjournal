# 孕程记 / Pregnancy Journal

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-FnOS%20x86--64%20%2F%20ARM64-8c8c8c.svg)](https://www.fnos.com/)
[![Version](https://img.shields.io/badge/version-0.0.27-green.svg)](manifest)

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

从 [Releases](https://github.com/xiaoke799/pregnancyjournal/releases) 页面下载 `pregnancyjournal_v0.0.27.fpk`（约 14.6MB），然后在飞牛 OS 的「应用中心 → 手动安装」中上传即可。

Download `pregnancyjournal_v0.0.27.fpk` (≈14.6MB) from [Releases](https://github.com/xiaoke799/pregnancyjournal/releases), then upload it in FnOS App Center via Manual Install.

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
pregnancyjournal/
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
├── app/
│   ├── server/node/        # 后端服务 / Backend service (Node.js)
│   │   ├── routes/         #   API 路由 / API routes
│   │   ├── services/       #   业务逻辑 / Business logic
│   │   ├── data/           #   静态数据 / Static data
│   │   ├── db.js           #   SQLite 数据库 / SQLite database
│   │   └── server.js       #   服务入口 / Server entry
│   └── ui/                 # 前端构建产物 / Frontend build output (gitignored)
├── server/node/            # 运行时代码（重构版）/ Runtime (refactored)
├── frontend/               # 前端源码 / Frontend source
│   ├── public/config       #   网关配置（构建时自动复制）/ Gateway config (copied at build)
│   └── src/
│       ├── api/            # API 客户端 / API client
│       ├── components/     # 组件 / Components
│       ├── views/          # 页面 / Views
│       └── stores/         # 状态管理 / State management
├── ui/                     # 前端构建产物同步 / Frontend build sync target
├── docs/                   # 文档 / Documentation
└── build.ps1               # 一键打包脚本 / One-click packaging script
```

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
cd pregnancyjournal

# 后端 / Backend
cd app/server/node
npm install
node server.js

# 前端 / Frontend (独立开发)
cd ../../../frontend
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
# 1. 构建前端（输出到 ../app/ui，注意 vite base 为 /app/pregnancyjournal/）
cd frontend && npm install && npm run build

# 2. 用 fnpack 打包 / Package with fnpack
fnpack pack --directory .
```

> 注意：`frontend/public/config` 为网关配置源文件，构建时会自动复制到 `app/ui/config`，
> 请勿手工修改 `app/ui/config`，保持三处（public/app\ui/ui）一致。
>
> Note: `frontend/public/config` is the source of truth for the gateway config.
> Vite copies it to `app/ui/config` during build — keep all three copies in sync.

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
