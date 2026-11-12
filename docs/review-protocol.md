# 审查协议：Red Check · Break Check · Not run

> 代码生成的成本已经趋近于零，**验证的成本没有**。这份协议的用途只有一个：
> 让"我改好了"这句话变成可核对的证据，而不是一句自述。
>
> 触发时机：任何一次提交之前。改动越大、越靠近数据与落盘，要求越严。

## 一、两个必做的检查

### Red Check（回退挂测）

**把修改前的旧代码放回去，跑新写的断言 —— 断言必须当场真的失败，并且失败在预期那一条上。**

过不了 Red Check 的测试没有信息量：它只证明了"当前代码能让这段代码跑完"。

合格的红：日志指出具体断言、给出期望值与实际值。
无效的红：`MODULE_NOT_FOUND`、`Cannot read property of undefined`、超时、编译失败 —— 这些只说明
环境坏了，不说明你测住了行为（见 CS-02 / L-003）。

**最阴的一种无效红：被跳过。** 条件不满足就提前 `return`、`skip`、浅克隆看不到历史 ——
它报告的仍然是「通过」，而实际什么都没验证。所以**跳过必须 ①带原因打印 ②单独计数**，
不许混进通过数里当无事发生。

> 真实反例：`selftest` 早先是 `if (cond) { pass++; console.log(\`✔ ${name}\`) }` —— 成功分支
> 把 detail 整个丢了，于是「浅克隆跳过」和「真验证过」在日志里长得一模一样。
> 现在跳过**单独计数、单独打印**（`✔ … ← skipped`），汇总行点名「其中 N 条因环境条件跳过：…」；
> 其余 detail 是诊断信息，通过了就不打印（否则每条成功行都会拖一坨 JSON）。
> 判据很简单：**看汇总行能不能回答"这次到底验了几条"**，答不上来就是安慰剂（CS-01 / L-022）。

### Break Check（人为击穿）

不换旧代码，而是**故意把被测逻辑改坏一处**，看断言会不会报警。

典型做法：把 `>=` 改 `>`、把 `null` 改 `''`、删掉一次 `markDirty`、把 `saveDb()` 挪到 `reload` 之后。
报警 ⇒ 断言有牙；没报警 ⇒ 断言覆盖的是别的地方。

> 两个都做的场景：修复涉及**两处**时（如"创建时补起始日" + "服务层兜底"），
> 只撤一处往往不会失败，反例会假绿。要么撤到能失败的那处，要么把断言写成直接盯住目标修复。

## 二、本仓库已验证的反例手法（照抄即可）

| 手法 | 命令 | 期望 |
|---|---|---|
| 桩件冒充工具链 | `PJ_VUE_TSC=tools/verify/_fake_tsc_bad.js node tools/verify/verify_frontend_types.js` | `0 通过 / 1 失败`，并列出桩件那两行 `error TS` |
| 工具链缺失不报假绿 | `PJ_VUE_TSC=/不存在的路径 node …` | 红，提示找不到入口 |
| 假根目录造版本漂移 | 复制 `manifest` + 三个 `package.json/lock` 到 `.tmp/fakeroot`，改一个版本号，`PJ_PKG_ROOT=<dir>` | 红，且红在"版本号一致"那条 |
| 改坏副本来验配色审查 | `PJ_EX_VUE=<改坏的 .vue 副本> python tools/verify/review_exercise_tokens.py` | 非零退出 + 六项各自的报错 |
| 让真工具链抓真错误 | 往 `frontend/src/` 放 `__typecheck_probe.ts`（`const p: number = 'x'`） | 红在 `__typecheck_probe.ts(n,m): error TS2322`；**验完立刻删** |
| 撤掉核心接线 | 删 `markDirty` 调用后跑 `probe_write_durability.js` | A5~A8/B1/B2 全红，才算有区分度 |
| 换回旧实现 | `probe_quicklog_semantics.js` 场景 G、`probe_session_resume.js` 场景 D | 旧实现必须算错 / 旧流程必须失败 |
| 行为级反例 | 把 `v-model:value` 改回 `v-model` 跑 `probe_diet_categories.js` | ❌（内容停在猪蹄系列、radio 一个选中态都没有） |

探针产物一律放 `tools/verify/.tmp/`；源码里的临时探针用完即删；跑完 `git status` 确认没有 `??` 残留。

## 三、AI / 自己写的测试，三个反模式

1. **全量 Mock 恒真**：把依赖全 mock 掉，断言"函数被调用了"。测的是调用关系，不是行为。
2. **断言实现细节**：断言某个内部变量、某行 CSS 的字面量。改一行无关代码就红 ⇒ 下次别人会把它注释掉。
3. **只走 happy path**：边界值（140/90 压线）、空值、跨天、重复提交 —— 事故几乎全长在这里。

