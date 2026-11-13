# LESSONS.md —— 错题本（L2）

> **只记「返工过、验证流过形式、差点漏掉」的事。** 「最佳实践」不配占位置 ——
> 没出过事故的规则写进来，只会把真正的坑挤到看不见的地方。
>
> 这不是文档，是**待硬化的队列**：条目在这里观察，重复到第 3 次就转正进
> `docs/code-standards.md`，然后从这里标 `PROMOTED` 退场。检查机制：
> `node tools/verify/lessons.js`。

## 字段口径（改条目时别改格式，脚本要解析）

| 字段 | 必填 | 说明 |
|---|---|---|
| `## L-NNN 一句话结论` | 是 | NNN 三位递增，**永不复用**（引用会悬空） |
| `- **Seen**: N×` | 是 | 被捕获（夜审 / 回归 / 线上）的次数。**重复捕获才算**，自己写一遍不算 |
| `- **状态**: OPEN / PROMOTED / RETIRED` | 是 | PROMOTED 必须写 `→ docs/code-standards.md#CS-NN`，脚本会核对锚点存在 |
| `- **症状**` | 是 | 用户/开发者**看到什么**。要能一眼对上，不写内部分析 |
| `- **根因**` | 是 | 为什么会发生（一层即可，别写成检讨） |
| `- **判据**` | 是 | 下次怎么在一分钟内认出同类问题 |
| `- **证据**` | 是 | commit / tag / 套件名 / 日期。**没有证据的条目等于没发生** |

阈值：**Seen ≥ 3× ⇒ 必须 PROMOTED**（脚本会红）。升格时把规则搬进 code-standards，
并在那里挂上护栏脚本；搬完这里只留一行索引，不保留全文。

---

## L-001 汇总行全绿 ≠ 这一套检查通过了

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-02`
- **症状**: 回归打印「7 通过 / 1 失败」，最终却 `exit 0`；接进 CI 后一片红里报绿
- **根因**: `run_all_suites.js` 只在「文档声明的套数对不上」时才设退出码，红灯不参与退出码
- **判据**: 任何"总控脚本"只看它打印的文字是不够的 —— **必须看它的退出码**
- **证据**: 2026-11-10 加 `--ci` 时实测：同一红灯场景，默认模式 exit 0、`--ci` 模式 exit 1

## L-002 写检查脚本本身就会假绿（同一个坑踩了四次）

- **Seen**: 4×
- **状态**: PROMOTED → `docs/code-standards.md#CS-01`
- **症状**: 脚本报「全部一致 ✅」/「48 列」/「无孤儿」，而实际有 50 列、有 29 个孤儿
- **根因**: ① 逻辑错（把后端本来就有的列名算作"有写入方"）② 路径分隔符不匹配
  ③ 正则太窄（`[a-z_]+` 吃不到 `blood_glucose_1h`；`(\w+Color)` 吃不到 `textColor1`）
  ④ 只扫扁平字面量，漏模板串拼的路由
- **判据**: 新断言**上线前必须真红一次**；解析正则一律用 `[A-Za-z0-9_]+` / `\w*[Cc]olor\w*` 这种容错写法
- **证据**: 2026-09-25 一天内连踩 4 次，逐条记录在旧铁律 #11；护栏：所有套件自带反例自检

## L-003 「红了」不等于「反例有效」—— 必须看红在哪

- **Seen**: 2×
- **状态**: PROMOTED → `docs/code-standards.md#CS-02`
- **症状**: 反例"成功"变红，但其实红在 `MODULE_NOT_FOUND`，跟被测逻辑毫无关系
- **根因**: 给了相对路径，子进程 cwd 在 `frontend/` 解析不到；而 fail-closed 照样会红，
  于是"红过"被当成"有区分度"
- **判据**: 反例必须红在**你预期的那条断言上**，日志要能指出是哪条
- **证据**: `verify_frontend_types.js` 的 `PJ_VUE_TSC` 反例；修法是相对路径锚定仓库根

## L-004 同一功能两个平行实现，改一处必漏另一处

- **Seen**: 3×
- **状态**: PROMOTED → `docs/code-standards.md#CS-03`
- **症状**: 用户报「功能没有」「统计里看不见」，代码里明明有
- **根因**: 两份食谱数据（页内 vs `recipes.json`）、两份统计面（`RecordView` vs `StatsView.vue`）、
  两份产检数据 —— 各自写死一份清单
