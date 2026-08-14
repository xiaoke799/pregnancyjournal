# 孕程记 FPK 打包 & 部署问题记录

## 1. FPK 安装报"应用包不符合系统要求" (code 10111)

**原因**：用 `tar` 手动打包的格式不符合 fnOS 系统要求
**解决**：必须用飞牛官方 `fnpack_tool.exe` 打包

```bash
# 正确的打包命令（Windows）
fnpack_tool.exe build --directory D:\pregnancy-journal\pregnancyjournal

# 输出: pregnancyjournal.fpk（在 working directory 下）
```

**注意**：
- 不能用 `bsdtar`（Windows 自带）或 `GNU tar`（Git Bash）手动打 tar.gz
- fnpack 工具路径：`D:\pregnancy-journal\fnpack_tool.exe` (v1.2.0)
- 一键打包脚本：`D:\pregnancy-journal\build-fpk.bat`

---

## 2. 公网访问 NAS 时无法打开应用 (Connection refused)

**原因**：`app/ui/config` 中使用了 `url` 字段指定 CGI 路径，外网通过网关转发时 index.cgi 转发失败

**错误配置**（会导致外网不可用）：
```json
{
  ".url": {
    "pregnancyjournal.APPLICATION": {
      "port": "3867",
      "url": "/cgi/ThirdParty/pregnancyjournal/index.cgi/",  // ← 外网走这个会失败
      ...
    }
  }
}
```

**正确配置**（和参考项目 qwenpaw 一致）：
```json
{
  ".url": {
    "pregnancyjournal.APPLICATION": {
      "type": "iframe",
      "protocol": "http",
      "port": "3867",
      "allUsers": true
      // 不设 url，网关直接通过端口代理，内外网统一
    }
  }
}
```

---

## 3. manifest 关键字段注意事项

| 字段 | 正确值 | 说明 |
|---|---|---|
| `platform` | `x86` | ~~`arch`~~ 已废弃，必须用 `platform` |
| `install_dep_apps` | `nodejs_v22` | 不是 nodejs_v24 |
| `disable_authorization_path` | `true` | 公网访问需要 |
| `checkport` | `false` | 不检查端口占用 |

---

## 4. 项目目录结构要点

```
pregnancyjournal/
├── manifest                  # 应用清单（根目录）
├── ICON.png / ICON_256.png   # 图标（根目录）
├── LICENSE                   # 协议（根目录）
├── app/
│   ├── server/node/          # Node.js 后端代码
│   ├── ui/                   # 前端构建产物 + config + index.cgi + images
│   └── www/                 # 前端副本（和 ui/ 内容一致）
├── cmd/                      # 生命周期脚本（main, install_callback 等）
├── config/                   # privilege, resource
└── wizard/                   # 安装向导
```

**注意**：
- `cmd/` 在根目录下，不在 `app/cmd/` 下
- `app/` 下只有 `server/`, `ui/`, `www/`，没有 `cmd/`
- 打包时排除：`node_modules`, `.git`, 测试文件, 日志, uploads
