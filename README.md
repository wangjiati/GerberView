# GerbView Web

基于 Web 技术的 Gerber 文件查看器，从 KiCad GerbView 源码转写，使用 TypeScript + Canvas2D 实现。

**此项目为探索 AI 而来，使用 GLM-5.1 模型。**

## 功能

- 支持 Gerber RS-274X (X2) 和 Excellon 钻孔文件格式
- 支持多图层叠加、极性合成、XOR 差分模式
- 支持宏光圈 (Aperture Macro)、Step-Repeat、层变换
- 支持测量（距离/角度/半径/面积）、DFM 分析
- 支持导出 PNG / SVG / DXF
- 图层自动识别与按板结构排序
- 框选缩放、镜像视图、高对比度模式

## 在线使用

[GitHub Pages](https://wangjiati.github.io/GerbView/)

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

产物为 `dist/index.html`，单文件包含所有 JS/CSS，可直接部署。

## 许可证

MIT
