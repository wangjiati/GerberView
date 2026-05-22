# GerberView Web

基于 Web 技术的 Gerber 文件查看器，从 KiCad GerbView 源码转写，使用 TypeScript + Canvas2D 实现。

**此项目为探索 AI 而来，使用 GLM-5.1 模型。**

![UI diagram](UI%20diagram.png)

## 功能

- 支持 Gerber RS-274X (X2) 和 Excellon 钻孔文件格式
- 支持多图层叠加、极性合成、XOR 差分模式
- 支持宏光圈 (Aperture Macro)、Step-Repeat、层变换
- 支持测量（距离/角度/半径/面积）、DFM 分析
- 支持导出 PNG / SVG / DXF
- 图层自动识别与按板结构排序
- 框选缩放、镜像视图、高对比度模式

## 特色功能

**仿真视图** — 近似真实 PCB 外观渲染，铜层显示金属铜色、阻焊层半透明绿色覆盖、丝印白色、板框金色轮廓、钻孔深色。支持翻转查看底层视图，快捷键 `Ctrl+Shift+S`。

**只读分享** — 类似 3D 制图工具分享只读查看器，可将当前加载的 Gerber 文件导出为一份独立 HTML 文件。该文件内嵌解析后的 PCB 数据（gzip 压缩，不可逆向为原始 Gerber），接收方用浏览器打开即可查看，支持缩放、测量、DFM 分析、导出 PNG/SVG/DXF 等全部查看功能，但无法加载新文件或再次分享。

## 在线使用

[GitHub Pages](https://wangjiati.github.io/GerberView/)

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
