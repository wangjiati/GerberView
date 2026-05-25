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

**图层面板** — 分类树状结构（顶层/底层/内层/钻孔/轮廓/未识别），支持折叠展开、三级联动勾选（全部↔分类↔单图层）。图层可跨分类拖拽移动，支持颜色、透明度、类型切换。提供"顶层其他""底层其他""钻孔其他""轮廓其他"类型，方便手动归类未识别图层。

**DXF 导出** — 导出前弹窗选择导出模式和图层。三种模式：
- *原始模式* — 导出所有原始几何元素
- *轮廓模式* — 仅导出轮廓形状，跳过填充密排线段
- *合并填充* — 使用多边形布尔运算合并同层重叠元素为统一填充区域（DXF HATCH），支持 dark/clear 极性差集

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
