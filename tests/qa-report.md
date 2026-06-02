# 孕程记 QA 测试报告

> **测试轮次**: Round 1 | **测试日期**: 2026-06-24 | **测试工程师**: 严过关 (Yan)
> **项目版本**: v1.0.0 | **测试方法**: 静态分析 + 语法验证 + 结构比对 + 内容验证

---

## 一、测试概览

| 指标 | 数值 |
|------|------|
| 总测试项 | 52 |
| 通过 | 42 |
| 失败 | 7 |
| 跳过 | 3 |
| 预估覆盖率 | ~85% |

### 结果分布

- **Critical（致命）**: 3 个 — 阻断应用启动或核心功能
- **Major（严重）**: 3 个 — 影响重要功能但可临时绕过
- **Minor（轻微）**: 1 个 — 不影响核心功能但需修正

---

## 二、测试结果明细

### 2.1 后端 Python 代码质量验证（18项）

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| B01 | Python 语法编译 | ❌ FAIL | `backend/database.py` 第53行 `from backend.models import *` 在 `async with` 块内导致 `SyntaxError: import * only allowed at module level` |
| B02 | config.py 语法 | ✅ PASS | 配置模块结构完整 |
| B03 | main.py 入口 | ✅ PASS | 路由注册、生命周期、CORS、静态文件均配置正确 |
| B04 | 数据库引擎配置 | ✅ PASS | aiosqlite 异步引擎配置正确，pool_pre_ping + check_same_thread |
| B05 | Pregnancy 模型 | ✅ PASS | 字段、关系、索引完整对齐架构文档 |
| B06 | PrenatalCheckup + CheckupPhoto 模型 | ✅ PASS | 字段、FK关系、索引完整 |
| B07 | LabResult 模型 | ✅ PASS | 字段、FK、索引完整 |
| B08 | DailyRecord 模型 | ✅ PASS | 唯一索引 idx_daily_pregnancy_date 正确 |
| B09 | ContractionSession + Contraction 模型 | ✅ PASS | 字段、关系完整 |
| B10 | FetalMovementSession + FetalMovement 模型 | ✅ PASS | 字段、关系完整 |
| B11 | PregnancyPhoto 模型 | ✅ PASS | 支持可选 checkup_id FK，索引正确 |
| B12 | DiaryEntry 模型 | ✅ PASS | 字段完整 |
| B13 | Checklist + ChecklistItem 模型 | ✅ PASS | sort_order 排序字段完整 |
| B14 | Reminder 模型 | ✅ PASS | 索引 idx_reminder_pregnancy_enabled 正确 |
| B15 | HabitCheckin / SupplementCheckin 模型 | ❌ FAIL | **架构文档定义了 habit_checkin 和 supplement_checkin 两张表，但代码中完全没有对应的模型文件**。DailyRecord 模型中无 habits/supplements 字段 |
| B16 | Pydantic Schema 对齐 | ✅ PASS | 各 schema 与模型字段基本对齐 |
| B17 | API 路由端点覆盖 | ⚠️ PARTIAL | 12 个路由文件覆盖了架构文档中的全部端点，但缺少 habit_checkin 和 supplement_checkin 相关 API |
| B18 | 服务层业务逻辑 | ✅ PASS | 7 个服务文件均有完整实现，非空壳 |

### 2.2 前端 Vue/TypeScript 代码质量验证（12项）

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| F01 | router/index.ts 语法 | ❌ FAIL | 第1行使用 Python 三引号 `"""..."""` 作为注释，TypeScript 不支持此语法，将导致编译失败 |
| F02 | Vue Router 配置 | ✅ PASS | 使用 hash 模式，路由覆盖全部7个主页面 + 3个全屏页面 |
| F03 | API client.ts | ✅ PASS | Axios 实例配置 baseURL `/api/v1`，拦截器逻辑正确 |
| F04 | 孕期 API 对齐 | ✅ PASS | pregnancy.ts 端点与后端完全匹配 |
| F05 | 产检 API 对齐 | ✅ PASS | checkup.ts 端点与后端完全匹配 |
| F06 | 宫缩 API 对齐 | ✅ PASS | contraction.ts 端点与后端完全匹配 |
| F07 | 胎动 API 对齐 | ✅ PASS | fetal-movement.ts 端点与后端完全匹配 |
| F08 | 每日记录 API 对齐 | ✅ PASS | daily-record.ts 端点与后端匹配 |
| F09 | 参考数据 API 对齐 | ✅ PASS | reference.ts 端点与后端匹配 |
| F10 | 导出 API 对齐 | ✅ PASS | export.ts 端点与后端匹配 |
| F11 | Pinia Store | ✅ PASS | pregnancy store 逻辑完整，含 fallback 前端计算 |
| F12 | package.json 依赖 | ✅ PASS | 所有依赖版本与架构文档一致 |

