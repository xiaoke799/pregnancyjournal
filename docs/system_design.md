# 孕程记 V1.0 架构审查报告

> 审查人：高见远（架构师）｜ 审查日期：2025-06-01

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
│              后端 (FastAPI + SQLAlchemy 异步)     │
│  app/server/backend/                             │
│  ├── routers/     (18 个路由模块)                 │
│  ├── models/      (14 个数据模型)                 │
│  ├── schemas/     (13 个 Schema 模块)             │
│  ├── services/    (6 个服务模块)                  │
│  ├── middleware/  (1 个认证中间件)                 │
│  └── data/        (12 个 JSON 数据文件)            │
└─────────────────────────────────────────────────┘
```

**技术栈：**
- 前端：Vite + Vue 3 + TypeScript + Pinia + Vue Router + Tailwind CSS
- 后端：Python FastAPI + SQLAlchemy 2.0（异步）+ aiosqlite + Pydantic v2
- 数据库：SQLite (WAL 模式)
- 部署目标：飞牛 fnOS（TRIM_* 环境变量集成）

---

## 二、后端路由 ↔ 前端 API 对应关系

### 2.1 对照表

| # | 后端路由模块 | 后端路由前缀 | 前端 API 文件 | 对照结果 |
|---|------------|------------|-------------|---------|
| 1 | `pregnancy` | `/api/v1/pregnancies` | `pregnancy.ts` | ✅ 完全对应 |
| 2 | `checkup` | `/api/v1/checkups` | `checkup.ts` | ✅ 完全对应 |
| 3 | `lab_result` | `/api/v1/lab-results` | `lab-result.ts` | ✅ 完全对应 |
| 4 | `daily_record` | `/api/v1/daily-records` | `daily-record.ts` | ✅ 完全对应 |
| 5 | `contraction` | `/api/v1/contractions` | `contraction.ts` | ✅ 完全对应 |
| 6 | `photo` | `/api/v1/photos` | `photo.ts` | ✅ 完全对应 |
| 7 | `diary` | `/api/v1/diaries` | `diary.ts` | ✅ 完全对应 |
| 8 | `checklist` | `/api/v1/checklists` | `checklist.ts` | ✅ 完全对应 |
| 9 | `reminder` | `/api/v1/reminders` | `reminder.ts` | ✅ 完全对应 |
| 10 | `fetal_movement` | `/api/v1/fetal-movements` | `fetal-movement.ts` | ✅ 完全对应 |
| 11 | `reference` | `/api/v1/reference` | `reference.ts` | ✅ 完全对应 |
| 12 | `dashboard` | `/api/v1/dashboard` | `dashboard.ts` | ✅ 完全对应 |
| 13 | `export` | `/api/v1/export` | `export.ts` | ✅ 完全对应 |
| 14 | `habit_checkin` | `/api/v1/habit-checkins` | `habitCheckin.ts` | ✅ 完全对应 |
| 15 | `supplement_checkin` | `/api/v1/supplement-checkins` | `supplementCheckin.ts` | ✅ 完全对应 |
| 16 | `app_config` | `/api/v1/app-config` | `app-config.ts` | ✅ 完全对应 |
| 17 | `diet` | `/api/v1/diet` | `diet.ts` | ✅ 完全对应 |
| 18 | `checkup_schedule` | `/api/v1/checkup-schedule` | `checkup-schedule.ts` | ✅ 完全对应 |

### 2.2 结论

**✅ 后端 18 个路由模块与前端 20 个 API 文件完全对应。** 前端多出的 2 个文件：`client.ts`（Axios 实例配置）和 `export.ts` 中的 `createBackup`（后端 `/export/backup`）和 `importBackup`（后端 `/export/import`）均已正确映射。

### 2.3 路由冲突风险

- `checkup` 路由中混入了 `checkup-schedule/{pregnancy_id}/dates` 端点（第530行），与 `checkup_schedule` 路由模块存在**语义上的交叉**，但功能上不冲突。
- 建议将 Dates 管理统一到 `checkup_schedule.py` 路由中。

---

## 三、数据模型 ↔ Schema 字段一致性

### 3.1 逐模块分析

#### ✅ Pregnancy（孕期档案）
- Model `Pregnancy` ↔ Schema `PregnancyCreate/Update/Response`：字段完全一致
- `is_active` 使用 `int` 类型（0/1），Schema 亦为 `int`：一致

#### ✅ Checkup（产检记录）
- Model `PrenatalCheckup` ↔ Schema `CheckupCreate/Update/Response`：字段完全一致
- `CheckupPhoto`、`CustomCheckup`、`CheckupReport` 的 Model ↔ Schema 均一致

#### ⚠️ DailyRecord（每日记录）— 存在问题

| 字段 | Model 定义 | Schema Response | 状态 |
|------|-----------|----------------|------|
| `body_temperature` | `Column(Float)` | `body_temp: Optional[float]` | ❌ **字段名不一致** |

**详细分析：**
- **Model** 使用 `body_temperature`（完整单词）
- **Schema `DailyRecordResponse`** 使用 `body_temp`（缩写）
- **Schema `DailyRecordCreate`** 使用 `body_temperature` ✅
- **Schema `DailyRecordUpdate`** 使用 `body_temp` ❌（与 Model 不一致）

**影响：** Response 序列化时，Pydantic 的 `from_attributes=True` 会尝试从 Model 属性 `body_temp` 读取，但 Model 上的列名是 `body_temperature`，导致**该字段在 API 响应中始终为 None**。

#### ✅ LabResult（检查指标）
- Model ↔ Schema `LabResultCreate/Update/Response/TrendResponse`：字段一致

#### ✅ Contraction（宫缩计时）
- Model `ContractionSession/Contraction` ↔ Schema：字段一致

#### ✅ FetalMovement（胎动计数）
- Model ↔ Schema：字段一致

#### ✅ Photo（照片/视频）
- Model `PregnancyPhoto` ↔ Schema `PhotoCreate/Update/Response`：字段一致

#### ✅ Diary（日记）
- Model `DiaryEntry` ↔ Schema `DiaryCreate/Update/Response`：字段一致

#### ✅ Checklist（清单）
- Model `Checklist/ChecklistItem` ↔ Schema：字段一致

#### ✅ Reminder（提醒）
- Model ↔ Schema：字段一致

#### ✅ HabitCheckin（好习惯打卡）
- Model ↔ Schema：字段一致（含 `field_validator` 处理 JSON 字段）

#### ✅ SupplementCheckin（营养补充）
- Model ↔ Schema：字段一致（含 `field_validator` 处理 JSON 字段）

#### ✅ AppConfig（应用配置）
- Model ↔ Schema：字段一致

### 3.2 结论

**共发现 1 处字段名不一致问题：**
- **DailyRecord 的 `body_temperature` ↔ `body_temp`**：这是唯一的 Model-Schema 不一致，但影响面大（每日记录是核心功能），需优先修复。

---

## 四、fnOS 部署配置检查

### 4.1 缺失项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `manifest/` 目录 | ❌ 不存在 | 项目根目录无 manifest 文件夹 |
| Dockerfile | ❌ 不存在 | 无容器化配置 |
| `docker-compose.yml` | ❌ 不存在 | 无编排配置 |
| `app/ui/config` | ✅ 存在 | 飞牛 UI 配置文件（74 bytes） |
| `app/ui/images/` | ✅ 存在 | 含 icon_64.png, icon_256.png |
| `app/server/pj-venv.tar.gz` | ✅ 存在 | 预打包的 Python 虚拟环境 |

### 4.2 已正确配置项

- `config.py` 正确读取飞牛环境变量：
  - `TRIM_APPDEST`：应用安装目录
  - `TRIM_PKGVAR`：持久化数据目录
  - `TRIM_DATA_SHARE_PATHS`：NAS 共享目录
  - `TRIM_SERVICE_PORT`：服务端口（默认 8680）
- 数据库路径默认指向 `TRIM_PKGVAR`：符合飞牛规范
- 文件存储（photos/thumbnails/backups/media）默认指向 `TRIM_DATA_SHARE_PATHS`：符合飞牛规范
- `main.py` 正确监听 `0.0.0.0:PORT` TCP 模式
- 认证中间件支持 `X-Trim-Userid` 等飞牛网关 Header

### 4.3 结论

**飞牛环境变量集成正确，应用配置层面无问题。但缺少部署清单文件（manifest）**，建议补充：
1. `manifest/` 目录（含应用元信息描述）
2. `app/ui/config` 确保为飞牛要求的 JSON 格式
3. 前端构建产物路径映射配置

---

## 五、前端路由完整性

### 5.1 路由对照表

| 路由路径 | 路由名称 | 页面组件 | 存在状态 |
|---------|---------|---------|---------|
| `/` | `dashboard` | `DashboardView.vue` | ✅ |
| `/record` | `record` | `RecordView.vue` | ✅ |
| `/calendar` | - | 重定向到 `/record` | ⚠️ 存在 `CalendarView.vue` 但未直接使用 |
| `/album` | `album` | `AlbumView.vue` | ✅ |
| `/checkup-schedule` | `checkup-schedule` | `CheckupScheduleView.vue` | ✅ |
| `/diet` | `diet` | `DietView.vue` | ✅ |
| `/checklist` | `checklist` | `ChecklistView.vue` | ✅ |
| `/reference` | - | 重定向到 `/diet` | ⚠️ 存在 `ReferenceView.vue` 但被重定向 |
| `/settings` | `settings` | `SettingsView.vue` | ✅ |
| `/contraction-timer` | `contraction-timer` | `ContractionTimerView.vue` | ✅ |
| `/fetal-movement-counter` | `fetal-movement-counter` | `FetalMovementCounterView.vue` | ✅ |
| `/setup` | `setup` | `SetupWizardView.vue` | ✅ |

### 5.2 发现问题

1. **`CalendarView.vue` 文件存在但未被任何路由直接引用**：`/calendar` 路由仅做重定向到 `/record`。如果 `CalendarView` 是废弃组件，建议删除或确认其用途。

2. **`ReferenceView.vue` 文件存在但路由被重定向到 `/diet`**：参考数据查看功能被重定向到饮食页面，用户无法直接访问参考数据视图。这可能是有意设计（将参考功能整合进了饮食页面），但建议确认。

### 5.3 路由守卫

- `beforeEach` 守卫检查设置完成状态：未完成则重定向到 `/setup`
- 使用 **Hash 路由模式**（`createWebHashHistory`），适配飞牛网关路径前缀

### 5.4 结论

**前端路由基本完整，12 个视图文件均有对应的路由配置。** 存在 2 个"孤儿"视图文件（`CalendarView.vue`、`ReferenceView.vue`），建议确认其用途后清理或恢复路由。

---

## 六、组件依赖和引用关系

### 6.1 组件目录结构

```
components/
├── album/           (4 组件: PhotoCompare, PhotoUploadDialog, MilestoneGallery, UltrasoundGallery, BellyTimeline)
├── calendar/        (2 组件: CheckupPlanList, MonthCalendar)
├── chart/           (5 组件: HCGTrendChart, WeightChart, BodyTempChart, FetalHeartRateChart, BloodGlucoseChart, LabResultTrendChart)
├── checklist/       (2 组件: ChecklistItemRow, ChecklistPanel)
├── checkup/         (4 组件: CheckupList, LabResultForm, CheckupPhotoUpload, ReferenceRangeSlider)
├── common/          (4 组件: EmptyState, AppHeader, LoadingSkeleton, ConfirmDialog)
├── dashboard/       (3 组件: QuickRecordGrid, TodayReminder, DevelopmentSummary)
├── record/          (9 组件: MoodDialog, WeightDialog, SymptomDialog, BloodGlucoseDialog, StoolDialog, BodyTempDialog, FetalHeartRateDialog, HabitCheckinDialog, SupplementDialog, RecordIconGrid)
├── reference/       (3 组件: CheckupKnowledge, DevelopmentDetail, FoodSafetySearch)
└── settings/        (3 组件: ExportPanel, PregnancySwitcher, BackupPanel)
```

### 6.2 引用链分析

```
Views (12)  →  Components (35+)  →  API (20)  →  Backend (18 routers)
    │                │
    └── Stores (2) ──┘── Composables (3) ──┘── Utils (2)