- **判据**: 改任何「列表型 / 枚举型」功能前，**先 grep 一遍有没有第二个清单**
- **证据**: 三围只加在前者、`StatsView` 连腰围都没有；护栏 `verify_record_entrypoints.js`

## L-005 内存 SQLite：读文件前 `saveDb()`，换文件后 `reloadFromFile()`

- **Seen**: 3×
- **状态**: PROMOTED → `docs/code-standards.md#CS-04`
- **症状**: 备份导出的是 30 秒前的旧数据；恢复成功提示之后数据自己变回去了
- **根因**: 磁盘文件只是快照（每 30 秒整库落盘）。① 读文件前不落盘 ⇒ 拿旧状态
  ② 换文件后不重载 ⇒ ≤30 秒后 `saveDb()` 把旧数据写回去，恢复被静默撤销
- **判据**: 任何直接 copy / 读写 `config.DATABASE_PATH` 的代码，先问这两句
- **证据**: `/export/backup-db`、`/export/restore-db`（还谎报"重启后生效"）；护栏 `verify_db_persist.js`、`t9_verify_db_fixes.js`

## L-006 新字段没进恢复白名单 = 恢复后永久变 null

- **Seen**: 2×
- **状态**: PROMOTED → `docs/code-standards.md#CS-05`
- **症状**: 备份文件里明明有值，恢复完全没了；导出看着正常，所以极难发现
- **根因**: `/restore-latest` 是 `DELETE FROM 表` 再按 `export.js` 的 `TABLE_COLUMNS` 白名单插入 ——
  导出侧用 `SELECT *`，坑只在恢复侧；新表没进 `ALL_TABLES` 还会整张表不进备份
- **判据**: 加字段/加表时，**同时**改 `TABLE_COLUMNS`（或 `ALL_TABLES`）
- **证据**: 已修 `daily_record` 的 bust/waist/hip、`diary_entry.title`、`reminder.priority`、`schedule_dates`；
  护栏 `verify_backup_schema_coverage.js`（不变量：白名单 ⊇ 建表字段）

## L-007 加锁写在所有校验之前 ⇒ 写入永不落盘，接口照样成功

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-06`
- **症状**: 之后所有写入只进内存，重启全丢；没有任何报错
- **根因**: `saveDb()` 开头 `if (_savingDb || _dbLocked) return;` 是**唯一落盘点**；
  `POST /restore-latest` 把 `lockDb()` 放在两个提前 return 之前、且那两分支漏解锁
- **判据**: `lockDb()` 必须在**所有校验 / 提前 return 之后**；出问题别只补一行 unlock
- **证据**: 修法是与 `/restore` 对齐、整体下移；护栏 `probe_async_save_race.js`

## L-008 naive-ui 没有 `modelValue` 约定，裸 `v-model` 一律失效

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-07`
- **症状**: 点分类/单选完全没反应，连选中态都不动；构建、类型检查、渲染探针全绿
- **根因**: naive-ui 用**具名** prop（`n-radio-group`/`n-input`/`n-select` → `value`；
  `n-modal`/`n-drawer` → `show`；`n-checkbox` → `checked`）。裸 `v-model` 编译成
  `modelValue` + `onUpdate:modelValue`，组件不认 ⇒ 状态永远停在初值
- **判据**: 全项目 128 处 `v-model:value` 都对，唯独一处写错 ⇒ 靠"大家都这么写"判断不可靠，
  只能靠扫描；**原生元素**（`input`/`select`/`textarea`）的裸 `v-model` 是对的，别一起修
- **证据**: 饮食页「催奶食谱大全」只有猪蹄系列能显示；护栏 `verify_naive_vmodel.js`（契约+扫描+编译期+真实渲染四层）

## L-009 `formatted-value` 给空字符串 ⇒ 整页错误边界崩溃

- **Seen**: 2×
- **状态**: PROMOTED → `docs/code-standards.md#CS-08`
- **症状**: 只在「该字段为空 + 打开含该控件的弹窗」时白屏
- **根因**: `n-time-picker` / `n-date-picker` 的 `formatted-value` 传 `''` 会崩
- **判据**: 无值一律 `null`（初值和回填都是），**禁写 `|| ''`**
- **证据**: 两次复发；新写这类表单优先用原生 `<input type="date|time">`

## L-010 composable 不解构 ⇒ 拿到 Ref 对象，判断恒真

- **Seen**: 2×
- **状态**: PROMOTED → `docs/code-standards.md#CS-09`
- **症状**: `v-if` / `v-show` 行为全反（该藏的显示、该显示的藏）
- **根因**: `const c = useXxx()` 之后模板里写 `c.flag`，取到的是 Ref 本身
- **判据**: 一律 `const { a, b } = useXxx()`
- **证据**: 两次复发；属类型系统查不出的运行时语义

