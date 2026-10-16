# 版本回退 / Rollback

> 2026-10-16 新建。适用场景：升级后新版有问题，需要退回上一个 fpk。
> 原则：**先备份，再回退；回退不删用户数据**。

## 0. 回退前必做（30 秒）

1. 应用内「设置 → 备份/恢复」做一次**一键备份**（或整库导出）；
2. 再手工拷一份持久数据目录兜底：
   `${TRIM_PKGVAR}`（飞牛持久化变量；具体绝对路径各 NAS 不同，
   可从 `${TRIM_PKGVAR}/info.log` 或安装向导里看到）。
3. 🔴 **绝不手动删除 `${TRIM_PKGVAR}`** —— 那是用户全部数据（库文件 + 照片 + 媒体 + 备份）。

## 1. 用户侧：装回旧版 fpk（主路径）

1. 从 [GitHub Releases](https://github.com/xiaoke799/pregnancyjournal/releases) 历史里
   找到目标版本的 `pregnancyjournal_vX.Y.Z.fpk`；
2. 飞牛 OS「应用中心 → 手动安装」上传该旧版 fpk，覆盖安装；
3. 重启应用，确认版本号（设置页 / `/api/health` 返回 version）。

**数据兼容性（放心回退）**：
- schema 迁移是**增量 ADD COLUMN**（`db.js` 的 `migrateDb` 白名单补列），只加列不改旧列；
- 旧版代码读不到新列也无害：`SELECT *` 多出的 key 在 JS 侧被忽略，不会崩；
  写入时不碰新列 ⇒ 新列保留原值（NULL/默认值），**不清空**；
- ⇒ 回退**不丢数据**；哪天再升回新版，新版写的新列数据还在。
- ⚠️ 唯一要留神的：**跨大版本跳步**（如 0.0.27 直接回 0.0.20 这种跨迁移的）先看
  `tools/verify/e2e_upgrade_from_0027.js` 的口径——升级链有回归，降级链同理逐站验证更稳。

## 2. 作者侧：重新发布一个「修复版」而非让用户回退（优先）

用户回退是止损手段，**根子上应该用修复版覆盖**：

1. 在出问题的版本号上修 bug（工作区继续往前走，版本号继续递增，**不回退号**）；
2. 按 `DEPLOY_NOTES.md` §1 的顺序打包（manifest → `npm run build` → 提交 → `build.ps1`）；
3. 应用中心提交新版本 ⇒ 用户升级即覆盖。

## 3. 作者侧：把线上 tag/产物退回某个历史状态（罕见）

仅当「新版代码本身就是错的、需要重新出包」时：

```bash
git tag -d vX.Y.Z                 # 删本地 tag
git push origin :refs/tags/vX.Y.Z # 删远端 tag
git tag vX.Y.Z <正确的commit>      # 重新指向
git push origin vX.Y.Z
```

⚠️ **改 tag 前先确认 GitHub Release 附件与 tag 内容一致**（Release 的 Source code 跟着 tag 走）；
改完必须重新打包 + 开包逐字节验证（铁律：「改动进没进包」必须开包逐字节比对）。
历史留档的旧 fpk 在工作区 `.trash/fpk-*/`，别当垃圾清（`.workbuddy/backups/` 同理）。

## 4. 应用完全起不来的应急

1. 看日志：`${TRIM_PKGVAR}/info.log`、健康检查
   `GET /app/pregnancyjournal/api/v1/health`（返回 `db.ok=false` 说明库不可用）；
2. 库损坏且启动时自动回退备份失败 ⇒ 用第 0 步的手工拷贝替换库文件后重启；
3. 仍不行 ⇒ 停止应用 → 用一键备份恢复 → 启动；`uninstall_init` 从不删用户数据，
   **卸载重装不会丢数据**，这是最后的兜底。
