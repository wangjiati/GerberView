import {
  GerberUnit, ZeroOmission, Interpolation, Polarity, LayerPolarity,
  ArcQuadrantMode, MAX_LAYERS, IU_PER_MM, IU_PER_INCH, LayerType,
  LAYER_TYPE_ORDER,
} from './enums';
import { GerberItem, Point, pt, createGerberItem } from './gerber-item';
import { transformPointWorld } from '../tools/transform';
import { DCode, ApertureMacro } from '../parser/aperture';

// 步进重复参数
export interface StepAndRepeat {
  countX: number;
  countY: number;
  distX: number; // nm
  distY: number; // nm
}

export function defaultStepAndRepeat(): StepAndRepeat {
  return { countX: 1, countY: 1, distX: 0, distY: 0 };
}

// 坐标格式
export interface CoordFormat {
  integerDigits: number;   // 整数位数
  mantissaDigits: number;  // 小数位数
}

// 一个加载的 Gerber 文件 — 对应 KiCad 的 GERBER_FILE_IMAGE
export class GerberImage {
  fileName: string = '';
  layerIndex: number = 0;
  layerType: LayerType = LayerType.Unknown;

  // 解析得到的绘图项
  items: GerberItem[] = [];

  // 光圈定义表
  dCodes: Map<number, DCode> = new Map();

  // 光圈宏定义
  apertureMacros: Map<string, ApertureMacro> = new Map();

  // 层参数
  layerName: string = '';
  layerPolarityClear: boolean = false;
  stepAndRepeat: StepAndRepeat = defaultStepAndRepeat();

  // 图像参数
  imagePolarity: Polarity = Polarity.Positive;
  imageOffset: Point = pt(0, 0);
  imageRotation: number = 0; // 度
  imageJustifyCenter: boolean = false;
  imageJustifyOffset: Point = pt(0, 0);

  // 变换参数（解析时每项会拷贝快照）
  swapAxis: boolean = false;
  mirrorA: boolean = false;
  mirrorB: boolean = false;
  scale: Point = pt(1, 1);
  offset: Point = pt(0, 0);
  localRotation: number = 0; // 度

  // 文件属性（X2）
  fileFunction: string = '';
  filePart: string = '';
  filePolarity: string = '';
  // 收集的网络名和元件名（用于高亮）
  netNames: Set<string> = new Set();
  componentRefs: Set<string> = new Set();
  aperFunctions: Set<string> = new Set();

  // 图层颜色（前端用）
  color: string = '#FFFFFF';

  // 可见性
  visible: boolean = true;
  opacity: number = 1.0; // 0-1 每层独立透明度

  // 边界框（nm）
  boundingBox: { min: Point; max: Point } | null = null;

  getDCcode(num: number): DCode {
    let dc = this.dCodes.get(num);
    if (!dc) {
      dc = new DCode();
      dc.numDcode = num;
      this.dCodes.set(num, dc);
    }
    return dc;
  }

  getApertureMacro(name: string): ApertureMacro | undefined {
    return this.apertureMacros.get(name);
  }

  setApertureMacro(macro: ApertureMacro) {
    this.apertureMacros.set(macro.name, macro);
  }

