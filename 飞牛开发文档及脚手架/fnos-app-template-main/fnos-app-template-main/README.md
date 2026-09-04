# fnOS App Template

面向飞牛 fnOS Native 应用的 Vue 3 + Nitro 模板。默认采用官方推荐的统一网关访问模型，通过 Unix Socket 接入 NAS 登录态，不直接暴露应用端口。

## 特性

- Vue 3 + Vite 前端
- Nitro 3 服务端与类型化 API 示例
- fnOS 统一网关 `/app/{appname}`
- `X-Trim-*` 网关用户上下文读取示例
- 最小权限 `run-as=package`
- 标准生命周期脚本和卸载数据向导
- `.fpk` 构建、包结构校验和 GitHub Actions

## 环境要求

- Node.js 22
- npm
- 用于安装测试的 fnOS 设备
- `fnpack 1.2.3`，可通过项目命令下载
- 设备端 `appcenter-cli`，用于脚本化安装测试

## 快速开始

```bash
npm ci
npm run dev
```

本地访问：

```text
http://127.0.0.1:3333/app/fnos-app-template/
```

开发模式同时启动 Nitro 和 Vite。前端与 API 都使用网关前缀，尽早模拟安装后的路径行为。
端口被占用时可使用 `APP_PORT=3340 WEB_PORT=3341 npm run dev`。

## 配置

应用元数据集中在 `template.config.json`：

- `appName`：应用唯一标识
- `gatewayPrefix`：必须使用 `/app/{appName}` 或其子路径
- `gatewaySocket`：安装目录下的 Unix Socket 文件名
- `runtimeDependency`：默认 `nodejs_v22`
- `osMinVersion`：统一网关国内版最低要求，默认 `1.1.3100`
- `uiAllUsers`：桌面入口是否对所有用户可见
- `maintainer`、`distributor`：发布信息

版本号以 `package.json.version` 为准，打包时同步到 `manifest`。

## 构建与打包

```bash
npm run build
npm run pack:app
npm run download:fnpack
npm run pack:fpk
```

`pack:app` 会执行构建、生成 fnOS 包目录、创建 `app.tgz`，并校验：

- manifest 关键字段
- 网关入口与 Socket 配置
- 权限和资源声明
- 生命周期脚本及可执行权限
- 64px / 256px 包图标
- `app.tgz` checksum

构建产物：

- `dist/app.tgz`
- `dist/*.fpk`
- `.fnos-build/package/`，用于排查最终包内容

## 设备测试

手动测试可从应用中心选择 `.fpk` 安装。脚本化测试在 fnOS 设备执行：

```bash
appcenter-cli install-fpk fnos-app-template.fpk
appcenter-cli start fnos-app-template
appcenter-cli list
```

发布前应在干净设备上验证安装、启动、停止、升级、卸载保留/删除数据，以及普通用户和管理员的访问边界。

## 目录

```text
packages/ui/              Vue 前端
packages/server/          Nitro API、服务与网关用户工具
packages/assets/          fnOS 图标资源
scripts/                  开发、构建、打包与校验脚本
docs/FNOS_DEVELOPMENT.md  官方开发规范摘要与发布清单
.ui-dist/                 前端构建产物
.server-dist/             Nitro 构建产物
.fnos-build/package/      fnOS 包目录
dist/                     发布产物
```

## 官方资料

- [飞牛应用开发者平台](https://developer.fnnas.com/docs/guide/)
- [Native 应用案例](https://developer.fnnas.com/docs/examples/native/)
- [统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration/)
- [fnpack](https://developer.fnnas.com/docs/cli/fnpack/)

仓库内的对照结论和维护清单见 [docs/FNOS_DEVELOPMENT.md](docs/FNOS_DEVELOPMENT.md)。