## L-011 抽共享组件后，静态断言会「集体假红」

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-10`
- **症状**: 功能明明在，`verify_record_entrypoints.js` 一次红 4 条
- **根因**: 断言按 `RecordView.vue` 里的**字面量**找目标，目标搬到了 `QuickLogDialog.vue`
- **判据**: 两个动作都要做 —— ① 新文件并入被检查源码集合 ② **补一条"组件确实被接上"的断言**
  （否则组件写得再全、没人引用也全绿）
- **证据**: 胎动/宫缩抽 `QuickLogDialog` 实测；连带：`v-else` 兜底 = 静默空白，一律写 `v-else-if`

## L-012 调试产物写进被测目录，会把检查脚本废掉

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-11`
- **症状**: `app/ui` 堆着 29 个孤儿 chunk，检查却报 `50 通过 / 0 失败`
- **根因**: 孤儿判定从"所有 `*.html`"出发，而调试探针往里写了临时 html，且引用了旧 hash
- **判据**: 把调试产物写进被测目录前，先问「检查脚本会不会把它当正常输入」
- **证据**: 修法：① 只从 `index.html` 出发 ② `app/ui` 出现别的 html 一律判红；护栏 `verify_ui_orphans.js`

## L-013 容忍「常驻 N 个类型错误」= 这一栏事实上没人再看

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-12`
- **症状**: `vue-tsc` 长期挂 15 个红，新增的真错误淹没在噪音里
- **根因**: `api/client.ts` 声明成 `AxiosInstance`，但拦截器已把响应解包成 `ApiResponse`
- **判据**: 类型错误必须保持 **0 处**；出现一片红先找根因，别按条数估工作量
  （修一处后 13 个连锁消失）
- **证据**: 护栏 `verify_frontend_types.js`；**fail-closed**：缺 `node_modules` / 起不来 / 超时都判失败

## L-014 文档里写死的数字一定会漂

- **Seen**: 3×
- **状态**: PROMOTED → `docs/code-standards.md#CS-13`
- **症状**: README 说 56 套实际 57；说「推送 3 套」实际 5；某行写「第 58 套」早就不对
- **根因**: 数字靠人记必漏；套件会随改动插入，序号整体位移
- **判据**: 文档里**不写套数/序号**，或写成由脚本断言的单一数字（`run_all_suites.js` 末尾已有绊线）
- **证据**: 数字漂移链 42/778 → 56/1220 → 57/1266；绊线不一致会计入退出码

