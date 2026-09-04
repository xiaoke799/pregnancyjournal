`packages/assets/` 目录存放 fnOS 打包模板资源。

这些文件不会直接参与源码开发，而是在 `npm run prepare:package` 时被渲染到 `.fnos-build/package/`。

- 包图标 `ICON.PNG` 最终使用 `generated/icon_64.png`
- 包图标 `ICON_256.PNG` 必须为 256 x 256
- 入口图标使用 `generated/icon_{size}.png`
- `npm run validate:package` 会检查关键图标尺寸
