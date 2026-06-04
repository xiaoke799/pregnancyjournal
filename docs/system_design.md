# 孕程记 V1.0 架构文档

> 文档更新日期：2026-06-03

---

## 一、整体架构概览

```
┌─────────────────────────────────────────────────┐
│                   前端 (Vite + Vue 3)             │
│  frontend/src/                                   │
│  ├── api/         (20 个 API 模块)               │
│  ├── components/  (35+ 组件, 8 个子目录)          │
│  ├── views/       (12 个页面视图)                 │
│  ├── stores/      (2 个 Pinia Store)              │
│  ├── composables/ (3 个组合式函数)                │
│  ├── utils/       (2 个工具模块)                  │
│  └── router/      (1 个路由配置)                  │
├─────────────────────────────────────────────────┤
│               通信协议: HTTP REST + JSON           │
│           Base URL: /api/v1                       │
├─────────────────────────────────────────────────┤
│              后端 (Node.js + Express + sql.js)   │
│  app/server/node/                                │
│  ├── routes/      (19 个路由模块)                 │
│  ├── services/    (2 个服务模块)                  │
│  ├── middleware/  (1 个认证中间件)                 │
│  ├── data/        (2 个 JSON 数据文件)            │
│  ├── db.js        (数据库操作 + 自动迁移)         │
│  ├── config.js    (环境变量配置)                  │
│  ├── logger.js    (日志模块)                      │
│  └── server.js    (启动入口)                      │
└─────────────────────────────────────────────────┘
```

**技术栈：**
- 前端：Vite + Vue 3 + TypeScript + Pinia + Vue Router + Tailwind CSS
- 后端：Node.js + Express + sql.js（内存 SQLite）+ 自动数据库迁移
- 数据库：SQLite (WAL 模式，通过 sql.js 内存运行 + 定时持久化)
- 部署目标：飞牛 fnOS（TRIM_* 环境变量集成）

---

## 二、后端路由 ↔ 前端 API 对应关系

### 2.1 对照表

| # | 后端路由模块 | 后端路由前缀 | 前端 API 文件 | 对照结果 |
|---|------------|------------|-------------|---------|
| 1 | `pregnancy` | `/api/v1/pregnancies` | `pregnancy.ts` | ✅ 完全对应 |
| 2 | `checkup` | `/api/v1/checkups` | `checkup.ts` | ✅ 完全对应 |
| 3 | `lab_result` | `/api/v1/lab-results` | `lab-result.ts` | ✅ 完全对应 |
| 4 | `daily-record` | `/api/v1/daily-records` | `daily-record.ts` | ✅ 完全对应 |
| 5 | `contraction` | `/api/v1/contractions` | `contraction.ts` | ✅ 完全对应 |
| 6 | `photo` | `/api/v1/photos` | `photo.ts` | ✅ 完全对应 |
| 7 | `diary` | `/api/v1/diaries` | `diary.ts` | ✅ 完全对应 |
| 8 | `checklist` | `/api/v1/checklists` | `checklist.ts` | ✅ 完全对应 |
| 9 | `reminder` | `/api/v1/reminders` | `reminder.ts` | ✅ 完全对应 |
| 10 | `fetal_movement` | `/api/v1/fetal-movements` | `fetal-movement.ts` | ✅ 完全对应 |
| 11 | `reference` | `/api/v1/reference` | `reference.ts` | ✅ 完全对应 |
| 12 | `dashboard` | `/api/v1/dashboard` | `dashboard.ts` | ✅ 完全对应 |
| 13 | `export` | `/api/v1/export` | `export.ts` | ✅ 完全对应 |
| 14 | `habit-checkin` | `/api/v1/habit-checkins` | `habitCheckin.ts` | ✅ 完全对应 |
| 15 | `supplement-checkin` | `/api/v1/supplement-checkins` | `supplementCheckin.ts` | ✅ 完全对应 |
| 16 | `app-config` | `/api/v1/app-config` | `app-config.ts` | ✅ 完全对应 |
| 17 | `diet` | `/api/v1/diet` | `diet.ts` | ✅ 完全对应 |
| 18 | `checkup-schedule` | `/api/v1/checkup-schedule` | `checkup-schedule.ts` | ✅ 完全对应 |
| 19 | `logs` | `/api/v1/logs` | - | ✅ 系统日志接口 |

