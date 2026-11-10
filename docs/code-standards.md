# 代码规范（L3 硬化层）

> 这里只放**已经转正**的规则：在 `LESSONS.md` 里被重复捕获 ≥3 次，或一次就造成真实数据损失。
> 每条必须挂一个**可执行护栏**；挂不上的标 `[人审]` 并写清人要看哪一眼 ——
> 没有牙的规则不许进这里，否则这份文档会退化成没人读的许愿池。
>
> 新增规则的口径：先写进 `LESSONS.md` 观察，到 3× 再往这里搬（`node tools/verify/lessons.js` 会提醒）。

## CS-01 一个从不失败的检查 = 安慰剂

**规则**：任何新断言 / 新核查脚本，**上线前必须让它真的红一次**，并留下复现方式。
解析用的正则一律容错：字段名 `[A-Za-z0-9_]+`、键名 `\w*[Cc]olor\w*`，别写 `[a-z_]`。
**判据**：说不出"我怎么让它红"的检查，不算检查。打印 🔴 必须同时计入失败计数器，否则结论行在撒谎。
**护栏**：所有套件自带反例自检（`verify_pkg_versions.js`、`verify_frontend_types.js`、`probe_write_durability.js` 等）
**来源**：L-002

## CS-02 「绿」必须有据：输入有效、退出码、红在哪、有没有真跑