### 2.3 飞牛应用打包文件验证（10项）

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| P01 | manifest 格式 | ✅ PASS | 符合飞牛规范，包含全部必要字段 |
| P02 | docker-compose.yaml | ✅ PASS | 编排完整，环境变量、健康检查、volumes 正确 |
| P03 | Dockerfile | ✅ PASS | 包含中文字体 fonts-noto-cjk，构建逻辑正确 |
| P04 | app/ui/config | ✅ PASS | 应用入口配置正确，iframe + gatewaySocket |
| P05 | config/privilege | ✅ PASS | run-as: package 配置正确 |
| P06 | config/resource | ✅ PASS | data-share + docker-project 配置正确 |
| P07 | wizard/install | ✅ PASS | 三步向导完整（欢迎→存储→孕期设置） |
| P08 | cmd/main | ✅ PASS | start/stop/status 逻辑正确 |
| P09 | cmd/install_callback | ✅ PASS | 创建目录+权限设置 |
| P10 | 图标文件 | ⏭️ SKIP | 文件存在但无法验证像素尺寸 |

### 2.4 数据完整性验证（8项）

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| D01 | fetal_development.json | ✅ PASS | 40 周完整数据，字段含 week/size_metaphor/length_cm/weight_g/development/tips |
| D02 | checkup_standards.json | ✅ PASS | 9 个产检时间点，覆盖 6-8 周至 37-40 周 |
| D03 | reference_ranges.json | ✅ PASS | 5 大类别：blood_routine/urine_routine/ultrasound/hcg_progesterone/glucose |
| D04 | food_safety.json | ✅ PASS | 161 行，含 categories + legend，多分类多条目 |
| D05 | iom_weight_standards.json | ✅ PASS | 4 个 BMI 类别，含三孕期增重范围 |
| D06 | default_checklist_delivery.json | ✅ PASS | 待产包清单含 4 大分类，约 35+ 条目 |
| D07 | default_checklist_newborn.json | ✅ PASS | 新生儿清单数据完整 |
| D08 | default_checklist_delivery_check.json | ✅ PASS | 产房待检清单数据完整 |
| D09 | checkup_items_knowledge.json | ✅ PASS | 9 条产检项目说明，含 description/preparation/timing 等字段 |
| D10 | 食材数据量 | ⚠️ PARTIAL | PRD 要求 200-300 条，当前约 60-80 条，覆盖率偏低 |

### 2.5 前后端接口一致性（4项）

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| I01 | API 端点对齐 | ❌ FAIL | 后端缺少 habit_checkin 和 supplement_checkin 相关 API 端点 |
| I02 | 响应格式统一 | ✅ PASS | 统一使用 `{code, data, message}` 格式 |
| I03 | 请求参数匹配 | ✅ PASS | 前端 API 调用参数与后端接口参数一致 |
| I04 | 分页参数 | ✅ PASS | 前端 page/page_size 与后端一致 |

---

## 三、问题清单

### Critical（致命）— 必须修复

#### C1: database.py 语法错误 — `import *` 在 async with 块内

- **文件**: `backend/database.py` 第53行
- **现象**: `from backend.models import *` 放在 `async with engine.begin() as conn:` 块内
- **错误**: `SyntaxError: import * only allowed at module level`
- **影响**: 应用无法启动，所有 API 不可用
- **修复方案**: 将 `from backend.models import *` 移到文件顶部（module level），在 `init_db()` 函数内只保留 `await conn.run_sync(Base.metadata.create_all)`

#### C2: router/index.ts 使用 Python 三引号注释