### 2.2 结论

**✅ 后端 19 个路由模块与前端 20 个 API 文件完全对应。** 前端多出的 1 个文件：`client.ts`（Axios 实例配置）。

---

## 三、数据库架构

### 3.1 数据表列表

| 表名 | 说明 | 外键关联 |
|------|------|---------|
| `pregnancy` | 孕期档案 | - |
| `prenatal_checkup` | 产检记录 | → pregnancy |
| `custom_checkup` | 自定义产检 | → pregnancy |
| `checkup_photo` | 产检照片 | → prenatal_checkup |
| `checkup_report` | 产检报告 | → prenatal_checkup |
| `lab_result` | 化验结果 | → prenatal_checkup |
| `daily_record` | 每日记录 | → pregnancy |
| `contraction_session` | 宫缩会话 | - |
| `contraction` | 宫缩记录 | → contraction_session |
| `pregnancy_photo` | 孕期相册 | → pregnancy |
| `diary_entry` | 日记 | → pregnancy |
| `checklist` | 清单 | → pregnancy |
| `checklist_item` | 清单项 | → checklist |
| `reminder` | 提醒 | → pregnancy |
| `fetal_movement_session` | 胎动会话 | - |
| `fetal_movement` | 胎动记录 | → fetal_movement_session |
| `habit_checkin` | 好习惯打卡 | → pregnancy |
| `supplement_checkin` | 营养补充打卡 | → pregnancy |
| `app_config` | 应用配置 | - |

### 3.2 数据库迁移机制

Node.js 后端使用 `db.js` 中的 `migrateDb()` 函数实现自动迁移：
- 每次启动时检查表结构，自动添加缺失列
- 无需 Alembic 等外部迁移工具
- 支持增量迁移，不影响现有数据

---

## 四、fnOS 部署配置

### 4.1 已正确配置项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `manifest` 文件 | ✅ 存在 | 应用元信息（appname: pregnancyjournal） |
| `cmd/` 脚本 | ✅ 完整 | install/upgrade/uninstall/config 回调 |
| `app/ui/config` | ✅ 存在 | 飞牛 UI 配置 |
| `app/ui/images/` | ✅ 存在 | icon_64.png, icon_256.png |
| `config/resource` | ✅ 存在 | 共享目录配置 |
| `config/privilege` | ✅ 存在 | 权限配置 |
| `wizard/` 目录 | ✅ 存在 | 安装向导 |

- `config.js` 正确读取飞牛环境变量：
  - `TRIM_APPDEST`：应用安装目录
  - `TRIM_PKGVAR`：持久化数据目录
  - `TRIM_DATA_SHARE_PATHS`：NAS 共享目录
  - `TRIM_SERVICE_PORT`：服务端口（默认 21039）
- 数据库路径默认指向 `TRIM_PKGVAR`：符合飞牛规范
- 文件存储（photos/thumbnails/backups/media）默认指向 `TRIM_DATA_SHARE_PATHS`：符合飞牛规范
- `server.js` 正确监听 `0.0.0.0:PORT` TCP 模式
- 认证中间件支持 `X-Trim-Userid` 等飞牛网关 Header

### 4.2 运行依赖

- Node.js v24（`nodejs_v24`）
- 无 Python 依赖（已完全移除）

---

## 五、前端路由完整性

### 5.1 路由对照表