## L-015 深色模式曾是「死代码」：store 有值、CSS 有色，就是没接到 DOM

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-14`
- **症状**: 页面恒亮色，开关看着能用其实没用；构建不报错、测试不红
- **根因**: `currentTheme` 只声明从未应用到 DOM，全仓无 `classList.add('dark')`
- **判据**: 「配置项存在」≠「功能接通」。这类退化只能靠静态钉死接线
- **证据**: 护栏 `verify_dark_mode.js`（含反例自检）+ `probe_theme_tokens.js`（幽灵令牌/硬写亮色）

## L-016 bash 用 `bin/bash.exe` 会让测试假红

- **Seen**: 1×
- **状态**: OPEN
- **症状**: `t17` 直接掉成 7 通过 / 9 失败，子进程能起来且不报 spawn 错误
- **根因**: `bin/bash.exe` 是启动器，PATH 挂载与 MSYS 路径转换行为不同 ⇒ prepend 的假 curl 目录找不到
- **判据**: Windows 下一律 `usr/bin/bash.exe`；需要覆盖时用 `PJ_BASH`
- **证据**: `tools/verify/README.md`「本机注意事项」第 3 条

## L-017 本机 `spawnSync(<任意 exe>)` 恒 `EBUSY`，只有异步 `spawn` 可用

- **Seen**: 2×
- **状态**: OPEN
- **症状**: 子进程压根没起来，日志表现成「(无汇总行)」，看着像断言无牙
- **根因**: 沙箱下同步创建进程被拦
- **判据**: 任何跑子进程的脚本（含**反例脚本**）一律异步 `spawn` + Promise 包装
- **证据**: `run_all_suites.js` 顶部注释；`t17` 曾因此从未真正跑起来过

## L-018 判定阈值必须与列表口径一致（`>` vs `>=`）

- **Seen**: 1×
- **状态**: OPEN
- **症状**: 记录列表把 140/90 标红，首页时间轴一声不响
- **根因**: `dashboard.js` 写 `>`，而列表与临床口径都是 `>=`（140/90、空腹 5.1、餐后 6.7）
- **判据**: 改阈值先找"这个数在几处出现"，全部对齐；并加一条**压线必报**的断言
- **证据**: 护栏 `probe_alert_threshold.js`（压线报 / 低一档不报 / 明显偏高仍报，三场景）

## L-019 SQLite `CURRENT_TIMESTAMP` 是 UTC，与本地日期混用会差一天

- **Seen**: 2×
- **状态**: OPEN
- **症状**: 隔天服药方案在 UTC+8 的 00:00–08:00 创建 ⇒ 第一天直接被跳过
- **根因**: 用 `created_at`（UTC）当周期锚点；`toISOString().slice(0,10)` 同类问题
- **判据**: 任何「按日期推算周期/间隔」的锚点必须用本地日期（`config.localToday()`）；
  解析日期拆 `[y,m,d]` 走 `Date.UTC`
- **证据**: 用药方案锚点修复；`verify_dose_rules.js` 自带 `TZ=Asia/Shanghai`

## L-020 给"是否有内容"这类判断加开关，先想清楚它属不属于这个判断

- **Seen**: 1×
- **状态**: OPEN
- **症状**: 每日看板三项全不勾却仍发空推送；只开用药提醒的渠道被判成"有内容"
- **根因**: `hasAnyContent(cfg)` 用 `cfg.x !== false`（字段不存在即视为开启），
  把"到点单独推"的 `push_dose` 并进了"每日看板内容开关"
- **判据**: 新增推送类型前先回答「它进不进每日看板」，不进就别并进看板开关
- **证据**: 打红 企业微信推送 / 企微调度器 两套；护栏 `wecom/test_wecom_push.js`

---

## L-021 只看 diff 的审查器，结构上发现不了「别处还有一样的写法」

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-03`
- **症状**: 一个修「UTC 当本地日期」的 PR，审查结论是 pass；可仓库里还有两处同样的写法没动
- **根因**: 审查器的输入只有 diff，没有「全仓」视角；而本项目的铁律恰恰是**同类 Bug 必须全量拔除**。
  两条都对，合起来就是盲区
- **判据**: 当 PR **删掉**某个已知坏模式（`-` 行命中）时，必须去扫全仓同模式，统计 PR 没碰过的文件里还剩多少
- **证据**: 2026-11-10 用真实 PR#5 实测 —— 它修了 4 个文件，`useContractionTimer.ts` 里
  `toISOString().slice(0,10)` 还在；修法是 `pr-review.js` 的 `SIBLING_SCANS`，护栏 `selftest` E9/E10

## L-022 空输入被判「通过」—— 最危险的一种假绿

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-02`
- **症状**: diff 为空（API 拉取失败 / 权限不足 / 只改了文件权限）时，审查输出 `pass`；
  如果接了自动合并，等于放行一个**从没被看过**的 PR
- **根因**: 硬检查是一条条问「这有没有问题」，空集合自然全部通过 ——
  缺的不是某条规则，而是「我到底有没有拿到要审的东西」这个前置断言
- **判据**: 任何审查/校验/导入，第一步先断言输入非空且可解析；判不了就判**不可判定**，不要判通过
- **证据**: `selftest` E1/E2；修法是 `empty-diff` 直接阻断，且不再往下判

## L-023 分页 / 上限截断，会让「没查到」变成「没问题」

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-02`
- **症状**: 自动合并前会检查 PR 是否触碰高危路径（`.github/` `cmd/` `manifest` …）。
  GraphQL 查询写的是 `files(first:100)`，一个 120 文件的 PR 里，若 `.github/workflows/x.yml`
  排在 101 位之后，`findHighRisk` 根本扫不到它 ⇒ **高危红线被"文件够多"这件事本身绕过**
- **根因**: 把"这次查询返回的"当成了"全集"。接口有上限、代码没意识；
  而下游的判定逻辑（`findHighRisk(files)`）只会说"没找到"，不会说"我没看全"
- **判据**: 凡是带 `first:N` / `LIMIT` / `per_page` / `slice` 的取数，必须同时拿到总数并比较；
  数量对不上就按**判不了**处理（fail-closed），不许当成"没问题"
- **证据**: 2026-11-10 自查发现；修法是 GraphQL 加 `totalCount` + `files-truncated` 阻断，
  `selftest` C 段 3 条断言（截断判 block / 理由可读 / 未截断不受影响）