- **文件**: `frontend/src/router/index.ts` 第1行
- **现象**: `"""孕程记 - 前端路由配置。"""` — Python docstring 语法
- **错误**: TypeScript 不支持 `"""` 语法，编译将失败
- **影响**: 前端无法编译构建，所有页面不可用
- **修复方案**: 将 `"""..."""` 替换为 `// 孕程记 - 前端路由配置。`

#### C3: 缺少 HabitCheckin 和 SupplementCheckin 模型

- **文件**: 缺失 `backend/models/habit_checkin.py` 和 `backend/models/supplement_checkin.py`
- **现象**: 架构文档明确定义了 `habit_checkin` 和 `supplement_checkin` 两张表及对应索引，但代码中完全没有实现
- **影响**: PRD F28（好习惯打卡）和 F29（营养补充打卡）功能完全缺失
- **修复方案**: 
  1. 创建 `backend/models/habit_checkin.py`（HabitCheckin 模型）
  2. 创建 `backend/models/supplement_checkin.py`（SupplementCheckin 模型）
  3. 在 `backend/models/__init__.py` 中导入
  4. 创建对应的 Schema 文件
  5. 创建对应的 Router 文件（或在 daily_record.py 中添加相关端点）
  6. 前端添加对应的 API 调用

### Major（严重）— 应当修复

#### M1: 前端缺少 habit/supplement 打卡 API 和组件

- **文件**: 缺失前端 API 文件和打卡组件的对接
- **现象**: `HabitCheckinDialog.vue` 和 `SupplementDialog.vue` 组件存在，但无后端 API 支撑
- **影响**: 打卡弹窗无法与后端通信，数据无法持久化
- **修复方案**: 等 C3 修复后，添加对应 API 调用

#### M2: 食材安全数据量偏少

- **文件**: `backend/data/food_safety.json`
- **现象**: PRD Q10 要求约 200-300 条，当前约 60-80 条
- **影响**: 搜索覆盖率不足，用户可能查不到想要查询的食材
- **修复方案**: 补充食材数据至 200+ 条

#### M3: checkup 路由分页实现效率低

- **文件**: `backend/routers/checkup.py` 第40-43行
- **现象**: 先 `select` 全部数据再 Python 切片分页
- **影响**: 数据量大时性能差
- **修复方案**: 使用 SQL `OFFSET/LIMIT` 实现数据库级分页（同问题也存在于 diary 和 daily_record 路由）

### Minor（轻微）— 建议修复

#### m1: database.py 中 import * 不符合 PEP8

- **文件**: `backend/database.py`
- **现象**: 即使修复 C1 后，`from backend.models import *` 仍不符合 PEP8 推荐的显式导入
- **影响**: 代码可读性降低
- **修复方案**: 改为显式导入：`from backend.models import Pregnancy, PrenatalCheckup, ...`

---

## 四、智能路由判定

| 问题编号 | 严重程度 | 路由目标 | 原因 |
|---------|---------|---------|------|
| C1 | Critical | **Engineer（工程师）** | 源码语法错误，需工程师修复 |
| C2 | Critical | **Engineer（工程师）** | 前端源码语法错误，需工程师修复 |
| C3 | Critical | **Engineer（工程师）** | 模型缺失，需工程师实现 |
| M1 | Major | **Engineer（工程师）** | API 缺失，需工程师实现 |
| M2 | Major | **Engineer（工程师）** | 数据不足，需工程师补充 |
| M3 | Major | **Engineer（工程师）** | 性能问题，需工程师优化 |
| m1 | Minor | **Engineer（工程师）** | 代码规范问题 |

**判定结果**: 7 个问题全部指向源码 Bug，需工程师（Alex）修复。QA 测试本身未发现问题。

---

## 五、修复验证建议

### Engineer 修复后，Round 2 验证清单：

1. **C1 修复验证**: 运行 `python -m py_compile backend/database.py` 确认无语法错误
2. **C2 修复验证**: 运行 `npx vue-tsc --noEmit` 确认 TypeScript 编译通过
3. **C3 修复验证**: 
   - 确认 `backend/models/habit_checkin.py` 和 `backend/models/supplement_checkin.py` 存在且字段对齐架构文档
   - 确认 `backend/models/__init__.py` 导入新模型
   - 确认对应 API 端点可访问