| 路由路径 | 路由名称 | 页面组件 | 存在状态 |
|---------|---------|---------|---------|
| `/` | `dashboard` | `DashboardView.vue` | ✅ |
| `/record` | `record` | `RecordView.vue` | ✅ |
| `/album` | `album` | `AlbumView.vue` | ✅ |
| `/checkup-schedule` | `checkup-schedule` | `CheckupScheduleView.vue` | ✅ |
| `/diet` | `diet` | `DietView.vue` | ✅ |
| `/checklist` | `checklist` | `ChecklistView.vue` | ✅ |
| `/settings` | `settings` | `SettingsView.vue` | ✅ |
| `/contraction-timer` | `contraction-timer` | `ContractionTimerView.vue` | ✅ |
| `/fetal-movement-counter` | `fetal-movement-counter` | `FetalMovementCounterView.vue` | ✅ |
| `/setup` | `setup` | `SetupWizardView.vue` | ✅ |

### 5.2 路由守卫

- `beforeEach` 守卫检查设置完成状态：未完成则重定向到 `/setup`
- 使用 **Hash 路由模式**（`createWebHashHistory`），适配飞牛网关路径前缀

---

## 六、组件结构

```
components/
├── album/           (BellyTimeline, PhotoCompare, PhotoUploadDialog, MilestoneGallery, UltrasoundGallery)
├── calendar/        (CheckupPlanList, MonthCalendar, DayRecordPopup)
├── chart/           (BodyTempChart, BloodGlucoseChart, FetalHeartRateChart, HCGTrendChart, LabResultTrendChart, WeightChart)
├── checklist/       (ChecklistItemRow, ChecklistPanel)
├── checkup/         (CheckupForm, CheckupList, CheckupPhotoUpload, LabResultForm, ReferenceRangeSlider)
├── common/          (AppHeader, ConfirmDialog, EmptyState, LoadingSkeleton)
├── dashboard/       (DevelopmentSummary, GestationalCard, QuickRecordGrid, TodayReminder)
├── record/          (AddRecordDialog, BodyTempDialog, BloodGlucoseDialog, DateDetailDrawer, FetalHeartRateDialog, HabitCheckinDialog, MiniCalendar, MoodDialog, PregnacyCalendar, RecordIconGrid, RecordList, StoolDialog, SupplementDialog, SymptomDialog, WeightDialog)
├── reference/       (CheckupKnowledge, DevelopmentDetail, FoodSafetySearch)
└── settings/        (DueDateSetting, ExportPanel, PregnancySwitcher, ReminderSetting)
```

### 6.1 引用链

```
Views (10)  →  Components (35+)  →  API (20)  →  Backend (19 routes)
    │                │
    └── Stores (2) ──┘── Composables (3) ──┘── Utils (3)
```

---

## 七、后端依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `express` | ^4.21.0 | Web 框架 |
| `sql.js` | ^1.10.0 | SQLite（内存版） |
| `multer` | ^1.4.5-lts.1 | 文件上传 |
| `cors` | ^2.8.5 | 跨域支持 |
| `uuid` | ^10.0.0 | UUID 生成 |
| `archiver` | ^7.0.1 | 压缩/备份 |
| `mime-types` | ^2.1.35 | MIME 类型识别 |

---

## 八、架构评审结论

### 8.1 评分汇总

| 评审维度 | 评分 | 说明 |
|---------|------|------|
| 路由-API 对应 | ⭐⭐⭐⭐⭐ | 19 个路由模块与前端 API 文件完全对应 |
| 数据完整性 | ⭐⭐⭐⭐⭐ | 19 个数据表，字段定义清晰 |
| fnOS 部署配置 | ⭐⭐⭐⭐⭐ | 环境变量集成正确，脚本完整 |
| 前端路由完整性 | ⭐⭐⭐⭐⭐ | 10 个视图均有路由，结构清晰 |
| 组件依赖合理性 | ⭐⭐⭐⭐⭐ | 依赖方向清晰，按功能域划分 |
| 数据安全 | ⭐⭐⭐⭐⭐ | 路径遍历防护、文件类型白名单、上传大小限制均到位 |

### 8.2 总评

**孕程记 V1.0 系统架构良好，结构清晰，前后端接口对应完整。** 纯 Node.js 技术栈，零 Python 依赖，部署轻量。
