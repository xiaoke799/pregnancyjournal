# 孕程记 / Pregnancy Journal

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

> 数据 100% 本地存储 · 零上云 · 隐私优先的孕期管理应用
>
> 100% Local Data Storage · Zero Cloud Upload · Privacy-First Pregnancy Management

---

## 简介 / Introduction

**孕程记**是一款完全本地运行的孕期管理应用，所有数据仅保存在您的个人设备（NAS/电脑）上，不收集、不上传、不同步任何个人数据至任何云端服务器。

**Pregnancy Journal** is a fully local-run pregnancy management app. All data is stored only on your personal device (NAS/PC). It does NOT collect, upload, or sync any personal data to any cloud server.

### 隐私承诺 / Privacy Promise

- 🔒 **数据完全本地存储** — All data stored locally
- 🔒 **零上云** — Zero cloud upload
- 🔒 **零追踪** — No analytics, ads, or tracking SDKs
- 🔒 **零第三方数据传输** — No third-party data sharing
- 🔒 **您完全掌控数据** — You own your data, export anytime

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

## 技术栈 / Tech Stack

### 前端 / Frontend

- **框架**: Vue 3 + TypeScript
- **构建**: Vite 5
- **UI**: Naive UI + Tailwind CSS
- **图表**: ECharts + vue-echarts
- **编辑器**: TipTap (富文本)
- **状态**: Pinia
- **路由**: Vue Router 4

### 后端 / Backend

- **运行时**: Node.js
- **数据库**: SQLite
- **架构**: RESTful API (Express-like routing)

---

## 安装与使用 / Installation & Usage

### 环境要求 / Requirements

- Node.js >= 18
- 支持的平台：Windows / Linux (NAS)

### 快速开始 / Quick Start

```bash
# 克隆项目 / Clone the repository
git clone https://github.com/xiaoke799/pregnancyjournal.git
cd pregnancyjournal

# 安装后端依赖 / Install backend dependencies
cd app/server/node
npm install

# 安装前端依赖 / Install frontend dependencies
cd ../../../frontend
npm install

# 开发模式前端 / Frontend dev mode
npm run dev

# 构建前端 / Build frontend
npm run build

# 启动后端服务 / Start backend service
cd ../app/server/node
node server.js
```

###  FnOS 应用包 / FnOS App Package

本项目也可打包为 FnOS NAS 应用（`.fpk` 格式），直接从 FnOS 应用中心安装。

This project can also be packaged as a FnOS NAS app (`.fpk` format) for direct installation from the FnOS App Center.

---

## 项目结构 / Project Structure

```
pregnancyjournal/
├── app/
│   ├── server/node/        # 后端服务 / Backend service
│   │   ├── routes/         # API 路由 / API routes
│   │   ├── data/           # 静态数据 / Static data
│   │   └── ...
│   └── ui/                 # 前端构建输出 / Frontend build output
├── frontend/               # 前端源码 / Frontend source
│   └── src/
│       ├── api/            # API 客户端 / API client
│       ├── components/     # 组件 / Components
│       ├── views/          # 页面 / Views
│       └── ...
├── server/node/            # 重构后端 / Refactored backend
├── data/                   # 运行时数据 / Runtime data (gitignored)
├── docs/                   # 文档 / Documentation
├── manifest                # 应用清单 / App manifest
└── LICENSE                 # 许可证 / License
```

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