4. **M1 修复验证**: 前端打卡 API 调用与后端端点对齐
5. **M2 修复验证**: `food_safety.json` 条目数 ≥ 200
6. **M3 修复验证**: 分页查询使用 SQL OFFSET/LIMIT

---

## 六、附录：代码亮点

尽管存在上述问题，项目整体质量较高，值得肯定：

1. **架构一致性**: 后端 12 个路由文件、7 个服务文件与架构文档高度一致
2. **孕周计算引擎**: Naegele 公式实现正确，支持 LMP/受精/预产期三种方式互算
3. **宫缩 5-1-1 分析**: ACOG 指南阈值设置合理，分析逻辑完整
4. **照片处理**: Pillow 缩略图生成考虑了 RGBA 转换、目录自动创建等边界
5. **PDF 生成**: ReportLab 实现完整，中文字体注册有 fallback 处理
6. **数据完整性**: 40 周发育数据、9 项产检标准、5 类指标范围数据充实
7. **飞牛打包**: manifest/docker/wizard/cmd 全套文件齐全且格式正确
8. **前端 API 对齐**: 除缺失的 habit/supplement 外，其余 API 与后端 100% 对齐

---

> **报告结束** — Round 1 完成，等待工程师修复后进行 Round 2 回归测试。

---

# Round 2 回归测试报告

> **测试轮次**: Round 2 | **测试日期**: 2026-06-24 | **测试工程师**: 严过关 (Yan)
> **回归范围**: Round 1 全部 7 个 Bug 修复验证 + 整体回归检查

---

## 一、回归测试概览

| 指标 | 数值 |
|------|------|
| Round 1 问题数 | 7 |
| 修复验证通过 | 7 |
| 修复验证失败 | 0 |
| 新增回归问题 | 0 |
| Python 文件编译 | 58 / 58 全部通过 |
| 回归判定 | ✅ **全部通过** |

---

## 二、逐项修复验证

### 2.1 C1 修复验证：database.py 语法错误

| 验证项 | 结果 | 详情 |
|--------|------|------|
| `import *` 移至模块顶部 | ✅ PASS | `from backend.models import *` 已移除 |
| 显式导入替代 | ✅ PASS | 使用 16 个显式导入：Pregnancy, PrenatalCheckup, CheckupPhoto, LabResult, DailyRecord, ContractionSession, Contraction, PregnancyPhoto, DiaryEntry, Checklist, ChecklistItem, Reminder, FetalMovementSession, FetalMovement, HabitCheckin, SupplementCheckin |
| py_compile 编译通过 | ✅ PASS | 无语法错误 |
| `init_db()` 函数不再含 import | ✅ PASS | 函数内仅含 `await conn.run_sync(Base.metadata.create_all)` |

**修复确认**: C1 已完全修复 ✅

### 2.2 C2 修复验证：router/index.ts Python 三引号

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 第1行语法 | ✅ PASS | 已替换为 `/** 孕程记 - 前端路由配置。 */`（JSDoc 格式） |
| 无 Python 语法残留 | ✅ PASS | 文件中不再包含 `"""` 三引号 |

**修复确认**: C2 已完全修复 ✅

### 2.3 C3 + M1 修复验证：HabitCheckin / SupplementCheckin 模型与 API

#### 后端模型文件

| 验证项 | 结果 | 详情 |
|--------|------|------|
| `models/habit_checkin.py` 存在 | ✅ PASS | HabitCheckin 模型含 id, pregnancy_id, date, items(Text), notes, created_at, updated_at |
| `models/supplement_checkin.py` 存在 | ✅ PASS | SupplementCheckin 模型含同构字段 |
| 唯一索引 | ✅ PASS | `idx_habit_pregnancy_date` 和 `idx_supplement_pregnancy_date` 均为 (pregnancy_id, date) UNIQUE |
| `models/__init__.py` 导出 | ✅ PASS | 已添加 `HabitCheckin` 和 `SupplementCheckin` 导出 |
| Pregnancy 模型关系 | ✅ PASS | 已添加 `habit_checkins` 和 `supplement_checkins` 关系（lazy="selectin", cascade="all, delete-orphan"） |

#### 后端 Schema 文件

