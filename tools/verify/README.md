# tools/verify —— 回归与核查脚本

本目录是孕程记的**验证能力本体**。此前它散落在一个**本地私有工作目录**里（该目录被 git 排除
⇒ 一个文件都没入库），一旦本机磁盘或 `.git` 出事，代码能靠备份捞回来、
**这套验证能力却会整体丢失**。2026-09-29 迁入仓库内，目的就是让它跟着仓库走。

---

## 快速开始

```bash
# 全套（74 套 / 约 1687 项，跑完约 9–14 分钟）
node tools/verify/run_all_suites.js

# 只跑名字含关键字的套件（路径或中文名都能命中）
node tools/verify/run_all_suites.js --only=推送
node tools/verify/run_all_suites.js --only=HEIC
node tools/verify/run_all_suites.js --only=DB修复
```

逐套日志落在 `tools/verify/regress-out/<套件名>.log`（不进版本库）。
控制台最后会打印「套件：N/N 全绿」与「项数合计」。

### 前置条件

| 依赖 | 说明 |
|---|---|
| Node.js | 直接用当前进程的 `process.execPath`，**不写死路径** |
| 后端依赖 | `app/server/node/node_modules` 必须已 `npm install`（`build.ps1` 会装） |
| 前端依赖 | `frontend/node_modules` 必须已 `npm install` —— `verify_frontend_types.js` 要用 `vue-tsc`（在 devDependencies）。**缺了它该套件判红**（fail-closed：工具链不可用 ≠ 类型没问题，这里报"通过"就是假绿） |
| 前端产物 | `app/ui/` 需已构建；模板类套件读它。未构建时这几套会红 |
| 夹具 | `fixtures/heic-test/sample.heic`、`rot.jpg` **已随仓库入库**，无需另行准备 |

---

## 目录结构

```
tools/verify/
├── _env.js              ← 路径/运行环境**唯一出处**（重构后新增，见下方"注意"）
├── run_all_suites.js    ← 全量运行器
├── tcp_shim.js          ← 测试垫片：把 server.js 的 Unix Socket 监听改写成 TCP 环回
├── _vue_extract.js      ← 从 .vue 源码里抽取 <script> 内容的共用小工具
├── e2e_*.js             ← 端到端（真起 server.js + 真库 + 真 HTTP）
├── verify_*.js          ← 静态/契约核查
│   ├── verify_frontend_types.js
│   │                    ← 前端类型体检：包装 `vue-tsc --noEmit`
│   │                      （先清掉的 15 个常驻错误：client.ts 未暴露"解包后"签名。
│   │                        用 PJ_VUE_TSC=<入口> 可指向桩做反例验证）
│   └── verify_pkg_versions.js
│                        ← 发版版本号同步：manifest 之外的 **3 处**（frontend / app/server/node 的
│                          package.json，以及 package-lock.json 的**两处**自指版本。
│                          真源 = `manifest`；PJ_PKG_ROOT=<dir> 可指向别处）。
│                          **同一份判定被 `build.ps1` Step1 直接调用**（fail-closed）
│                          —— 判定逻辑刻意放 node 不放 PowerShell：本机 PS 无法执行、没法验证
├── probe_*.js           ← 探针（诊断型，多数不打汇总行）
├── repro_*.js           ← 复现脚本（无头浏览器，产出截图 + JSON）
├── shot_*.js            ← 截图脚本（无头浏览器）
├── t*.js                ← 2026-09-28 十九项修复的专用探针（t9/t11–t18 已收进运行器）
├── _pkgver_gate_probe.ps1
│                        ← build.ps1「package.json / lock 版本号」闸门的**手工**反例探针
│                          （验的是外层包装会不会真把 node 的非零退出码变成打包错误。
│                            本机 PS 无法被自动化驱动 ⇒ 有意不进 run_all_suites，发版前手工跑）
├── *_color*.py / review_*.py / _check_chart_ink.py / _crop_cards.py
│                        ← 配色与图表"可读性体检"（铁律 #22 的 5 个配色审查脚本在此）
├── review_exercise_tokens.py
│                        ← 「某一页把私有硬编码色改成全局设计令牌」的六项完善性审查
│                          （① 选择器差集 ② 颜色映射/色系漂移 ③ 块外硬写色
│                            ④ 对比度（读源码、与改前并排）⑤ 死规则 ⑥ 令牌兜底不变量）
│                          支持 PJ_EX_VUE=<副本> 指到故意改坏的副本做**反例验证**
│                          （基线 = git HEAD 版本，首次运行自动导出到 .tmp/）
├── test_image_thumb.js  ← 缩略图生成
├── test_upgrade_init.sh ← cmd/upgrade_init 数据抢救逻辑的本地仿真
├── fkprobe.js           ← 外键探针
├── wecom/               ← 推送 5 套（企业微信 / 企微调度器 / 飞书 / 钉钉 / Bark）
├── fixtures/heic-test/  ← HEIC 测试样本（被 4 个套件依赖，勿删）
├── .tmp/                ← 运行期临时产物（gitignore）
└── regress-out/         ← 逐套日志（gitignore）
```