  // 计算边界框（经过变换后的坐标）
  computeBoundingBox() {
    if (this.items.length === 0) {
      this.boundingBox = null;
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of this.items) {
      const pts = getItemExtentPoints(item, this);
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    this.boundingBox = { min: pt(minX, minY), max: pt(maxX, maxY) };

    // 避免零尺寸边界框 (如水平线/垂直线/单点)
    if (maxX - minX < 1) { this.boundingBox.min.x -= 1e6; this.boundingBox.max.x += 1e6; }
    if (maxY - minY < 1) { this.boundingBox.min.y -= 1e6; this.boundingBox.max.y += 1e6; }
  }
}

function getItemExtentPoints(item: GerberItem, layer: GerberImage): Point[] {
  const tp = (p: Point): Point => transformPointWorld(item, layer, p);
  const pts: Point[] = [];
  if (item.shapeType === 'polygon' && item.polygonPoints.length > 0) {
    pts.push(...item.polygonPoints.map(tp));
  } else {
    pts.push(tp(item.start), tp(item.end));
    if (item.shapeType === 'arc' || item.shapeType === 'circle') {
      const r = Math.max(Math.abs(item.size.x), Math.abs(item.size.y)) / 2;
      const c = tp(item.arcCenter);
      pts.push(pt(c.x - r, c.y - r));
      pts.push(pt(c.x + r, c.y + r));
    }
    if (item.flashed) {
      const hw = item.size.x / 2;
      const hh = item.size.y / 2;
      const c = tp(item.start);
      pts.push(pt(c.x - hw, c.y - hh));
      pts.push(pt(c.x + hw, c.y + hh));
    } else {
      // 非闪光图元: 线宽也影响边界框
      const hw = Math.abs(item.size.x) / 2;
      const hh = Math.abs(item.size.y) / 2;
      const s = tp(item.start);
      const e = tp(item.end);
      pts.push(pt(s.x - hw, s.y - hh), pt(s.x + hw, s.y + hh));
      pts.push(pt(e.x - hw, e.y - hh), pt(e.x + hw, e.y + hh));
    }
  }
  return pts;
}

// 图层管理器 — 对应 KiCad 的 GERBER_FILE_IMAGE_LIST
export class LayerManager {
  layers: (GerberImage | null)[] = new Array(MAX_LAYERS).fill(null);

  getLayer(index: number): GerberImage | null {
    return this.layers[index] ?? null;
  }

  addLayer(image: GerberImage, index?: number): number {
    if (index !== undefined && index >= 0 && index < MAX_LAYERS) {
      image.layerIndex = index;
      this.layers[index] = image;
      return index;
    }
    // 找第一个空位
    for (let i = 0; i < MAX_LAYERS; i++) {
      if (!this.layers[i]) {
        image.layerIndex = i;
        this.layers[i] = image;
        return i;
      }
    }
    return -1;
  }

  removeLayer(index: number) {
    this.layers[index] = null;
  }

  clearAll() {
    for (let i = 0; i < MAX_LAYERS; i++) {
      this.layers[i] = null;
    }
  }

  getLoadedCount(): number {
    return this.layers.filter(l => l !== null).length;
  }

  swapLayers(i: number, j: number) {
    if (i === j || i < 0 || j < 0 || i >= MAX_LAYERS || j >= MAX_LAYERS) return;
    const a = this.layers[i], b = this.layers[j];
    this.layers[i] = b;
    this.layers[j] = a;
    if (a) a.layerIndex = j;
    if (b) b.layerIndex = i;
  }

  sortByBoardStructure() {
    const loaded = this.layers.filter((l): l is GerberImage => l !== null);
    loaded.sort((a, b) => {
      const wa = LAYER_TYPE_ORDER[a.layerType] ?? 99;
      const wb = LAYER_TYPE_ORDER[b.layerType] ?? 99;
      if (wa !== wb) return wa - wb;
      return a.layerIndex - b.layerIndex;
    });
    for (let i = 0; i < MAX_LAYERS; i++) this.layers[i] = null;
    for (let i = 0; i < loaded.length; i++) {
      loaded[i].layerIndex = i;
      this.layers[i] = loaded[i];
    }
  }

  // 计算所有图层的总边界框
  computeTotalBoundingBox(): { min: Point; max: Point } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasAny = false;
    for (const layer of this.layers) {
      if (!layer || !layer.visible || !layer.boundingBox) continue;
      hasAny = true;
      const bb = layer.boundingBox;
      if (bb.min.x < minX) minX = bb.min.x;
      if (bb.min.y < minY) minY = bb.min.y;
      if (bb.max.x > maxX) maxX = bb.max.x;
      if (bb.max.y > maxY) maxY = bb.max.y;
    }
    if (!hasAny) return null;
    return { min: pt(minX, minY), max: pt(maxX, maxY) };
  }
}