```

### 6.3 Store 依赖问题

**`useRecordStore`（record.ts）存在问题：**
- 直接绕过 API 模块，使用 `axios.get(`/api/v1/daily-records/${today}`)` 硬编码路径
- 引入了 `dayjs` 但 import 语句在文件末尾（第35行），不符合规范
- 响应处理逻辑 `res.data?.code` 不正确：因 client.ts 响应拦截器已返回 `response.data`，应使用 `res.code` 而非 `res.data?.code`

### 6.4 结论

**组件结构按功能域划分清晰，依赖方向合理（View → Component → API）。** 发现 1 处 Store 的 API 调用不规范（硬编码路径 + 响应解构错误）。

---

## 七、其他发现

### 7.1 Schema `__init__.py` 导出不完整

`schemas/__init__.py` 仅导出 `ApiResponse` 和 `PaginatedResponse`，未导出各业务 Schema。虽不影响功能（router 直接导入具体模块），但缺少标准化的 Schema 导出入口。

### 7.2 提醒模型缺少 `created_at`/`updated_at` 导出

`ReminderResponse` 包含 `created_at` 和 `updated_at`，与 Model 对应字段一致，无问题。

### 7.3 数据库迁移

存在 2 个 Alembic 迁移版本：
- `001_initial.py`
- `002_v2_additions.py`

但缺少 V3.0 字段新增（如 DailyRecord 的 `hcg_value`、`uric_acid` 等）的迁移脚本。依赖 `Base.metadata.create_all` 自动建表，在生产环境中缺少版本管控。

### 7.4 内存状态存储风险

`checkup.py` 的 `SCHEDULE_DATES` 字典存储在模块级全局变量中，服务重启后数据丢失。应持久化到数据库或 AppConfig 中。

---

## 八、架构评审结论

### 8.1 评分汇总

| 评审维度 | 评分 | 说明 |
|---------|------|------|
| 路由-API 对应 | ⭐⭐⭐⭐⭐ | 18 个路由模块与 20 个前端 API 文件完全对应 |
| Model-Schema 一致性 | ⭐⭐⭐⭐ | 14 个模型中 13 个一致，1 个存在字段名不匹配 |
| fnOS 部署配置 | ⭐⭐⭐ | 环境变量集成正确，但缺少 manifest 目录和容器化配置 |
| 前端路由完整性 | ⭐⭐⭐⭐ | 12 个视图均有路由，2 个视图文件处于孤儿状态 |
| 组件依赖合理性 | ⭐⭐⭐⭐ | 依赖方向清晰，1 处 Store 调用不规范 |
| 数据安全 | ⭐⭐⭐⭐ | 路径遍历防护、文件类型白名单、上传大小限制均到位 |

### 8.2 总评

**孕程记 V1.0 系统架构整体良好，结构清晰，前后端接口对应完整。** 发现的问题均为中低严重度，不存在阻塞性架构缺陷。

### 8.3 建议修复优先级

| 优先级 | 问题 | 影响范围 |
|--------|------|---------|
| **P0 高** | DailyRecord `body_temperature` ↔ `body_temp` 字段名不一致 | 每日记录 API 的体温字段返回始终为 None |
| **P1 中** | `useRecordStore` API 调用不规范（硬编码路径 + 响应解构错误） | 今日记录读取功能 |
| **P1 中** | 缺少 `manifest/` 部署配置目录 | fnOS 部署完整性 |
| **P2 低** | 孤儿视图文件（CalendarView, ReferenceView） | 代码清洁度 |
| **P2 低** | checkup 路由混入 schedule dates 管理 | 代码组织性 |
| **P2 低** | 内存状态 `SCHEDULE_DATES` 不持久化 | 产检日期设置在服务重启后丢失 |
| **P2 低** | Schema `__init__.py` 导出不完整 | 代码规范性 |