---

## L-024 后端存 UTC、前端当本地显示 —— 同一列/同一表混两种时区口径

- **Seen**: 3×
- **状态**: PROMOTED → `docs/code-standards.md#CS-15`
- **症状**: 东八区下，9:11 写的日记显示成 1:11；相册在凌晨跨月；推送记录「待推送」条目少 8 小时；
  `info.log` 时间戳与系统时间对不上。功能都「正常」，唯独数字全错 8 小时
- **根因**: SQLite `datetime('now')` / `CURRENT_TIMESTAMP` 落库的是**无时区标记的 UTC** 字符串，
  前端 `dayjs(s)` 按浏览器本地时间解析。更麻烦的是**同一张表里两列口径不同**：
  `push_log.pushed_at` 由 `localStamp()` 写本地、`created_at` 是 UTC，被 `pushed_at || created_at`
  合并后统一处理 ⇒ 修了一列必然错另一列
- **判据**: ① 前端出现 `dayjs(<x>_at)` / `new Date(<x>_at)` 就是嫌疑；② 后端出现
  `DEFAULT (datetime('now'))` 却直接把该列显示给用户，就是嫌疑；③ 纯日期字段
  （`entry_date` / `record_date`）被补 `Z` 同样是错的 —— 它们不该参与时区换算
- **证据**: issue #3；社区 PR #4（关闭未合）/ PR #5（提交后长期未合并）；
  2026-11-10 真机验证 v0.0.35 时确认只修了宫缩一处、显示层四处全未进包。
  硬化护栏 `tools/verify/probe_timezone_display.js`（41 项，含反例自检）

## L-025 构建产物比源码旧，包就是旧的 —— 而打包脚本不会告诉你

- **Seen**: 1×
- **状态**: PROMOTED → `docs/code-standards.md#CS-16`
- **症状**: 21:41 构建前端 → 21:43 合入一个改前端的 commit → 21:45 打包。
  包里是 21:41 的产物，**新合入的前端修复完全没进去**；但 `build.ps1` 六步全绿、
  打印「打包并验证完成」、开包比对也能过 —— 因为比的是「包内 == 本地」，而两边都是旧的
- **根因**: `build.ps1` 只**组装** stage，不重新构建前端；Step1 校验的是"源码完整性"
  （文件在不在、路由全不全），**不比对"产物是不是由当前源码构建的"**
- **判据**: 两条同时满足 —— ① 产物里注入的版本号 == `manifest.version`；
  ② 产物 mtime >= `frontend/src` 所有源码文件 mtime 的最大值。
  **不要用 `git log --format=%ct`**：那是提交动作的时间，源码内容可能在 build 之前就改好了
  （2026-11-12 实测：最后提交比产物 mtime 晚 17s，用它会稳定假红）。
  护栏 `tools/verify/check_artifact_freshness.js --require` 已接进 `build.ps1` Step1。
  「包内 md5 == 本地 md5」**不能**证明产物新鲜 —— 它只证明打包过程没出错
- **证据**: 2026-11-10 实测；开包 grep `pushed_at` 才发现包内 `SettingsView` 是旧的。
  重构建 + 重打包后，51 个产物 md5 仍未变（说明"md5 相等"这个判据本身也有盲区）

## L-026 本地绿、CI 红：路径分隔符，以及 `process.exit()` 吞掉了失败原因

- **Seen**: 1×
- **状态**: open（待硬化：需要"跨平台路径归一"的统一约定）
- **症状**: `probe_theme_tokens` 本地 `exit 0`；推上去第一次 CI 就 `EXIT1`，
  而 **CI 日志停在半句话**（打印完「【② 硬写亮色残留】」就没了），看不到哪条断言失败
- **根因**: 两条叠加，缺一条都不至于这么难查 ——
  1. **白名单表用 Windows 反斜杠**（`'views\\DashboardView.vue': 8`），
     而 Linux 上 `path.relative()` 返回正斜杠 ⇒ 6 条白名单**全部匹配不到** ⇒ 14 处硬写色都算未解决
  2. 末尾 `process.exit(1)` 会**丢掉尚未 flush 的 stdout** ⇒ 失败明细消失在管道里
- **判据**:
  - 任何**跨平台比较**的路径（白名单 key、断言字符串、快照）必须 `split(path.sep).join('/')` 归一
  - 断言类脚本用 `process.exitCode = n`，**不要**用 `process.exit(n)` —— 后者不给你看输出