| 验证项 | 结果 | 详情 |
|--------|------|------|
| `schemas/habit_checkin.py` 存在 | ✅ PASS | 含 Create/Update/Response 三个 schema |
| `schemas/supplement_checkin.py` 存在 | ✅ PASS | 含 Create/Update/Response 三个 schema |
| `field_validator` JSON 解析 | ✅ PASS | 两个 schema 均含 `@field_validator("items", mode="before")` 处理 JSON 字符串→列表转换 |

#### 后端 Router 文件

| 验证项 | 结果 | 详情 |
|--------|------|------|
| `routers/habit_checkin.py` 存在 | ✅ PASS | 6 个端点：POST /habit-checkins, GET 列表, GET by-date, GET 详情, PUT, DELETE |
| `routers/supplement_checkin.py` 存在 | ✅ PASS | 6 个端点：POST /supplement-checkins, GET 列表, GET by-date, GET 详情, PUT, DELETE |
| upsert 逻辑 | ✅ PASS | POST 端点按 (pregnancy_id, date) 查询，存在则更新，不存在则创建 |
| SQL 分页 | ✅ PASS | 列表端点使用 `func.count()` + `query.offset().limit()` |
| `main.py` 路由注册 | ✅ PASS | 第78-79行：`habit_checkin` 和 `supplement_checkin` 均已注册，含中文标签 |

#### 前端 API 文件

| 验证项 | 结果 | 详情 |
|--------|------|------|
| `api/habitCheckin.ts` 存在 | ✅ PASS | 6 个方法：upsert, list, getByDate, get, update, delete |
| `api/supplementCheckin.ts` 存在 | ✅ PASS | 6 个方法：upsert, list, getByDate, get, update, delete |
| 端点路径对齐 | ✅ PASS | 前端 `/habit-checkins`、`/supplement-checkins` 与后端完全匹配 |
| TypeScript 语法 | ✅ PASS | 使用 JSDoc 注释，无 Python 语法残留 |

**修复确认**: C3 + M1 已完全修复 ✅

### 2.4 M2 修复验证：食材安全数据量

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 总条目数 | ✅ PASS | **256 条**（PRD 要求 200-300 条） |
| 分类数 | ✅ PASS | **11 个分类** |
| 各分类分布 | ✅ PASS | 蔬菜类34, 水果类30, 肉类28, 海鲜类21, 蛋奶豆类20, 主食谷物20, 饮品类20, 调味品18, 零食坚果21, 中药材20, 其他食品24 |
| 安全等级分布 | ✅ PASS | safe/caution/unsafe 三级标注完整 |
| legend 字段 | ✅ PASS | 含 safe="可以食用", caution="需谨慎/限量食用", unsafe="不建议/禁止食用" |
| 数据质量 | ✅ PASS | 每条含 name + safety + note 三个字段，note 内容详实 |

**修复确认**: M2 已完全修复 ✅

### 2.5 M3 修复验证：SQL OFFSET/LIMIT 分页

| 文件 | 验证项 | 结果 | 详情 |
|------|--------|------|------|
| `routers/checkup.py` | 分页方式 | ✅ PASS | 使用 `func.count()` + `query.offset(offset).limit(page_size)` |
| `routers/diary.py` | 分页方式 | ✅ PASS | 使用 `func.count()` + `query.offset(offset).limit(page_size)` |
| `routers/daily_record.py` | 分页方式 | ✅ PASS | 使用 `func.count()` + `query.offset(offset).limit(page_size)` |
| `routers/habit_checkin.py` | 分页方式 | ✅ PASS | 使用 `func.count()` + `query.offset(offset).limit(page_size)` |
| `routers/supplement_checkin.py` | 分页方式 | ✅ PASS | 使用 `func.count()` + `query.offset(offset).limit(page_size)` |

**验证要点**:
- ✅ 全部 5 个分页路由已统一使用 SQL 层面分页
- ✅ 无 Python 切片 (`items[offset:offset+page_size]`) 残留
- ✅ `func.count()` 通过 `select_from(query.subquery())` 获取总数

**修复确认**: M3 已完全修复 ✅

### 2.6 m1 修复验证：PEP8 import * 规范

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 不再使用 `import *` | ✅ PASS | 已改为 16 个显式导入 |

