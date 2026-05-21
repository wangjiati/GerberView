# KiCad GerbView vs Web GerbView 对比方案

## 目标

系统性对比本项目与 KiCad GerbView 的解析/渲染输出，精确定位不一致的位置，指导修复。

## 现状

已有基础设施：109 个文件的 KiCad 截图 + Web 截图 + 像素级对比报告。
结果：58 pass / 46 review / 5 fail。

**现有方案的不足**：
1. 纯像素对比受分辨率/反锯齿/对齐影响，误报率高
2. 无法区分"解析错误"和"渲染错误"
3. 不支持按功能维度（弧线、宏、多边形等）分类分析
4. 无增量测试能力，修复后无法快速验证

---

## 方案：三层对比体系

### 第一层：结构化解析对比（核心新增）

**原理**：不比较像素，而是比较解析器输出的结构化数据。

#### 1.1 生成 KiCad 参考数据

在 KiCad 源码中，`GERBER_FILE_IMAGE` 类的 `LoadGerberFile()` 解析后会产生：
- `m_DCODES` — D 码表（形状、尺寸、宏定义）
- `m_Drawings` — 绘图图元列表（线段、弧、flash、多边形等）
- 元数据（单位、格式、极性、变换参数）

**方法 A：KiCad Python 插件（推荐）**
- 编写 KiCad Action Plugin，通过 `pcbnew.GetBoard()` 或直接调用内部 API
- 遍历 `GERBER_FILE_IMAGE` 的 `GetItems()` 和 `GetDCodes()`
- 导出为 JSON：每个图元的类型、坐标、尺寸、D 码

**方法 B：修改 KiCad 源码添加导出功能**
- 在 `GERBER_FILE_IMAGE::LoadGerberFile()` 末尾添加 JSON 序列化
- 编译自定义 `gerbview.exe`，批处理导出

**方法 C（最快上手）：利用 KiCad 的 IPC / CLI**
- KiCad 10.0 支持 `kicad-cli` 命令行
- 导出 SVG 后解析 SVG 中的路径/图元数据作为参考

#### 1.2 Web 解析器数据导出

在现有 `window.__gerbview` 测试 API 上添加：
```typescript
window.__gerbview.exportParsedData(layerIndex?: number): {
  format: string;        // "gerber" | "excellon"
  units: string;         // "mm" | "in"
  dCodes: { code: number, type: string, params: number[] }[];
  items: {
    shape: string;       // "segment" | "arc" | "circle" | "polygon" | "spot*"
    dCode: number;
    coords: number[];    // [x1,y1,x2,y2,...] nm
    params: number[];    // 形状特有参数（半径、宽度等）
    polarity: string;    // "dark" | "clear"
  }[];
  transform: { ... };
}
```

#### 1.3 自动对比流程

```
Test Files (.gbr/.drl)
    │
    ├─→ KiCad Plugin → reference.json（每个文件）
    │
    └─→ Web Parser → web_parsed.json（每个文件）
            │
         JSON Diff Tool
            │
    ┌───────┼───────┐
    │       │       │
  DCode   Items   Transform
  对比     对比    对比
```

对比维度：
- **D 码表**：类型、参数逐一对比
- **图元数量**：总量、按类型分组
- **坐标精度**：允许 ±1nm 舍入误差
- **变换参数**：极性、镜像、旋转、缩放

---

### 第二层：像素渲染对比（改进现有）

#### 2.1 统一渲染条件

当前问题：KiCad 和 Web 截图的分辨率、视口、背景色不一致。

改进：
- **KiCad 截图**：使用全屏最大化 + 固定裁剪区域 + 黑色背景
- **Web 截图**：匹配 KiCad 的画布尺寸（当前 3426x1850 vs 3797x2052，比例接近但不一致）
- 两边都禁用网格、隐藏 UI、使用相同缩放（Zoom Fit）

#### 2.2 分层对比策略

```
渲染对比
  │
  ├── 单层对比（逐一加载每个文件，单独截图对比）
  │     → 定位到具体文件的渲染差异
  │
  ├── 多层组合对比（同时加载一个 PCB 的所有层）
  │     → 测试层混合、极性合成、XOR 模式
  │
  └── 特定模式对比
        ├── 轮廓模式（Flash outline / Line outline / Polygon outline）
        ├── 负像渲染（Negative polarity）
        ├── XOR 差分模式
        └── D 码标签模式
```

#### 2.3 改进像素对比算法

当前算法的问题：二值化后 IoU 对细线不敏感，对齐搜索范围太小。

