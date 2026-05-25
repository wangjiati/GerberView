// 形状类型 — 对应 KiCad 的 GBR_BASIC_SHAPE_TYPE
export enum ShapeType {
  Segment = 'segment',       // 线段（圆头/方头笔）
  Arc = 'arc',               // 圆弧
  Circle = 'circle',         // 圆环
  Polygon = 'polygon',       // 填充多边形（G36/G37 区域）
  SpotCircle = 'spotCircle', // 闪光-圆形光圈
  SpotRect = 'spotRect',     // 闪光-矩形光圈
  SpotOval = 'spotOval',     // 闪光-椭圆光圈
  SpotPoly = 'spotPoly',     // 闪光-正多边形光圈
  SpotMacro = 'spotMacro',   // 闪光-光圈宏
}

// 光圈类型 — 对应 KiCad 的 APERTURE_T
export enum ApertureType {
  Circle = 'C',   // 圆形
  Rect = 'R',     // 矩形
  Oval = 'O',     // 椭圆
  Polygon = 'P',  // 正多边形
  Macro = 'M',    // 光圈宏
}

// 光圈钻孔类型
export enum DrillShape {
  NoHole = 'noHole',
  RoundHole = 'roundHole',
  RectHole = 'rectHole',
}

// 插补模式 — 对应 KiCad 的 gerb_interp
export enum Interpolation {
  Linear = 0,   // G01 线性
  ArcCW = 1,    // G02 顺时针圆弧
  ArcCCW = 2,   // G03 逆时针圆弧
}

// 曝光状态
export enum Exposure {
  Off = 0, // D02 移动
  On = 1,  // D01 画线
}

// Gerber 单位
export enum GerberUnit {
  Inch = 'inch',
  Metric = 'metric',
}

// 坐标格式零省略方式
export enum ZeroOmission {
  Leading = 'L',   // 省略前导零
  Trailing = 'T',  // 省略后尾零
}

// 极性
export enum Polarity {
  Positive = 'POS',
  Negative = 'NEG',
}

// 层极性（LP 命令）
export enum LayerPolarity {
  Dark = 'DARK',
  Clear = 'CLEAR',
}

// 圆弧象限模式
export enum ArcQuadrantMode {
  Single = 'single',   // G74 单象限
  Multi = 'multi',     // G75 多象限
}

// 光圈宏图元类型 — 对应 AM_PRIMITIVE_ID
export enum MacroPrimitiveId {
  Comment = 0,
  Circle = 1,
  Line2 = 2,
  Line20 = 20,
  LineCenter = 21,
  LineLowerLeft = 22,
  Outline = 4,
  Polygon5 = 5,
  Moire = 6,
  Thermal = 7,
}

// AM_PARAM 操作符类型
export enum ParamItemType {
  NOP,
  PushValue,
  PushParam,
  Add,
  Sub,
  Mul,
  Div,
  Negate,
}

// 图层类型
export enum LayerType {
  Unknown = 'unknown',
  TopCopper = 'topCopper',
  BottomCopper = 'bottomCopper',
  InnerCopper = 'innerCopper',
  TopSolderMask = 'topSolderMask',
  BottomSolderMask = 'bottomSolderMask',
  TopSilkscreen = 'topSilkscreen',
  BottomSilkscreen = 'bottomSilkscreen',
  TopPaste = 'topPaste',
  BottomPaste = 'bottomPaste',
  EdgeCuts = 'edgeCuts',
  Drill = 'drill',
  TopOther = 'topOther',
  BottomOther = 'bottomOther',
  DrillOther = 'drillOther',
  EdgeCutsOther = 'edgeCutsOther',
}

