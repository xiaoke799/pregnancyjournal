# 孕程记 FPK 打包 & 部署说明

> **2026-10-16 改写**：本文件此前停留在 2026-09 之前的「3867 端口 + fnpack 手动打包」时代，
> 多处与现状矛盾（见文末「历史问题存档」）。现行内容以 `build.ps1` 与 `manifest` 为权威。

## 1. 现行打包流程（唯一入口 = `build.ps1`）

```bash
# 在仓库根目录执行
pwsh -File build.ps1
```

**发版实测顺序**（错一步就出「新号旧货」）：

1. 改 `manifest` 的 `version` / `sub_version` / `changelog`（**唯一真源**，sub_version 必须 3 段式）
2. `cd frontend && npm run build`（版本号被 `vite.config.ts` 的 define 烤进产物，**不重建 ⇒ 包里还是旧版本号**，此坑踩过 2 次）
3. 核验产物里带新版本号
4. 提交（工作区必须干净，见闸门）
5. `pwsh -File build.ps1`

### 版本号同步清单（8 处）

| # | 位置 | 校验方 |
|---|---|---|
| 1 | `manifest`（version + sub_version + changelog） | Step1 |
| 2 | `app/server/node/config.js` `APP_VERSION` | Step1 |
| 3 | `build.ps1` `$Version` | Step1 |
| 4 | `CHANGELOG.md` | Step1 |
| 5 | `README.md` | Step1 |
| 6 | `frontend/package.json` | `tools/verify/verify_pkg_versions.js`（Step1 fail-closed 调它） |
| 7 | `app/server/node/package.json` | 同上 |
| 8 | `app/server/node/package-lock.json`（顶层 + `packages[""]`） | 同上 |

### build.ps1 七步与发布闸门

| 步骤 | 内容 |
|---|---|
| Step 1 | 源码完整性 + **版本号一致性闸门**（8 处上表全查；前端产物必须真的带版本号；changelog 必须与本版同步） |
| Step 1.5 | 清理 `app/ui/assets` 冗余产物（依赖图驱动；**正则修不好时 fail-closed 拒打包**，不准靠 `-Force` 硬过） |
| Step 2 | 安装生产依赖（`npm install --omit=dev`） |
| Step 3 | 规范 `cmd/` 脚本编码（无 BOM、LF）+ 同步 `app/cmd` 副本 |
| Step 4 | 组装干净 stage 目录 |
| Step 5 | `fnpack_tool.exe` 打包 |
| Step 5.5 | 补包内脚本执行位（`cmd/main` 必须 `-rwxr-xr-x`） |
| Step 6 | **解包验证**：结构逐名比对 + 引用闭合 |

**两道人工闸门**（上线前检查 #6 补）：
- 工作区脏（有未提交改动）**拒绝打包**，`-AllowDirty` 放行；
- 同名版本 fpk 已存在**拒绝覆盖**，`-Force` 放行。

> fnpack 工具：`D:\pregnancy-journal\fnpack_tool.exe`（v1.2.0）。
> 历史坑：用 `bsdtar`/GNU tar 手动打 tar.gz 会报「应用包不符合系统要求 (code 10111)」。

## 2. 现行部署架构（统一网关，非独立端口）

- **前端不走 TCP 端口**：`app/ui/config` 是 `gatewaySocket: app.sock` + `gatewayPrefix: /app/pregnancyjournal`；
  后端 `server.js` 监听 **Unix Socket**（`FNOS_SOCKET_PATH` 指定），由飞牛网关转发。
- 🔴 **`app/ui/index.cgi` 不得回退 3867 端口**（历史模式，已废弃；见文末存档②）。
- 鉴权：飞牛网关在调用 CGI 前校验 NAS 登录态，注入 `X-Trim-Userid` / `X-Trim-Isadmin` / `X-Trim-Username`；
  应用内 `middleware/auth.js` 缺头即 401（dev 模式 fallback）。
- **不做用户隔离**（2026-10-14 定）：家庭共用是既定设计，`allUsers: true`；
  破坏性/管理操作已限 `x-trim-isadmin`（删数据、改推送配置、导出/备份/恢复、看日志）。
- ⚠️ **不要把 NAS/应用暴露公网**（端口转发/内网穿透/DDNS）—— 孕期照片+产检报告等于公开。

## 3. manifest 现行关键字段