---

## 三类脚本，别混用

**① 收进运行器的 61 套**：判定口径是「能打出 `N 通过 / M 失败` 汇总行」。
主题覆盖：推送、导出/备份/恢复、媒体（HEIC/缩略图/视频）、相册与日记、
产检迁移与排序、记录类入口与全类型、路径安全（穿越 + 锚定白名单）、
首屏/路由契约/导航、用药与补充（规则 + 计划 + 到点提醒）、前端类型体检、
胎动/宫缩会话写回与统计口径（含首页/记录页/统计三家联动的渲染核验）、
首页↔记录页覆盖率与 `?date=` 采纳（真后端 + 无头浏览器）、
无头浏览器点击类探针、`t9`–`t18` 系列。
⚠️ **逐套清单以 `run_all_suites.js` 的 `SUITES` 为准**（此处不再抄一份数量，避免像
「推送 3 → 实际 5」「56 套 → 实际 57」那样漂移；运行器末尾有绊线会自动比对本页声明的数字）。

**② 诊断型探针（有意**不**收）**：`t1`–`t8`、`t10_probe_choice`。
它们只打印对照表、没有断言与汇总行，收进运行器只会得到 `NO-SUMMARY` 噪声。
需要时手工跑，读输出判读。

**③ 手工脚本**：`repro_*.js`、`shot_*.js`、`probe_album_mobile.js`、`shot_stats.js`、
`shot_record_quickmodals.js`（记录页快捷小弹窗的**风格一致性**核验：把「新补的」小弹窗逐个点开
——现为 水肿/分泌物/皮肤状况/排尿情况/用药 ——读真实 DOM 与计算样式，与老牌类型（饮水）比对
宽度/配色/字段结构/有无提示条，并自出「统一/不统一」结论）；
等无头浏览器类脚本 —— 依赖本机装好的 Chrome/Edge，且产出是截图给人看，不适合进自动汇总。
`wecom/e2e_push_real_server.js` 需要外部先起 smoke 服务，**有意不收**。

---

## 本机（Windows 沙箱）注意事项

1. 🔴 **一律用异步 `spawn`**。本机沙箱下 `spawnSync(<任意 exe>)` 恒定 `EBUSY`，
   而异步 spawn 正常。`t17` 曾因此**从未真正跑起来过**，反例被静默跳过 —— 写新套件时务必照抄现有写法。
2. **`tcp_shim.js` 是本机唯一能跑真链路的方式**：安全策略禁止监听 Unix Domain Socket。
   用法 `node -r tcp_shim.js server.js`，端口由 `PJ_TCP_PORT` 覆盖（默认 38471）。
3. **bash 要用 `usr/bin/bash.exe`，不要用 `bin/bash.exe`**（Windows / Git for Windows）。
   `bin/bash.exe` 是启动器，PATH 挂载与 MSYS 路径转换行为不同 ⇒ `t17` 里 prepend 的假 curl
   目录找不到，**直接掉成 7 通过 / 9 失败**；而子进程本身能起来、不报 spawn 错误，极易误判成"测试写错了"。
   需要覆盖时用 `PJ_BASH`。