改进：
- **SSIM（结构相似性）**替代简单 IoU，更符合人眼感知
- **多尺度对比**：先粗定位（重心对齐），再精对齐（互相关搜索）
- **分区域评分**：将画面分为 N×M 网格，定位差异区域
- **边缘检测对比**：用 Canny 边缘检测后对比边缘图，忽略反锯齿差异

---

### 第三层：增量回归测试

#### 3.1 按功能分类的测试集

从现有测试文件中提取特征分类：

| 类别 | 测试文件 | 覆盖的功能 |
|------|----------|-----------|
| 线段 | 所有 .gbr | G01 插补、矩形笔 |
| 弧线 | copper 层、丝印层 | G02/G03、单/多象限、IJ 推断 |
| Flash | 所有 .gbr | 圆/矩形/椭圆/多边形/宏 |
| 宏原语 | Component layer | Circle/Line/Rect/Outline/Polygon/Moire/Thermal |
| 多边形 | 铜皮层 | G36/G37、多子多边形、evenodd |
| 极性 | 阻焊层 | LPD/LPC、destination-out |
| Step-Repeat | 含 SR 的文件 | SR 阵列 |
| 层变换 | PCB fabrication data | 镜像、旋转、缩放 |
| Excellon | .drl/.xnc 文件 | 钻孔、槽、路径 |
| X3 属性 | Component layer | TF/TA/TO/TD |

#### 3.2 回归基线

每次修复后：
1. 重新运行全量截图对比
2. 与上次基线对比，确认修复了目标问题且无回归
3. 更新基线

---

## 实施步骤

### Phase 1：修复现有 5 个 FAIL（快速见效）

优先修复 IoU=0 的 3 个文件：
1. `Hydro_Battery_Charger_SOLDERPASTE-TOP` — 可能是解析错误导致空白
2. `Hydro_Battery_Charger_SOLDERPASTE-BOTTOM` — 同上
3. `kit-dev-coldfire-xilinx_5213-NPTH-drl` — Excellon 解析问题

方法：在 Web 前端手动加载这些文件，查看渲染结果，对照 KiCad 截图定位差异。

### Phase 2：改进像素对比流程

1. 统一 KiCad/Web 截图尺寸（裁剪到相同画布比例）
2. 改进对比算法（SSIM + 边缘对比）
3. 按功能分类汇总结果

### Phase 3：构建结构化解析对比（根因定位）

1. 为 Web 端添加 `exportParsedData()` API
2. 用 KiCad CLI 或插件导出参考 JSON
3. 编写 JSON 对比工具，输出差异报告
4. 对比结果直接定位到源码行（parser vs renderer）

### Phase 4：增量测试自动化

1. 将对比流程集成到 CI（或本地脚本）
2. 建立按功能分类的测试矩阵
3. 每次修改后自动运行并生成报告

---

## 快速诊断现有问题的方法

不依赖新工具，利用现有资源快速定位问题：

### 方法：手动逐文件排查

```bash
# 1. 打开 KiCad 截图
test/screenshots/kicad/Hydro_Battery_Charger_SOLDERPASTE-TOP.png

# 2. 在 Web 前端加载同一文件
# 启动 dev server → 打开浏览器 → 加载文件 → Zoom Fit

# 3. 对比渲染结果
# → 如果 Web 显示空白 → 解析器问题（parse error）
# → 如果 Web 内容不同 → 渲染器问题（render error）
# → 如果 Web 内容位置偏 → 变换/坐标问题

# 4. 查看控制台错误
# → parse exception → parser bug
# → render error → renderer bug
```

### 方法：利用浏览器 DevTools

```javascript
// 检查解析结果
const app = window.__gerbview;
const img = app.layerManager.layers[0];  // 第一层
console.log('Items:', img.items.length);
console.log('DCodes:', Object.keys(img.dCodes));
console.log('Format:', img.format);

// 检查渲染
console.log('Transform:', img.transform);
console.log('BBox:', img.boundingBox);
```

---

## 工具清单

| 工具 | 用途 | 状态 |
|------|------|------|
| `screenshot-kicad.py` | KiCad 自动截图 | 已有 |
| `screenshot-web.mjs` | Web 自动截图 | 已有 |
| `compare-screenshots.py` | 像素对比 | 已有（需改进） |
| `run-visual-test.sh` | 一键运行 | 已有 |
| `export-parsed-data` | 导出 Web 解析数据 | **待开发** |
| KiCad 参考数据导出 | 导出 KiCad 解析数据 | **待开发** |
| JSON diff tool | 结构化对比 | **待开发** |