| 字段 | 现行值 | 说明 |
|---|---|---|
| `platform` | `all` | ~~`arch`~~ 已废弃；x86/ARM64 双架构 |
| `install_dep_apps` | `nodejs_v22` | 不是 nodejs_v24 |
| `disable_authorization_path` | `false` | 只管「设置页是否显示授权目录」，**与登录鉴权无关**；公网访问相关旧结论已作废（见存档②） |
| `checkport` | `false` | 不检查端口占用 |
| `ctl_stop` | `true` | 停止走优雅退出（SIGTERM → 落盘后退出） |
| `os_min_version` | `1.1.3100` | |
| `desktop_uidir` | `ui` | 运行时静态目录 = `${TRIM_APPDEST}/ui`（来自 `app.tgz:ui`，即 `app/ui`） |

上架物料约束：`desc` 单行且不含 `;` `#` `"`；`changelog` 纯文本；**改后必须重新打包**。

## 4. 现行目录结构

```
pregnancy-journal/（仓库根 = 打包根）
├── manifest                  # 应用清单（根目录，版本唯一真源）
├── ICON.PNG / ICON_256.PNG   # 图标（根目录）
├── LICENSE                   # 协议（根目录）
├── build.ps1                 # 一键打包脚本（唯一入口）
├── fnpack_tool.exe           # 飞牛官方打包工具
├── app/
│   ├── server/node/          # Node.js 后端代码（package.json/lock 版本同步见上表）
│   ├── ui/                   # 前端构建产物 + config + index.cgi + assets（gitignore，构建生成）
│   └── cmd/                  # cmd/ 的构建期副本（由 build.ps1 Step3 同步，改根 cmd/ 即可）
├── cmd/                      # 9 个生命周期脚本（main/install_*/uninstall_*/upgrade_*/config_*）
├── config/                   # privilege, resource
├── wizard/                   # 安装/卸载/升级/配置向导
├── frontend/                 # 前端源码（Vue3 + TS + Vite + Naive UI）
├── tools/verify/             # 回归与核查套件（81 套 / 1696 项，入口 run_all_suites.js）
└── data/                     # 本地开发库（gitignore，不进包）
```

**注意**：
- `cmd/` 在**根目录**（`app/cmd/` 是副本，两处都要对——改根 `cmd/` 后由 Step3 同步，或手动同步）。
- ~~`app/www/`~~ 已不存在（历史死重，已删）。
- 升级抢救：`cmd/upgrade_init` 是唯一钩子；`uninstall_init` **从不删用户数据**。
- 数据目录：`TRIM_APPDEST`（安装目录，升级覆盖）≠ `TRIM_PKGVAR`（持久数据）；`DATA_DIR`(可写)=STORAGE_DIR，`ASSETS_DIR`(只读)=`<安装目录>/server/node/data`，**绝不能合并**。

## 5. 回归（打包前至少跑落盘相关）

```bash
node tools/verify/run_all_suites.js              # 全套 81 套 / 1696 项（约 9–14 分钟）
node tools/verify/run_all_suites.js --only=落盘   # 只跑关键字命中的套件
```

改动落盘逻辑必跑：`probe_write_durability.js`（端到端硬杀）+ `verify_write_persist.js`（单元层+打桩反例）+ `verify_db_persist.js` + `probe_async_save_race.js`。
回退/回滚见 `docs/ROLLBACK.md`。

---

## 历史问题存档（已解决，保留备查）

**① FPK 安装报「应用包不符合系统要求 (code 10111)** —— tar 手动打包格式不符 fnOS 要求，必须用 `fnpack_tool.exe`。已由 build.ps1 Step5 固化。

**② 公网访问 Connection refused / `disable_authorization_path` 旧结论作废** —— 早期 `app/ui/config` 用 `url` 字段指向 `/cgi/ThirdParty/.../index.cgi/`，外网经网关转发失败；当时建议 `disable_authorization_path=true`。现行架构是 Unix Socket + 网关前缀，`index.cgi` 只是网关到后端的桥，该字段与公网可用性无关，现行值 `false`。

**③ `lab_result` 路由 404** —— v0.0.28：路由误写成下划线 `/lab_results/:id`。该死路由面已于 2026-10 整体清理（前端实际用 `checkup.js` 内的 `/checkups/:id/lab-results`）。

**④ v0.0.30 sub_version 4 段式** —— `0.0.30.0` 上架无效；现已纳入 Step1 与 `verify_pkg_versions.js` 双重校验。

**⑤ v0.0.28 包在日志里谎报 v0.0.27** —— 前端产物没注入版本号（main.ts 兜底写死）；Step1 现已校验「产物必须真的带本版版本号」。
