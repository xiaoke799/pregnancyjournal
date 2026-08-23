# 孕程记 / Pregnancy Journal

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-FnOS%20x86--64-8c8c8c.svg)](https://www.fnos.com/)
[![Version](https://img.shields.io/badge/version-0.0.26-green.svg)](manifest)

> 飞牛 OS 原生应用 · 数据 100% 本地存储 · 零上云
>
> FnOS Native App · 100% Local Data Storage · Zero Cloud Upload

---

## 简介 / Introduction

**孕程记**是[飞牛 OS](https://www.com)（fnOS）上的一款原生应用，可一键从飞牛应用中心安装。所有数据保存在你的 NAS 本地，不收集、不上传、不同步任何个人数据至任何云端。

**Pregnancy Journal** is a native app for [FnOS](https://www.fnos.com/) (Feiou OS), installable directly from the FnOS App Center. All data stays on your NAS — no collection, no upload, no sync to any cloud server.

### 隐私承诺 / Privacy Promise

- 🔒 **数据完全本地存储** — All data stored locally on NAS
- 🔒 **零上云** — Zero cloud upload
- 🔒 **零追踪** — No analytics, ads, or tracking SDKs
- 🔒 **零第三方数据传输** — No third-party data sharing
- 🔒 **您完全掌控数据** — You own your data, export anytime

---

## 安装要求 / Requirements

- **系统**: 飞牛 OS >= 0.9.21 / FnOS >= 0.9.21
- **运行时**: Node.js v22（应用中心自动安装）
- **平台**: x86-64（暂不支持 ARM / ARM64）

### 安装方式 / Installation

**方式 1：应用中心一键安装（推荐）**

直接在飞牛 OS 应用中心搜索"孕程记"安装。

Install directly from the FnOS App Center by searching "孕程记".

**方式 2：手动安装 .fpk 包**

从 [Releases](https://github.com/xiaoke799/pregnancyjournal/releases) 页面下载 `.fpk` 文件，在飞牛 OS 中手动上传安装。

Download the `.fpk` package from [Releases](https://github.com/xiaoke799/pregnancyjournal/releases) and upload it in FnOS.

---

## 功能特性 / Features

| 功能 / Feature | 说明 / Description |
|---|---|
| 📋 产检记录 | 产检日程管理、报告上传、指标追踪 / Checkup scheduling, report upload, indicator tracking |
| 📈 体重曲线 | 孕期体重变化可视化 / Weight change visualization |
| ⏱️ 宫缩计时 | 宫缩频率与持续时间记录 / Contraction timing & duration |
| 📷 相册分类 | 孕期照片按阶段分类管理 / Photo management by pregnancy stage |
| 🍽️ 饮食推荐 | 孕期食谱与食物安全查询 / Diet recommendations & food safety lookup |
| ✅ 待产清单 | 待产包与入院准备清单 / Hospital bag & preparation checklist |
| 📝 日记功能 | 富文本孕期日记 / Rich-text pregnancy diary |
| 👶 胎动计数 | 胎动记录与统计 / Fetal movement counting & statistics |
| 💊 补充剂打卡 | 孕期维生素与补充剂提醒 / Supplement reminders & check-in |
| 📊 数据看板 | 综合统计仪表盘 / Dashboard with comprehensive stats |
| 🔔 提醒推送 | 产检、补充剂、自定义提醒 / Checkup, supplement & custom reminders |
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
│   └── ui/                 # 前端界面 / Frontend (FnOS embedded)
├── server/node/            # 运行时代码（重构版）/ Runtime (refactored)
├── frontend/               # 前端源码 / Frontend source
│   └── src/
│       ├── api/            # API 客户端 / API client
│       ├── components/     # 组件 / Components
│       ├── views/          # 页面 / Views
│       └── stores/         # 状态管理 / State management
├── data/                   # 用户数据目录 / User data (gitignored)
├── docs/                   # 文档 / Documentation
└── *.fpk                   # 打包产物 / Build artifact (gitignored)
```

### 技术栈 / Tech Stack

- **前端**: Vue 3 + TypeScript + Vite + Naive UI + ECharts + TipTap
- **后端**: Node.js + Express-like routing + SQLite
- **打包**: fnpack（FnOS 应用打包工具 / FnOS packaging tool）

---

## 开发构建 / Development & Build

### 环境要求 / Requirements

- Node.js >= 18
- 飞牛 OS 开发环境（用于 .fpk 打包）

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

```bash
# 1. Build 前端 / Build frontend
cd frontend && npm run build

# 2. 使用 fnpack 打包成 .fpk / Package with fnpack
cd ..
fnpack pack -o pregnancyjournal.fpk
```

打包后的 `.fpp` 文件可直接拖入飞牛 OS 安装。

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

**应用中心**: 飞牛 OS 应用中心（搜索"孕程记"）

**致谢**: 本项目为开源学习项目，所有代码均为独立原创编写。

Author: xiaoke799

Homepage: https://github.com/xiaoke799/pregnancyjournal

App Center: FnOS App Center (search "孕程记")

Acknowledgment: This project is an open-source learning initiative. All code is independently written.