- **证据**: CI run `42830487903`（2026-11-10 首次真实 CI 运行）；
  本机 Windows 全绿，Linux 全红。修法：`relOf()` 统一正斜杠 + 白名单 key 改正斜杠 + 改 `exitCode`
- **附带教训**: 批量替换 `path.relative(ROOT, f)` → `relOf(f)` 时把 `relOf` **自己的定义**也换了，
  变成 `relOf = f => relOf(f)...` 无限递归。批量替换必须排除定义处（或替换后立刻跑一次）

## L-027 API 客户端的第三参数被当成请求体 —— 8 处写调用从没真跑过

- **Seen**: 2×
- **状态**: open（已加防呆 + 离线契约测试，但真实 PR 链路仍未端到端跑过）
- **症状**: `makeClient.request(method, path, config)` 的第三参数是**配置对象** `{ body: {...} }`，
  但 8 处写调用把它当请求体直接传：`{ state: 'closed' }`、`{ labels: [...] }`、
  `{ content: '-1' }`、`{ body: comment }`（字符串）……
  后果：PATCH 关 issue **发出空 body**（GitHub 返回 200 但什么都不改）、
  POST 发评论发出一个 JSON 字符串而不是对象（422）、创建标签发空 body。
  这些脚本当时没有 token，**从未真跑过**，所以一直显示为"配置完成"
- **根因**: 客户端 API 的直觉与实现不一致，且没有任何一层会报错 ——
  未知 config 字段被解构时静默忽略，字符串 body 被 `JSON.stringify` 成合法 JSON。
  「写得像对的」+「从没执行过」= 长期潜伏
- **判据**:
  ① 客户端对未知 config 字段、**非对象 body** 一律抛 `TypeError`，不许静默发请求；
  ② 必须有**离线 mock fetch 的契约测试**，断言每种写调用真正发出的 body（不依赖网络/token）；
  ③ 静态护栏扫源码，禁止历史误用写法；
  ④ 新增写调用后，**至少真跑一次**（哪怕对 dry-run 端点），不能只靠 `node --check`
- **证据**: ① 2026-11-12 体检核对全部 11 处写调用，8 处错、3 处对；
  修法是统一 `{ body: { ... } }` + `gh.js` 防呆 + `selftest` I 段 7 条断言。
  ② 同日真跑 `auto-merge.js` 的 GraphQL 查询，又冒出三个"从没跑过"才看得见的坑：
  `state` 是枚举 `OPEN` 而判定比的是小写 `'open'`（⇒ 任何 PR 都判 skip）、
  `mergeableState` 字段在 PullRequest 上根本不存在（REST 才有）、
  `mergeable` 是枚举字符串而判定期望 `true/false/null`（⇒ 冲突检测永不触发）。
  修法：抽出纯函数 `toPr()` 做语义映射，`selftest` M 段 7 条断言盯着。
  ⇒ **判据 ④ 的权重最高**：离线 mock 只能证明"发出的东西对"，
  真跑一次才能发现"读回来的东西和自己以为的不一样"。

## L-028 「配置声明」和「代码行为」各说各的 —— 没被调用过的分支永远是绿的

- **Seen**: 1×
- **状态**: PROMOTED → docs/code-standards.md#CS-17
  （结构性规则已完全硬化。**但** `/merge` 这条命令本身仍未在 Actions 上真跑过 ——
  权限对了不等于链路通了，那部分算 L-027 判据 ④ 的未结项）
- **症状**: `assistant.yml` 的 `command` job 当时吃顶层默认值 `contents: read`，
  而它的 `/merge` 分支直接 spawn `auto-merge.js` 去 `PUT /pulls/{n}/merge` ⇒ 必然 403。
  命令写在 `/help` 里、脚本体写完了、workflow 也接了 —— 看上去全套齐活，
  实际上**这条命令从第一天起就不可能成功**，而它不会留下任何痕迹
- **根因**: 权限声明（YAML，另一个文件）和代码行为（JS）谁也不知道对方要什么，
  中间没有任何一层校验。更要命的是**只有被调用才会暴露** —— `/merge` 从没人发过，
  所以从来没有出现过一次 403。与 L-027 是同一个母题（"从没真跑过"），
  但载体不同：那次是参数形状，这次是权限