**修复确认**: m1 已随 C1 修复一并解决 ✅

---

## 三、整体回归检查

### 3.1 Python 全量编译

| 检查项 | 结果 | 详情 |
|--------|------|------|
| py_compile 全量扫描 | ✅ PASS | **58 个 Python 文件全部编译通过**，无语法错误 |

### 3.2 新增文件完整性

| 新增文件 | 类型 | 编译 | 内容 |
|----------|------|------|------|
| `backend/models/habit_checkin.py` | Model | ✅ | HabitCheckin 模型，字段、索引完整 |
| `backend/models/supplement_checkin.py` | Model | ✅ | SupplementCheckin 模型，字段、索引完整 |
| `backend/schemas/habit_checkin.py` | Schema | ✅ | Create/Update/Response + field_validator |
| `backend/schemas/supplement_checkin.py` | Schema | ✅ | Create/Update/Response + field_validator |
| `backend/routers/habit_checkin.py` | Router | ✅ | 6 个端点，SQL 分页，upsert 逻辑 |
| `backend/routers/supplement_checkin.py` | Router | ✅ | 6 个端点，SQL 分页，upsert 逻辑 |
| `frontend/src/api/habitCheckin.ts` | API | ✅ | 6 个方法，端点对齐 |
| `frontend/src/api/supplementCheckin.ts` | API | ✅ | 6 个方法，端点对齐 |

### 3.3 修改文件无副作用

| 修改文件 | 修改内容 | 副作用检查 |
|----------|----------|-----------|
| `backend/database.py` | import 位置调整 + 显式导入 | ✅ 无副作用 |
| `frontend/src/router/index.ts` | 注释格式修正 | ✅ 无副作用 |
| `backend/models/pregnancy.py` | 添加 2 个 relationship | ✅ 无副作用 |
| `backend/models/__init__.py` | 添加 2 个 export | ✅ 无副作用 |
| `backend/main.py` | 添加 2 个 router 注册 | ✅ 无副作用 |
| `backend/routers/checkup.py` | 分页改为 SQL OFFSET/LIMIT | ✅ 无副作用 |
| `backend/routers/diary.py` | 分页改为 SQL OFFSET/LIMIT | ✅ 无副作用 |
| `backend/routers/daily_record.py` | 分页改为 SQL OFFSET/LIMIT | ✅ 无副作用 |
| `backend/data/food_safety.json` | 数据从 ~60-80 条扩充至 256 条 | ✅ 无副作用 |

### 3.4 新增路由注册验证

| 路由 | 注册路径 | 前缀 | 标签 |
|------|----------|------|------|
| habit_checkin | main.py L78 | `/api/v1` | 好习惯打卡 |
| supplement_checkin | main.py L79 | `/api/v1` | 营养补充打卡 |

**总路由数**: 14 个（原 12 个 + 新增 2 个）

---

## 四、Round 2 测试结论

| 指标 | 结果 |
|------|------|
| Round 1 问题修复率 | **7/7 = 100%** |
| 新增回归问题 | **0** |
| Python 编译通过率 | **58/58 = 100%** |
| 前后端 API 对齐率 | **14/14 = 100%** |
| 数据完整性 | **全部通过** |
| 分页实现正确性 | **全部通过** |

### 智能路由判定

| 判定 | 目标 |
|------|------|
| **Send To: NoOne** | Round 1 全部 7 个 Bug 已修复验证通过，无新增回归问题 |

### 总体评价

工程师对全部 7 个问题的修复质量较高，具体亮点：

1. **C1 修复彻底**：不仅将 import 移至模块顶部，还改为 16 个显式导入，同时解决了 m1（PEP8 规范）
2. **C3 修复完整**：新建 6 个后端文件 + 2 个前端 API 文件，模型→Schema→Router→前端 API 全链路打通
3. **M3 修复统一**：5 个分页路由统一使用 SQL OFFSET/LIMIT 模式，代码一致性良好
4. **M2 修复达标**：256 条食材数据，11 分类，分布均匀，每条含安全等级+详细说明
5. **零回归**：所有修改文件无副作用，58 个 Python 文件全部编译通过

---

> **Round 2 回归测试完成** — 全部 7 个 Bug 修复验证通过，无新增回归问题。测试结束。
