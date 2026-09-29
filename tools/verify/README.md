# tools/verify —— 回归与核查脚本

本目录是孕程记的**验证能力本体**。此前它散落在一个**本地私有工作目录**里（该目录被 git 排除
⇒ 一个文件都没入库），一旦本机磁盘或 `.git` 出事，代码能靠备份捞回来、
**这套验证能力却会整体丢失**。2026-09-29 迁入仓库内，目的就是让它跟着仓库走。

---

## 快速开始

```bash
# 全套（40 套 / 约 739 项，跑完约 6–10 分钟）
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
├── probe_*.js           ← 探针（诊断型，多数不打汇总行）
├── repro_*.js           ← 复现脚本（无头浏览器，产出截图 + JSON）
├── shot_*.js            ← 截图脚本（无头浏览器）
├── t*.js                ← 2026-09-28 十九项修复的专用探针（t9/t11–t18 已收进运行器）
├── *_color*.py / review_*.py / _check_chart_ink.py / _crop_cards.py
│                        ← 配色与图表"可读性体检"（铁律 #22 的 5 个配色审查脚本在此）
├── test_image_thumb.js  ← 缩略图生成
├── test_upgrade_init.sh ← cmd/upgrade_init 数据抢救逻辑的本地仿真
├── fkprobe.js           ← 外键探针
├── wecom/               ← 企业微信 / 飞书推送 4 套
├── fixtures/heic-test/  ← HEIC 测试样本（被 4 个套件依赖，勿删）
├── .tmp/                ← 运行期临时产物（gitignore）
└── regress-out/         ← 逐套日志（gitignore）
```

---

## 三类脚本，别混用

**① 收进运行器的 40 套**：判定口径是「能打出 `N 通过 / M 失败` 汇总行」。
按主题分为：推送 3、导出/兼容/媒体 18、契约/探针 6、首屏+路由契约 2、路径安全 2、t 系列 9。

**② 诊断型探针（有意**不**收）**：`t1`–`t8`、`t10_probe_choice`。
它们只打印对照表、没有断言与汇总行，收进运行器只会得到 `NO-SUMMARY` 噪声。
需要时手工跑，读输出判读。

**③ 手工脚本**：`repro_*.js`、`shot_*.js`、`probe_album_mobile.js`、`shot_stats.js` 等
无头浏览器类脚本 —— 依赖本机装好的 Chrome/Edge，且产出是截图给人看，不适合进自动汇总。
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
| 改前端模板 / 加页面功能 | `verify_template_vars.js`、`verify_render.js`、`verify_record_entrypoints.js` |
| 改前后端接口 | `verify_api_contracts.js`、`verify_upload_field_names.js` |
| 动产检排期 json 的 id / 改 pregnancy·schedule_dates·custom_checkup·reminder 四表 | `probe_push_schedule_impact.js` |
| 改 `saveDb` / 落盘逻辑 | `t9_verify_db_fixes.js`、`verify_db_persist.js`、`probe_async_save_race.js` |
| 改配色 / 主题令牌 | `audit_checkup_colors.py` 等 5 个配色审查脚本 + `_check_chart_ink.py` |
| 改 `cmd/upgrade_init` | `test_upgrade_init.sh` |