- **判据**:
  - 权限一律 `permissions: {}` 顶层全无 + **逐 job 声明**，禁止靠顶层默认值传播
    （顶层只要有一条 write，以后任何人新加 job 都会白拿 —— 而他只是在"加个测试"）
  - 每个拿到 write 的 job，必须能回答「谁在写、为什么必须写」；答不上来就是多给的
  - 凡是文档/界面里**承诺过的能力**，都要能追溯到它所在 job 的权限来源（耦合断言，别靠人记）
  - 授权路径的危险面不许随权限一起扩大（本项靠 `author_association` 三重过滤兜住）
- **证据**: 2026-11-12 做权限下沉体检时发现。`grep 'contents:' .github/workflows/assistant.yml`
  只有 `read`，而 `tools/ci/handle-command.js:123` 是 `runNode('auto-merge.js')`。
  修法：command job 显式为 `contents: write`；`selftest` 增加「handle-command 会 spawn
  auto-merge.js ⇒ 该 job 必须有 contents: write」的耦合断言。
  **反例验证**：手动把 `write` 改回 `read`，selftest 变为 `213 通过 / 1 失败`，
  红的正是那一条（不是别处连带失败）

## L-029 只断言「请求发出去了」＝假绿 —— 403 也是发出去了

- **Seen**: 1×
- **状态**: open（已写进 `docs/review-protocol.md` 的 Break Check 变体；脚本护栏待补）
- **症状**: 写 `tools/ci/e2e-command.js` 验证 `/merge` 时，第一版断言是
  「确实调用了 `PUT /pulls/7/merge`」。这个断言在**合并被服务端拒绝时依然全绿** ——
  因为 403 的那个请求也是"发出去了"。它证明的是"代码走到了那一行"，不是"这件事成功了"
- **根因**: 把"调用"当成了"结果"。而 mock / 桩最大的诱惑正在这里：
  只要桩答应了，人就以为链路通了 —— 但桩答应不代表服务端答应，
  服务端答应也不代表结果符合预期
- **判据**:
  - 写操作类断言必须落在**结果**上（响应里的 `merged: true`、回帖里的"已自动合并"），
    不能只落在"发出了某个请求"
  - 反向也要测：**把下游改成失败**（403 / 500 / 超时），断言必须红。
    这叫「击穿依赖」，和 Break Check 击穿被测逻辑是同一件事的两个方向
- **证据**: 2026-11-12 写 e2e 时自查发现：第一版 34 项全绿里，没有一条能区分
  "合并成功"和"合并被服务端拒绝"。补了两处 ——
  ① 断言回帖含「已自动合并」（只有 `res.merged` 为真时才会出现）；
  ② 新增「服务端 403」场景（它本身就是反向用例：断言不谎报成功、且把失败回帖告诉人）。
  补完 39 项。注意**这不是"加了一条断言"，是把断言的对象从"调用"换成了"结果"**

## L-030 脚本里写死本机私有路径 —— 配置被绑死在一台机器上

- **Seen**: 1×
- **状态**: PROMOTED → docs/code-standards.md#CS-18
  （历史里的旧引用**有意不追**：改不掉，报出来只会每周红一次然后被无视。
  新引入的由 pre-commit / pre-push / CI 三道拦。）
- **症状**: 几个脚本的用法说明、错误提示里写着「从某个本机私有目录读 token」，
  其中两个脚本直接去读那个目录。仓库里**没有任何密钥**，所以凭据门禁一条都没报 ——
  但 clone 的人照着做只会得到"文件不存在"，而他没法判断是自己没配好还是文档写错了
- **根因**: 把「我这台机器上怎么跑通的」当成了「这个项目怎么跑」。
  门禁当时只认"长得像密钥的东西"，而一条路径既不含密钥、也没有异常形态，
  在所有规则下都是干净的。**它不是安全问题，是可用性问题** ——
  所以谁也没把它当成门禁该管的事
- **判据**:
  - 配置一律走环境变量；代码里不要写"从某个固定目录读"
  - 文档给命令时，凭据位置写 `GITHUB_TOKEN=…`，不写某个具体文件路径
  - 门禁要有「本机路径」这一类规则（Windows 用户目录 / macOS·Linux 家目录 / `~/.xxx/`），
    并且**排除 URL 里的同名片段**，否则一条正常链接就会把门禁逼成噪音
  - 历史审计可以不查路径（改不掉，只会每周红一次然后被无视），但**新增必须拦**
