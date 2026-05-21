# Gerber 格式官方文档与测试文件

> 来源: [Ucamco Gerber Downloads](https://www.ucamco.com/en/gerber/downloads)
> 下载日期: 2026-05-19

## 目录结构

```
docs/
├── README.md                          # 本文件
├── specifications/                    # 规范文件
├── test-files/                        # 测试文件
├── technical-notes/                   # 技术说明 (待补充)
└── press/                             # 新闻稿 (待补充)
```

---

## Specifications - 规范文件

| 文件 | 版本 | 日期 | 说明 |
|------|------|------|------|
| `gerber-layer-format-specification-revision-2026-05_en.pdf` | Rev 2026.05 | 2026 | **最新** Gerber 层格式规范 |
| `gerber-layer-format-specification-revision-2024-05_en.pdf` | Rev 2024.05 | 2024-03 | Gerber 层格式规范 |
| `gerber-job-file-schema_en.json` | - | 2023-08 | Gerber Job 文件 JSON Schema |
| `gerber-layer-format-peg_en.ebnf` | - | 2023-08 | Gerber 层格式 PEG 语法 (解析表达式文法) |
| `gerber-job-format-specification-revision-2020-08_en.pdf` | Rev 2020.08 | 2020-08 | Gerber Job 格式规范 |
| `xnc-format-specification-revision-2021-11_en.pdf` | Rev 2021.11 | 2021-12 | XNC (钻孔) 格式规范 |
| `gerber-layer-format-md5-perl-script_en.zip` | - | 2020-09 | Gerber MD5 校验 Perl 脚本 |

### 核心规范说明

- **Gerber Layer Format**: 定义了 Gerber 文件的完整语法，包括图形对象 (D-codes)、光圈定义、区域填充、极性等
- **Gerber Job Format (.gbrjob)**: 定义 PCB 制造数据的元数据 (层叠信息、材料、表面处理等)
- **XNC Format**: 扩展钻孔格式，支持属性 ( plated/non-plated, blind/buried 等)
- **PEG Grammar**: 形式化的 Gerber 语法定义，可用于验证解析器正确性

---

## Test Files - 测试文件

### X3 完整示例 (含 .gbrjob)

| 目录 | 来源 | 文件数 | 说明 |
|------|------|--------|------|
| `x3-kit-dev-coldfire-xilinx/` | Ucamco | 16 | Coldfire Xilinx 开发板，4 层板，完整 X3 数据集 |
| `x3-stickhub/` | Ucamco | 14 | StickHub，2 层板，完整 X3 数据集 |
| `x3-li-ion-charger/` | Ucamco | 16 | 锂电池充电器，4 层板 (含内层)，法文注释 |
| `x3-librepcb-sample-1/` | LibrePCB | 13 | CAN-to-USB 转换器，LibrePCB 输出 |
| `x3-librepcb-sample-2/` | LibrePCB | 13 | 电池充电器，LibrePCB 输出 |

### PCB 制造数据示例

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `pcb-fabrication-test-1/` | 13 | 4 层板制造数据示例 (含 IPC 文件) |
| `pcb-fabrication-test-2/` | 21 | 10 层板制造数据 (含盲孔/埋孔) |

### 单层 / 专项测试

| 目录 | 说明 |
|------|------|
| `x3-example-component-layer/` | 规范文档中的元件层示例 |
| `gerber-job-format-samples/` | .gbrjob 示例文件 (含 JSON Schema) |
| `gerber-job-format-test-files/` | .gbrjob 测试文件 (基本/最小) |
| `xnc-test-files/` | XNC 钻孔测试文件 (Ucamco/KiCad/LibrePCB 来源) |

### 各测试集包含的层类型

- **铜层** (Copper): F_Cu, B_Cu, Inner layers
- **阻焊层** (Solder Mask): F_Mask, B_Mask
- **丝印层** (Silkscreen): F_Silkscreen, B_Silkscreen
- **锡膏层** (Solder Paste): F_Paste, B_Paste
- **边框层** (Edge Cuts / Profile / Outlines)
- **钻孔** (Drill): PTH, NPTH, Blind, Buried (.gbr 或 .drl 或 .xnc)
- **贴片** (Pick & Place): pnp_top, pnp_bottom
- **Job 文件** (.gbrjob)

---

## 版本演进

| 版本 | 日期 | 关键特性 |
|------|------|----------|
| X1 (RS-274X) | 历史 | 基础扩展 Gerber |
| X2 | 2014 | 添加文件属性 (.FileFunction, .FilePolarity 等) |
| X3 | 2019/2020 | 添加元件属性 (.Component, .P, .N 等)，支持贴片数据 |
| Rev 2026.05 | 2026 | 最新版规范 |

---

## 用途

- **解析器开发**: 使用 PEG 文法 + 测试文件验证解析器正确性
- **渲染器开发**: 使用 X3 完整示例测试图形渲染
- **Job 文件支持**: 使用 .gbrjob 示例实现 Job 文件解析
- **DFM 分析**: 使用 PCB 制造数据示例测试 DFM 检查功能