4. **反例来源写死为 tag 名**（如 `v0.0.30`），**不要写 `HEAD`** —— 修复一提交，反例就失效了。
   也不要用提交号：仓库历史一旦被重写（filter-branch + force-push），提交号就直接查不到了。
5. **换机器时**：只改 `_env.js` 一处。若某个外部程序（git / bash / node）探测不到，
   用 `PJ_NODE` / `PJ_BASH` / `PJ_GIT` / `PJ_VERIFY_TMP` 环境变量覆盖。

---

## 反例口径（写新套件必须自证"会红"）

铁律 #11：**一个从不失败的检查 = 安慰剂**。任何新套件上线前，必须让它**真的红一次**，
并保留复现方式。已实测的写法（可照抄）：

| 反例 | 做法 | 期望 |
|---|---|---|
| 判定逻辑真的会红 | `PJ_VUE_TSC=tools/verify/_fake_tsc_bad.js node tools/verify/verify_frontend_types.js`（桩件打两行 `error TS` + 退出码 2） | `0 通过 / 1 失败`，并列出这两行 |
| 真工具链能抓到真错误 | 往 `frontend/src/` 临时放一个 `__typecheck_probe.ts`，内容 `export const probe: number = 'not a number';` | 红，且报 `__typecheck_probe.ts(3,14): error TS2322`。**验完立即删除该文件** |
| 工具链缺失不报假绿 | `PJ_VUE_TSC=<不存在的路径>` | 红，提示"找不到 vue-tsc 入口"+ 排查建议 |
| 版本号判定真的会红 | `verify_pkg_versions.js` **自带**反例自检（无需手工构造）：它把 4 个文件复制到临时目录，依次① 把 `frontend/package.json` 版本改成 `9.9.9` ② 截断成非法 JSON ③ 删掉 lock 的 `packages[""]`，每步都要求判定**必须变红** | `9 通过 / 0 失败`（6 项实校 + 3 项反例自检）；任何一步没红 ⇒ 报"假护栏"并判红 |
| **闸门的外层包装**会真的拦下打包（**手工**） | `pwsh -File tools/verify/_pkgver_gate_probe.ps1` —— 逐字复刻 `build.ps1` Step1 那段，用 `%TEMP%` 里的假根验三个场景 | 三行 `OK`：真实仓库不拦 / 同步丢了被拦（node 退出码 1）/ 缺脚本 fail-closed。⚠️ **进不了自动套件**：本机 PowerShell 无法被驱动（工具 stdout 恒空、bash 调 `powershell.exe` 被安全策略拦）⇒ 改过 `build.ps1` Step1 后手工跑一次 |

> ⚠️ 反例用的探针文件一律放 `tools/verify/.tmp/`（gitignore），源码里的探针用完即时删；
> 跑完 `git status` 确认没有 `??` 残留。需要长期保留的桩件用 `_` 前缀入库（如 `_fake_tsc_bad.js`），
> 否则别人 clone 下来复现不了反例。

---

## 迁移说明（2026-09-29）

本目录原先散落在一个**本地私有工作目录**里（被 git 排除 ⇒ 一个文件都没入库）。
下面只写"从哪几类脚本来的"，不再列出那个私有目录的具体路径 —— 它不属于本仓库。

- 来源四类：核查/探针脚本（66 个顶层脚本）、v0.0.31 十九项修复的专项探针（20 个 t 系列 + 运行器）、
  推送套件（4 个）、HEIC 测试夹具。
- 入库 **93 个文件**：72 `.js` / 16 `.py` / 1 `.sh` / 1 `.heic` / 2 `.jpg` / 1 `README.md`。
  其中 **73 个做了路径改写**，其余无需改动。
- 改写手法：所有本机常量收敛到 `_env.js`，脚本内只保留 `require('./_env')`。
  改完 **72 个 .js 全部通过 `node --check`，16 个 .py 全部通过 `py_compile`**，
  并从新位置跑通全套 **40/40 全绿 / 756 项**（与迁移前基线逐套一致）。