- **证据**: 2026-11-12 用户指出「门禁有问题，本机路径也进仓库了」。全仓 11 处引用，
  2 个脚本真的去读那个目录（其余是用法说明与错误提示）。
  修法：改成只读 `GITHUB_TOKEN`；`scan_secrets.js` 增 `PATH_RULES`（3 条，全 block）
  + selftest 13 条断言；用真实暂存内容验证过拦截（**exit 1**，不是只在单测里红）；
  反例夹具本身必须长得像真路径，用 `pj-secret-ok` 逐行豁免并写明理由。
  踩到的一个细节：Windows 路径的 `[\\/]{1,2}` 量化在**转义 3 层**时会漏，
  而漏掉的正是"最像真实配置"的那种写法 —— 改成 `+` 不设上限

## L-031 门禁只盯文件、不盯提交信息 —— 代价是三轮重写历史

- **Seen**: 1×
- **状态**: PROMOTED → docs/code-standards.md#CS-19
- **症状**: 门禁把文件内容守得很严（16 条凭据规则 + 本机路径），但 **commit message 从来没被扫过**。
  于是外部项目名、本机盘符路径、私人邮箱一路写进历史并推上 GitHub；
  用户连着两天指出，最后靠三轮 `filter-branch` 才清干净
- **根因**: 直觉把「敏感信息 = 文件里的一段字符串」当成了全部。
  而 message 是**同等的公开面**：跟着 clone 走、`commit/<sha>.patch` 里能读到 `From: … <邮箱>`。
  更讽刺的是：项目里早就有「凭据扫三道（commit/push/CI）」的完整机制，
  唯独没给 message 做同样的三道 —— **机制是照抄自己就有的结构，缺的是"意识到还有这一层"**
- **判据**:
  - 任何「防止 X 进仓库」的检查，都要问一遍：X 还会从哪些**别的通道**进来？
    （文件内容 / 文件名 / 提交信息 / 提交身份 / 分支名 / tag 名 / PR 描述）
  - 提交信息与提交身份要独立成一层，挂在 `commit-msg` 钩子上（`pre-commit` 时 message 还没定稿）
  - 禁止清单要分清「功能必需」与「纯叙述」：文件里的盘符路径常常是功能必需，
    message 里的则一定只是"我本机怎么跑的"
- **证据**: 2026-11-12~13。全仓 214 个提交里 8 个命中；三轮重写（`--msg-filter`，tree 零变化）；
  GitHub 侧旧 SHA 需等平台 GC。补的护栏：`scan_secrets --message=` + `commit-msg` 钩子 +
  `--push` 扫 message 与身份 + selftest H 段 19 条断言。
  另有一条踩出来的细节：盘符正则若不排除左侧字母数字，`https://` 里的 `s://` 会被当成盘符 ——
  实测一次误报 772 条

## L-032 `git reset --hard` 会连工作区没提交的改动一起清掉

- **Seen**: 1×
- **状态**: open（尚无护栏；约定：只为一个测试提交回滚时用 `git reset --mixed`）
- **症状**: 为了删掉一条刚造的测试提交，用了 `git reset --hard HEAD~1`。
  提交没了，**同时把工作区里正在改、尚未提交的 8 处源码修改也一起回滚了** ——
  表现为"钩子在跑但扫描器不认识那个参数"，白排查了一轮
- **根因**: 只想撤销「一个 commit」，但 `--hard` 的语义是「让工作区与索引都回到那个提交」，
  它不管你上面有没有没保存的活。而当时恰好是先写代码、后造测试提交、再回滚 ——
  顺序一旦反过来就不会出事
- **判据**:
  - 只想撤提交、保留改动 ⇒ `git reset --mixed HEAD~1`（或 `--soft`）
  - 造测试提交做验证时，**先提交、再验证**；或者干脆不造提交（直接跑钩子脚本、把 message 写进临时文件）
  - 任何 `--hard` 之前先看 `git status`：有未提交改动就别用
- **证据**: 2026-11-13 补提交信息门禁时踩到。恢复办法：重做那 8 处编辑（无代码损失，只是返工）。
  更省事的做法已经写进判据：`sh .git/hooks/commit-msg <临时消息文件>` 可以不产生任何提交就验证钩子

## 怎么加一条新条目

1. 先确认它**值得记**：有没有导致返工、假绿、或差点漏掉？只是"我觉得应该这样" ⇒ 不记。
2. 取下一个未使用的 `L-NNN`（**倒序看一眼，别复用**），按上面七个字段填。
3. `Seen` 从 `1×` 起。同一个坑再次被捕获时**手动 +1**（`node tools/verify/lessons.js --bump=L-003`）。
4. 到 `3×` 时脚本会提示升格：把规则搬进 `docs/code-standards.md` 并挂上护栏，
   这里改成 `PROMOTED → docs/code-standards.md#CS-NN`。