// 图层类型默认颜色（KiCad 惯例）
export const LAYER_TYPE_COLORS: Record<string, string> = {
  [LayerType.TopCopper]: '#bb0000',
  [LayerType.BottomCopper]: '#0000bb',
  [LayerType.InnerCopper]: '#00bbbb',
  [LayerType.TopSolderMask]: '#6e006e',
  [LayerType.BottomSolderMask]: '#6e006e',
  [LayerType.TopSilkscreen]: '#ffffff',
  [LayerType.BottomSilkscreen]: '#ffffff',
  [LayerType.TopPaste]: '#808080',
  [LayerType.BottomPaste]: '#808080',
  [LayerType.EdgeCuts]: '#ffff00',
  [LayerType.Drill]: '#00bb00',
  [LayerType.TopOther]: '#cc6666',
  [LayerType.BottomOther]: '#6666cc',
  [LayerType.DrillOther]: '#66cc66',
  [LayerType.EdgeCutsOther]: '#cccc66',
};

// 图层类型显示名称
export const LAYER_TYPE_LABELS: Record<string, string> = {
  [LayerType.Unknown]: '未识别',
  [LayerType.TopCopper]: '顶层铜',
  [LayerType.BottomCopper]: '底层铜',
  [LayerType.InnerCopper]: '内层铜',
  [LayerType.TopSolderMask]: '顶层阻焊',
  [LayerType.BottomSolderMask]: '底层阻焊',
  [LayerType.TopSilkscreen]: '顶层丝印',
  [LayerType.BottomSilkscreen]: '底层丝印',
  [LayerType.TopPaste]: '顶层锡膏',
  [LayerType.BottomPaste]: '底层锡膏',
  [LayerType.EdgeCuts]: '板框轮廓',
  [LayerType.Drill]: '钻孔',
  [LayerType.TopOther]: '顶层其他',
  [LayerType.BottomOther]: '底层其他',
  [LayerType.DrillOther]: '钻孔其他',
  [LayerType.EdgeCutsOther]: '轮廓其他',
};

// 层类型排序权重（从上到下的 PCB 结构顺序）
export const LAYER_TYPE_ORDER: Record<string, number> = {
  [LayerType.EdgeCuts]: 0,
  [LayerType.EdgeCutsOther]: 0,
  [LayerType.Drill]: 1,
  [LayerType.DrillOther]: 1,
  [LayerType.TopPaste]: 2,
  [LayerType.TopSolderMask]: 3,
  [LayerType.TopSilkscreen]: 4,
  [LayerType.TopCopper]: 5,
  [LayerType.TopOther]: 5,
  [LayerType.InnerCopper]: 6,
  [LayerType.BottomPaste]: 7,
  [LayerType.BottomSolderMask]: 8,
  [LayerType.BottomSilkscreen]: 9,
  [LayerType.BottomCopper]: 10,
  [LayerType.BottomOther]: 10,
  [LayerType.Unknown]: 11,
};

// 最大图层数（与 KiCad 一致为 32 层）
export const MAX_LAYERS = 32;

// KiCad 内部单位：1nm = 0.000001mm，1IU = 10nm
// Gerber 内部单位使用 nm（纳米）
export const IU_PER_MM = 1e6;   // 1mm = 1,000,000 nm
export const IU_PER_INCH = 2.54e7; // 1inch = 25,400,000 nm

// 图层分类定义（图层面板、导出对话框共用）
export const LAYER_CATEGORIES = [
  { label: '顶层', types: [LayerType.TopCopper, LayerType.TopSolderMask, LayerType.TopSilkscreen, LayerType.TopPaste, LayerType.TopOther] },
  { label: '底层', types: [LayerType.BottomCopper, LayerType.BottomSolderMask, LayerType.BottomSilkscreen, LayerType.BottomPaste, LayerType.BottomOther] },
  { label: '内层', types: [LayerType.InnerCopper] },
  { label: '钻孔', types: [LayerType.Drill, LayerType.DrillOther] },
  { label: '轮廓', types: [LayerType.EdgeCuts, LayerType.EdgeCutsOther] },
  { label: '未识别', types: [LayerType.Unknown] },
];