- **原私有目录下的副本未删除**（按项目约定：先复制、跑绿、再谈删）。
- 未迁入（判断为一次性/本地维护工具，非验证）：`checkup.fixed.js`（临时修好的副本）、
  `clean_ui_assets.js`（一次性清理）、`_refactor_recordview_stats.py`（一次性重构）、
  食物库数据生成脚本（`food_add_*.js` / `expand_*.js` / `enhance_*.js` / `recipes_add.js`）。

### 迁移时踩过的两个坑（都值得记住）

1. 🔴 **子目录里的 `require('./_env')` 层级**。`wecom/` 下的 3 套推送脚本被批量改成了
   `require('./_env')`，但它们在子目录里 ⇒ 解析不到，**3 套静默崩溃（EXIT1，0 秒，无输出）**。
   修法是 `require('../_env')`。教训：批量改路径后**必须跑全套**，
   且运行器遇到崩溃要打印报错首行（已加）。只跑单套冒烟是发现不了的。
2. ⚠️ **`BASE` 指向了 `VERIFY_DIR` 而不是 `.tmp`**。`t13/t16/t17/t18` 会据此在
   `tools/verify/` **根下**建 `tmp_m_prod`、`tmp_q`、`tmp_r`、`tmp_s1/s2` 等碎片目录
   ⇒ 会被 git 一并收录。已全部改为指向 `.tmp`。教训：跑完回归后**必须 `git status` 看 `??`**。

---

## 相关铁律（改代码前先看）

| 场景 | 必须先跑 |
|---|---|
| 改前端任意 `.ts` / `.vue` / 动 `api/client.ts` 的类型 | `verify_frontend_types.js`（`vue-tsc --noEmit`；**常驻类型错误会淹没真错误**，必须保持 0 处） |
| 改前端模板 / 加页面功能 | `verify_template_vars.js`、`verify_render.js`、`verify_record_entrypoints.js`；**改记录页小弹窗**再加 `shot_record_quickmodals.js`（看风格是否与其它类型一致） |
| 改记录页任何字段的「提交 / 读回 / 备注写入」 | `verify_record_page_functions.js`（真后端端到端：25 类别逐类跑「建/读/部分更新/改/删」+ 写入格式与 remark 语义），再跑 `verify_record_entrypoints.js`（静态：取值域唯一真源、入口齐全） |
| 改睡眠质量 / 心情 / 其它「多处必须一致」的字面量 | 两套都跑：`verify_record_entrypoints.js`（会红在「全前端只有 format.ts 一处映射」）+ `verify_record_page_functions.js` |
| 改前后端接口 | `verify_api_contracts.js`、`verify_upload_field_names.js` |
| 动用药/补充方案、打卡、到点提醒 | `verify_dose_rules.js`（**纯函数 17 项**：7 天节奏串正反例，专防"静默错判该不该吃"；自带 `TZ=Asia/Shanghai`）+ `verify_dose_plan.js`（真后端：建/校验/孕周·日期·频率约束/打卡幂等/撤销/停用/删连带）+ `verify_dose_push.js`（到点只推该推的、**打卡后当天不再推**、开关生效、日志可机读） |
| 动产检排期 json 的 id / 改 pregnancy·schedule_dates·custom_checkup·reminder 四表 | `probe_push_schedule_impact.js` |
| 改 `saveDb` / 落盘逻辑 | `t9_verify_db_fixes.js`、`verify_db_persist.js`、`probe_async_save_race.js` |
| 改配色 / 主题令牌 | `audit_checkup_colors.py` 等 5 个配色审查脚本 + `_check_chart_ink.py` |
| 改 `cmd/upgrade_init` | `test_upgrade_init.sh` |
| **发版 / 改版本号 / 改 `manifest`** | `verify_pkg_versions.js`（manifest 之外的 3 处：frontend / server 的 `package.json` + `package-lock.json` 的两处自指版本）。**改完 `manifest` 必须 `cd frontend && npm run build`**（版本号被 `vite.config.ts` 的 define 烤进产物，不重建 ⇒ 包里还是旧号）；打包前 `build.ps1` Step1 会再跑一遍同一份判定（fail-closed） |
