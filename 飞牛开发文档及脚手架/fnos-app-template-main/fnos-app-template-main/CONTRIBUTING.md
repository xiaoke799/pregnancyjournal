# Contributing

欢迎基于这个模板继续完善 fnOS 应用开发体验。

## Development

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
npm run pack:app
npm run pack:fpk
```

## Notes

- 请优先修改 `template.config.json`
- 版本号以 `package.json` 为主
- `prepare-package` 会自动同步版本到 `manifest`
- 变更打包逻辑后必须执行 `npm run pack:app`，确保包结构校验通过
- fnOS 规范和设备测试清单见 `docs/FNOS_DEVELOPMENT.md`
