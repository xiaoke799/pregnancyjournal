# AGENTS.md —— 入口路由（只指路，不装规则）

孕程记（pregnancyjournal）：fnOS NAS 上的孕期记录应用。Node + Express + sql.js / Vue3 + TS + Vite，
打 fpk 上架。**数据零上云**，家庭共用，不做租户隔离（既定设计，别再提"加鉴权隔离"）。

> 本文件是**路由表**，故意写得很短。规则正文都在下面指向的文件里 ——
> 把规范堆进入口文件，只会稀释注意力，然后谁也不读。

## 我要做什么 → 去哪看

| 我要… | 去读 | 配套可执行物 |
|---|---|---|
| 改代码前确认红线 | `docs/code-standards.md`（L3 硬化规范，每条挂护栏） | 见该文「护栏」列 |
| 看这个坑以前踩过没 | `LESSONS.md`（L2 错题本，带 Seen 次数） | `node tools/verify/lessons.js` |
| 提交前自查 / 判断改动够不够格 | `docs/review-protocol.md`（Red Check · Break Check · Not run） | — |
| 知道我这次改动**必须**跑哪几套 | `tools/verify/README.md` 的「相关铁律」表 | `node tools/verify/gate.js` |
| 担心密钥被提交/推上去 | `docs/review-protocol.md` §八 | `node tools/verify/scan_secrets.js --all` |
| 跑全量回归 | `tools/verify/README.md` | `node tools/verify/run_all_suites.js` |
| 发版 / 打包 / 版本号 | `DEPLOY_NOTES.md`、`docs/ROLLBACK.md` | `node tools/verify/gate.js release --tag=vX.Y.Z` |
| 调 PR 审查 / 自动合并 / issue 回复机器人 | `docs/workflow-automation.md` | `node tools/ci/selftest.js` |
| 查目录、数据位置、升级丢数据 | `docs/system_design.md`、`DEPLOY_NOTES.md` | — |
| 看这套工作流怎么转起来 | `docs/workflow.md` | — |

## 三条不可协商

1. **没跑过的检查，必须写 `Not run`。** 不许用「应该没问题」代替。没在真机上验过的能力，
   不许向用户承诺可用，也不许在它上面继续派生代码。
2. **「构建通过 / 接口 200」都不是修复证据。** 证明改动生效要开包逐字节比对
   （`app/ui` 产物 vs `frontend/src` 的 mtime 与内容），接口要读回真实数据。
3. **红灯不是「偶发」。** main 上挂掉的套件 = 当前最高优先级 Bug，不许当 Flake 跳过；
   更不许把断言改松让它变绿。

## 提交纪律（这个仓库多会话并行是常态）

- 信号：冒出你没建的新文件 / 别人的注释 / mtime 异常新。
- 此时**只改对方没碰的文件**，**别跑** `npm run build`、全量回归、打包（`app/ui/` 是共享产物，两边互踩）。
- 提交**只点名自己的文件**：`git commit -m "..." -- <自己的路径>`，绝不 `git add -A`。
  提交前先 `git diff --cached --stat` 看清暂存区里有没有别人的东西。
- `/.workbuddy/` 在 `.git/info/exclude` 里（本地私有，不入库）。**规则的真源在仓库内**；
  `.workbuddy/memory/` 只是本机缓存，clone 的人看不到它 —— 所以新规则要写进 `LESSONS.md`。

## 一条命令的自检

```bash
node tools/verify/gate.js            # 按当前改动自动选套件并跑，红则非零退出
```