**规则**：① **先断言"我拿到了要审的东西"** —— 输入为空/不可解析/**被分页截断**时判「不可判定」，
不许判通过；② 总控脚本的结论**必须落在退出码上**，不能只打印；③ 反例必须红在预期的那条断言上，
不是红在 `MODULE_NOT_FOUND` 之类的环境错误；④ 一条都没跑（筛错名字/文件缺失）必须**判红**，不许静默跳过。
**判据**：`echo $?` 是 0 才能说"通过"；`grep` 日志里红的行号是不是你期望那条；
空 diff / 空结果集 / 解析出 0 条 / `first:N` 取到的条数少于总数时，结论是不是"通过"（是 ⇒ 这里就有洞）。
**护栏**：`run_all_suites.js --ci`（`--suite` 拼错 ⇒ exit 2；红灯 ⇒ exit 1）、
`pr-review.js` 的 `empty-diff` 阻断、`auto-merge.js` 的 `files-truncated` 阻断（`selftest` C/E 两段）
**来源**：L-001、L-003、L-022、L-023

## CS-03 改「列表型 / 枚举型」功能前，先找第二个平行实现；修「坏模式」时扫全仓

**规则**：任何清单（记录类型、统计指标、推送渠道、产检条目、食谱分类）都必须有**唯一真源**；
发现两份就合并，合并前不许只改一边。
修某个「已知坏模式」（如 UTC 当本地日期、`formatted-value` 给空串）时，
必须扫一遍全仓还有没有同模式 —— **PR 只改了自己碰到的那个文件，不算修完**。
**判据**：`grep` 不到第二个清单、扫不到第二处坏模式，才算改完。已知历史雷区：统计面
（`RecordView` vs `StatsView.vue`）、食谱（页内 vs `recipes.json`）、产检数据。
**护栏**：`verify_record_entrypoints.js`；同类残留扫描 `pr-review.js` 的 `SIBLING_SCANS`（`selftest` E9/E10）
**来源**：L-004、L-021

## CS-04 动数据库**文件**先落盘，换文件后必重载

**规则**：内存 SQLite（每 30 秒整库落盘）下 —— 读文件前 `db.saveDb()`；换文件后 `db.reloadFromFile()`；
期间 `lockDb()/unlockDb()`。
**判据**：代码里出现 `config.DATABASE_PATH`、`fs.copyFile`、`restore` 字样，就必须能看到这两句。
**护栏**：`verify_db_persist.js`、`t9_verify_db_fixes.js`、`t15_crash_flush.js`
**来源**：L-005

## CS-05 加字段 / 加表必须同时登记备份与恢复白名单

**规则**：新列进 `export.js` 的 `TABLE_COLUMNS`；新表进 `ALL_TABLES`。只做导出不算完 ——
恢复侧是"先删再按白名单插"，漏了就是**永久变 null**。
**判据**：跑一遍「建数据 → 备份 → 恢复 → 逐字段比对」，不是看导出文件有没有那一列。
**护栏**：`verify_backup_schema_coverage.js`（不变量：白名单 ⊇ 建表字段）、`e2e_backup_all_fields.js`
**来源**：L-006

## CS-06 加锁写在所有校验之后，不是"记得补一句 unlock"

**规则**：`db.lockDb()` 必须在所有校验 / 提前 return **之后**。`saveDb()` 是唯一落盘点，
锁一旦卡住，写入只进内存、接口照样返回成功。
**判据**：`lockDb` 出现在函数前 10 行内 ⇒ 几乎一定错；出问题别只补 unlock。
**护栏**：`probe_async_save_race.js`、`verify_write_persist.js`
**来源**：L-007

## CS-07 naive-ui 组件用具名 prop，禁写裸 `v-model`

**规则**：`n-radio-group` / `n-input` / `n-select` / `n-date-picker` → `v-model:value`；
`n-modal` / `n-drawer` → `v-model:show`；`n-checkbox` → `v-model:checked`。
**判据**：`v-model="x"` 出现在 `n-*` 组件上就是 bug；**原生元素**（`input`/`select`/`textarea`）例外，别一起改。
**护栏**：`verify_naive_vmodel.js`（契约 + 全项目扫描 + 编译产物 + SSR 真实渲染，四层）
**来源**：L-008

## CS-08 `formatted-value` 无值给 `null`，禁给 `''`

**规则**：`n-time-picker` / `n-date-picker` 的 `formatted-value`、以及同类绑定的初值与回填，
无值一律 `null`，禁止 `|| ''`。
**判据**：症状只在「字段为空 + 打开含该控件的弹窗」时白屏，就该先看这里。
**护栏**：`[人审]` —— 崩在运行时错误边界，静态扫不干净；新表单优先用原生 `<input type="date|time">`
**来源**：L-009

## CS-09 composable 必须解构

**规则**：`const { a, b } = useXxx()`，不许 `const c = useXxx()` 之后在模板里写 `c.flag`。
**判据**：`v-if` / `v-show` 行为与预期相反（取到 Ref 对象恒真）时先查这条。
**护栏**：`[人审]` —— 类型系统查不出（Ref 也是合法类型）
**来源**：L-010

## CS-10 抽取共享组件后，断言要跟着搬，并补一条"确实被接上"

**规则**：① 新文件并入被检查源码集合；② 补「父组件真的引用了它 + 每个类型都有模板分支」的断言；
③ 共享组件里禁写 `v-else` 兜底（会静默空白），一律 `v-else-if="type === 'X'"`。
**判据**：功能在但静态断言集体红 ⇒ 多半是这个原因；反过来，只搬断言不补接线断言会变成假绿。
**护栏**：`verify_record_entrypoints.js`（含"组件确实被接上"与"每类型有分支"两条）
**来源**：L-011

## CS-11 调试产物不许写进被测目录

**规则**：临时 html / 截图 / 中间产物一律写 `tools/verify/.tmp/`（gitignore）。`app/ui/` 里除
`index.html` 外出现任何 html 都算错。
**判据**：检查脚本报"全绿"但你明明看见脏东西 ⇒ 先怀疑它把调试产物当成了正常输入。
**护栏**：`verify_ui_orphans.js`（只从 `index.html` 出发 + 多余 html 判红）
**来源**：L-012

## CS-12 类型错误保持 0 处；工具链缺失判失败

**规则**：`vue-tsc --noEmit` 必须是 0 错误。缺 `frontend/node_modules`、起不来、超时 ⇒ **判失败**，
不许报"通过"（工具链不可用 ≠ 类型没问题）。
**判据**：出现"常驻 N 个红"时，先找根因再估工作量；改前端任何 `.ts`/`.vue` 后必跑。
**护栏**：`verify_frontend_types.js`
**来源**：L-013

## CS-13 文档不写死会变的数字

**规则**：套数、项数、序号、"第 N 套"这类数字，要么不写，要么写成由脚本断言的**单一来源**。
**判据**：改完套件后 `run_all_suites.js` 末尾的绊线有没有红。
**护栏**：`run_all_suites.js` 文档一致性绊线（套数不符计入退出码）
**来源**：L-014

## CS-14 「配置项存在」≠「功能接通」

**规则**：主题、开关、模式类功能，必须有一条**静态断言钉住接线**（store → DOM 属性 / 组件 prop），
并配一条"退化后会红"的反例。
**判据**：构建通过、测试全绿，但用户看不到效果 —— 就是这类。
**护栏**：`verify_dark_mode.js`(含反例) + `probe_theme_tokens.js`(幽灵令牌 / 硬写亮色)
**来源**：L-015

---

## CS-15 后端存的是什么时区，必须先确认；日期字段不参与时区换算

**规则**：SQLite 的 `datetime('now')` / `CURRENT_TIMESTAMP` 是**无时区标记的 UTC**。
① 展示 `*_at` 列一律走唯一入口 `utils/format.ts` 的 `parseServerTime()`，
禁裸 `dayjs(..._at)` / `new Date(..._at)`；
② 纯日期字段（`entry_date` / `record_date` / `photo_date`）只表达"哪一天"：读时不补 `Z`，
写时也别把 `toISOString()` 的结果塞进去；
③ 同一张表两列口径可能不同（`push_log.pushed_at` 本地 / `created_at` UTC），
**必须按字段分别解析**，禁止 `pushed_at || created_at` 合并后统一处理；
④ 一列只允许一种写法 —— 日期列混进 UTC 时间戳后，`ORDER BY` 的字符串比较与月份分组都会中招。
**判据**：前端搜 `dayjs(` 后面跟 `_at`；后端搜 `DEFAULT (datetime('now'))` 且该列会显示给用户；
先问一句"这列存的是 UTC 还是本地"，答不上来就是嫌疑。
**护栏**：`tools/verify/probe_timezone_display.js`（parseServerTime 三分支 + 三个视图**真实函数**运行时 +
静态断言 + 反例自检）；`rules.js#datetime` 在改动 `format.ts` / `logger.js` / 日记·相册·设置三视图时自动拉它
**来源**：L-024、L-019

---

## 修改本文件的口径

- 加一条 ⇒ 必须同时给出**护栏**（脚本名或 `[人审]` + 人要看哪一眼）与**来源**（`L-NNN`）。
  给不出来，说明它还没到转正的时候，回 `LESSONS.md` 继续观察。
- 删一条 ⇒ 先确认护栏也一起下线；只删文档不删护栏，会让下一次改动"以为没人管"。
- 改判据 ⇒ 顺带确认对应套件还能红（CS-01 适用于这份文档本身）。