对应的补救：压线必报 + 低一档必不报（`probe_alert_threshold.js` 的三场景写法）。

## 四、提交前的五个问题

1. 这次改动**最容易坏**的地方是哪？有断言盯着它吗？
2. 我撤掉修复之后，那条断言会不会红？（会 ⇒ 过；不会 ⇒ 断言没盯住）
3. 同一功能有没有第二个平行实现没改？（CS-03）
4. 数据类改动：**备份 → 恢复 → 逐字段比对**跑过吗？（CS-04/CS-05）
5. 哪一项我没验？**写 Not run，并说明什么条件下补**。

## 五、Not run 的写法

```
not-run: <套件/检查名> —— 原因：<缺什么环境/依赖>；补验条件：<在哪台机器/什么步骤下补>
```

禁止的写法：

- `not run`（没说为什么）
- 「应该没问题」「逻辑很简单所以没跑」
- 用「构建通过」代替运行验证（CS-02）

**没有任何 Not run 的提交是可耻的** —— 说明你要么全验了（少见），要么在掩饰。

## 六、证据块（贴进 commit message 正文或 PR 描述）

```
verify:
  red-check:   <哪条断言，回退什么之后，红在哪>
  break-check: <故意改坏了什么，哪几条变红>
  suites:      <套件名(通过/总数)> ...
  artifacts:   <截图/日志路径，若有>
  not-run:     <项名> —— 原因；补验条件
```

例：

```
verify:
  red-check:   verify_pkg_versions 在 PJ_PKG_ROOT=.tmp/fakeroot（frontend 版本改 9.9.9）下 FAIL(1)
  break-check: 删掉 route 里的 markDirty ⇒ probe_write_durability A5~A8/B1/B2 全红
  suites:      verify_pkg_versions(11/0) verify_api_contracts(4/0) verify_dark_mode(13/0)
  not-run:     e2e_heic —— 本机缺 HEIC 解码依赖；补验条件：装完依赖后跑全量
```

## 七、什么改动可以不跑套件

只有两类，且都要在提交信息里写清"为什么不需要"：

- 纯文案 / 注释 / 文档改动（不碰模板、不碰取值域、不碰 `.vue`）：`node tools/verify/gate.js` 会让你
  看到"未匹配到规则"，确认后照实写。
- 只改 `tools/verify/` 下的脚本自身：跑 `node tools/verify/gate.js --self` 做脚本自检。

其余一律跑。**"我怕跑很久"不是理由** —— `gate.js` 只跑受影响的那几套，通常 1~3 套。

## 八、密钥门禁（三道，缺一不可）

密钥一旦推到云端，**删文件是没用的** —— 它还在历史里、在 fork 里、在别人的 clone 里。
所以这道门禁的意义全在"推之前拦住"。

| 时机 | 谁在管 | 扫什么 |
|---|---|---|
| `git commit` | `pre-commit` 钩子 | 暂存区新增行 + 闸门 |
| `git push` | `pre-push` 钩子 | **远端还没有的提交**（离开这台机器前最后一道） |
| PR / push 到远端 | CI `static` job | 当前快照全量（本地 `--no-verify` 跳过时，这里兜底） |

装钩子：`node tools/verify/install_hooks.js`（默认不装，见脚本头部说明）。
手动跑：

```bash
node tools/verify/scan_secrets.js --staged    # 暂存区
node tools/verify/scan_secrets.js --push      # 待推送
node tools/verify/scan_secrets.js --all       # 已跟踪文件全量
node tools/verify/scan_secrets.js --history   # 全部历史（一次性审计，约 20s）
```

**扫什么**：GitHub PAT / classic token、AWS Access Key、私钥块、JWT、
企业微信 / 飞书 / 钉钉 / Bark 的 webhook（URL 里就带 key）、以及明确写着真实值的密钥赋值。

**不拦什么**：占位符（`xxx` / `your-key` / `${VAR}` / `process.env.X`）、全 0 的示例 UUID、
同字符重复的假值。误报在该行加 `pj-secret-ok` 注释（并写明理由）。

### 真的泄露了怎么办

1. **先去服务端撤销那个凭据**（GitHub → Settings → Tokens → Revoke）。这一步不做，后面都是自我安慰。
2. 再换新的凭据，放进环境变量或本地配置文件（不入库）。
3. 最后才考虑清理历史（`git filter-repo`）—— 而且要知道：force-push 之前别人 clone 的副本、fork、
   PR 的 diff 缓存里，旧值都还在。**所以第 1 步不可替代。**

> 这条写在这里是因为它反直觉：多数人的第一反应是 `git rebase -i` 删掉那个 commit，
> 然后 force-push —— 做完觉得"干净了"，而密钥其实一直有效。
