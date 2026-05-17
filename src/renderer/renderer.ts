import { Viewport } from './viewport';
import { drawGrid, GridConfig } from './grid';
import { GerberImage, LayerManager } from '../model/gerber-image';
import { GerberItem, Point, pt } from '../model/gerber-item';
import { DCode, ApertureMacro, AmPrimitive } from '../parser/aperture';
import { ShapeType, ApertureType, DrillShape, Interpolation, MacroPrimitiveId, IU_PER_MM } from '../model/enums';
import { transformPointWorld } from '../tools/transform';

export interface DisplayOptions {
  linesFill: boolean;
  flashesFill: boolean;
  polygonsFill: boolean;
  showGrid: boolean;
  showDcodes: boolean;
  showNegativeObjects: boolean;
  highContrastMode: boolean;
  activeLayer: number;
  xorMode: boolean;
  opacityMode: boolean;
  opacityAlpha: number;
  mirror: boolean;
  highlightNet: string;
  highlightComp: string;
  highlightAttr: string;
  highlightDcode: number;
  gridConfig: Partial<GridConfig>;
  backgroundColor: string;
  dcodeLabelColor: string;
}

export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = {
  linesFill: true,
  flashesFill: true,
  polygonsFill: true,
  showGrid: true,
  showDcodes: false,
  showNegativeObjects: true,
  highContrastMode: false,
  activeLayer: -1,
  xorMode: false,
  opacityMode: false,
  opacityAlpha: 0.6,
  mirror: false,
  highlightNet: '',
  highlightComp: '',
  highlightAttr: '',
  highlightDcode: 0,
  gridConfig: {},
  backgroundColor: '#000000',
  dcodeLabelColor: '#ffff00',
};

interface MacroShape { points: Point[]; exposure: boolean; }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport;
  private layerManager: LayerManager;
  displayOptions: DisplayOptions = { ...DEFAULT_DISPLAY_OPTIONS };
  private offCanvas: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D, viewport: Viewport, layerManager: LayerManager) {
    this.ctx = ctx;
    this.viewport = viewport;
    this.layerManager = layerManager;
    this.offCanvas = document.createElement('canvas');
    this.offCtx = this.offCanvas.getContext('2d')!;
  }

  render() {
    const { canvasWidth: w, canvasHeight: h } = this.viewport;
    const ctx = this.ctx;

    if (this.offCanvas.width !== w || this.offCanvas.height !== h) {
      this.offCanvas.width = w;
      this.offCanvas.height = h;
    }

    ctx.fillStyle = this.displayOptions.backgroundColor || '#000000';
    ctx.fillRect(0, 0, w, h);

    if (this.displayOptions.mirror) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }

    if (this.displayOptions.showGrid) {
      drawGrid(ctx, this.viewport, this.displayOptions.gridConfig);
    }

    for (let i = 0; i < this.layerManager.layers.length; i++) {
      const layer = this.layerManager.layers[i];
      if (!layer || !layer.visible) continue;

      const isLastVisible = this.isLastVisibleLayer(i);

      if (this.displayOptions.xorMode && !isLastVisible) {
        this.renderLayerXOR(layer);
      } else {
        let alpha = layer.opacity;
        if (this.displayOptions.highContrastMode && this.displayOptions.activeLayer >= 0) {
          alpha = i === this.displayOptions.activeLayer ? layer.opacity : 0.15 * layer.opacity;
        } else if (this.displayOptions.opacityMode) {
          alpha = this.displayOptions.opacityAlpha * layer.opacity;
        }
        this.renderLayerNormal(layer, alpha);
      }
    }

    if (this.displayOptions.mirror) {
      ctx.restore();
    }
  }

  private isLastVisibleLayer(layerIdx: number): boolean {
    for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
      const l = this.layerManager.layers[i];
      if (l && l.visible) return i === layerIdx;
    }
    return false;
  }

  private renderLayerNormal(layer: GerberImage, alpha: number) {
    const ctx = this.ctx;
    const isNegImage = layer.imagePolarity === 'NEG';

    this.offCtx.clearRect(0, 0, this.offCanvas.width, this.offCanvas.height);

    for (const item of layer.items) {
      const isClear = item.layerPolarityClear !== isNegImage;
      const hlColor = this.getHighlightColor(item);
      const itemColor = hlColor || layer.color;
      if (isClear) {
        this.offCtx.save();
        this.offCtx.globalCompositeOperation = 'destination-out';
        this.renderItemShape(this.offCtx, item, layer, '#ffffff');
        this.offCtx.restore();
      } else {
        this.renderItemShape(this.offCtx, item, layer, itemColor);
      }
    }

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(this.offCanvas, 0, 0);
    ctx.restore();

    if (this.displayOptions.showDcodes) {
      this.renderDcodeLabels(ctx, layer);
    }
  }

  private renderLayerXOR(layer: GerberImage) {
    const ctx = this.ctx;
    const isNegImage = layer.imagePolarity === 'NEG';

    this.offCtx.clearRect(0, 0, this.offCanvas.width, this.offCanvas.height);
    for (const item of layer.items) {
      const isClear = item.layerPolarityClear !== isNegImage;
      if (isClear) {
        this.offCtx.save();
        this.offCtx.globalCompositeOperation = 'destination-out';
        this.renderItemShape(this.offCtx, item, layer, '#ffffff');
        this.offCtx.restore();
      } else {
        this.renderItemShape(this.offCtx, item, layer, layer.color);
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'xor';
    ctx.drawImage(this.offCanvas, 0, 0);
    ctx.restore();
  }

  // ========== 单个图元渲染 ==========

  private renderItemShape(ctx: CanvasRenderingContext2D, item: GerberItem, layer: GerberImage, color: string) {
    const vp = this.viewport;

    const transformPoint = (p: Point): Point => {
      return vp.worldToScreen(transformPointWorld(item, layer, p));
    };

    const fill = this.getFillMode(item);
    ctx.save();

    switch (item.shapeType) {
      case ShapeType.Segment: this.renderSegment(ctx, item, transformPoint, color, fill); break;
      case ShapeType.Arc: this.renderArc(ctx, item, transformPoint, color, fill); break;
      case ShapeType.Circle: this.renderCircle(ctx, item, transformPoint, color, fill); break;
      case ShapeType.Polygon: this.renderPolygon(ctx, item, transformPoint, color, fill); break;
      case ShapeType.SpotCircle: this.renderSpotCircle(ctx, item, transformPoint, color, fill, layer); break;
      case ShapeType.SpotRect: this.renderSpotRect(ctx, item, transformPoint, color, fill, layer); break;
      case ShapeType.SpotOval: this.renderSpotOval(ctx, item, transformPoint, color, fill, layer); break;
      case ShapeType.SpotPoly: this.renderSpotPolygon(ctx, item, transformPoint, color, fill, layer); break;
      case ShapeType.SpotMacro: this.renderSpotMacro(ctx, item, transformPoint, color, fill, layer); break;
    }
    ctx.restore();
  }

  private getFillMode(item: GerberItem): boolean {
    if (item.shapeType === ShapeType.Polygon) return this.displayOptions.polygonsFill;
    if (item.flashed) return this.displayOptions.flashesFill;
    return this.displayOptions.linesFill;
  }

  private getHighlightColor(item: GerberItem): string | null {
    const opts = this.displayOptions;
    if (opts.highlightDcode > 0 && item.dCode === opts.highlightDcode) return '#00ff00';
    if (opts.highlightNet && item.netName === opts.highlightNet) return '#00ff00';
    if (opts.highlightComp && item.componentRef === opts.highlightComp) return '#00ff00';
    if (opts.highlightAttr && item.aperFunction === opts.highlightAttr) return '#00ff00';
    return null;
  }

  private renderSegment(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean) {
    const start = tp(item.start);
    const end = tp(item.end);
    const lineW = this.viewport.worldToScreenDist(item.size.x);

    if (fill) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(lineW, 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else {
      const r = Math.max(lineW / 2, 0.5);
      const dx = end.x - start.x, dy = end.y - start.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.1) {
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.stroke();
        return;
      }
      const nx = -dy / len * r, ny = dx / len * r;
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(start.x + nx, start.y + ny);
      ctx.lineTo(end.x + nx, end.y + ny);
      ctx.arc(end.x, end.y, r, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
      ctx.lineTo(start.x - nx, start.y - ny);
      ctx.arc(start.x, start.y, r, Math.atan2(-ny, -nx), Math.atan2(ny, nx));
      ctx.closePath(); ctx.stroke();
    }
  }

  private renderArc(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean) {
    let start = tp(item.start);
    let end = tp(item.end);
    const center = tp(item.arcCenter);
    const lineW = this.viewport.worldToScreenDist(item.size.x);

    // KiCad-style: 对于 CCW 弧交换 start/end，然后统一用 increasing direction 绘制
    // 参考: rs274d.cpp fillArcGBRITEM + gerbview_painter.cpp drawArc
    const isCCW = item.interpolation === Interpolation.ArcCCW;
    if (isCCW) {
      [start, end] = [end, start];
    }

    const dx1 = start.x - center.x, dy1 = start.y - center.y;
    const radius = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    if (radius < 0.5) return;

    let startAngle = Math.atan2(dy1, dx1);
    let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

    // 统一用 counterclockwise=false（increasing angle direction）
    // 确保 endAngle > startAngle（加 2π 直到满足）
    while (endAngle <= startAngle) endAngle += Math.PI * 2;
    // KiCad: 如果弧接近完整圆则限制
    if (endAngle - startAngle > Math.PI * 2) endAngle -= Math.PI * 2;

    const sweepCCW = false; // 始终用 increasing direction

    if (fill) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(lineW, 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, startAngle, endAngle, sweepCCW);
      ctx.stroke();
    } else {
      const outerR = radius + lineW / 2;
      const innerR = Math.max(radius - lineW / 2, 0);
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      if (innerR > 0.5) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, outerR, startAngle, endAngle, sweepCCW);
        ctx.arc(center.x, center.y, innerR, endAngle, startAngle, !sweepCCW);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(center.x, center.y, outerR, startAngle, endAngle, sweepCCW);
        ctx.stroke();
      }
    }
  }

  private renderCircle(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean) {
    const center = tp(item.start);
    const radius = this.viewport.worldToScreenDist(item.size.x) / 2;
    if (fill) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.stroke();
    }
  }

  private renderPolygon(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean) {
    if (item.polygonPoints.length < 3) return;
    const screenPts = item.polygonPoints.map(tp);
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = color; ctx.fill(); }
    else { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
  }

  private renderSpotCircle(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean, layer: GerberImage) {
    const pos = tp(item.start);
    const radius = this.viewport.worldToScreenDist(item.size.x) / 2;
    const dc = layer.getDCcode(item.dCode);

    if (fill) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); ctx.fill();
      this.renderDrillHole(ctx, pos, dc, true);
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); ctx.stroke();
      this.renderDrillHole(ctx, pos, dc, false);
    }
  }

  private renderSpotRect(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean, layer: GerberImage) {
    const pos = tp(item.start);
    const hw = this.viewport.worldToScreenDist(item.size.x) / 2;
    const hh = this.viewport.worldToScreenDist(item.size.y) / 2;
    const dc = layer.getDCcode(item.dCode);

    if (fill) {
      ctx.fillStyle = color;
      ctx.fillRect(pos.x - hw, pos.y - hh, hw * 2, hh * 2);
      this.renderDrillHole(ctx, pos, dc, true);
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.strokeRect(pos.x - hw, pos.y - hh, hw * 2, hh * 2);
      this.renderDrillHole(ctx, pos, dc, false);
    }
  }

  private renderDrillHole(ctx: CanvasRenderingContext2D, pos: Point, dc: DCode, fillMode: boolean) {
    if (dc.drill.x <= 0) return;

    if (dc.drillShape === DrillShape.RectHole && dc.drill.y > 0) {
      // 矩形孔
      const dhw = this.viewport.worldToScreenDist(dc.drill.x) / 2;
      const dhh = this.viewport.worldToScreenDist(dc.drill.y) / 2;
      if (fillMode) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(pos.x - dhw, pos.y - dhh, dhw * 2, dhh * 2);
        ctx.restore();
      } else {
        ctx.strokeRect(pos.x - dhw, pos.y - dhh, dhw * 2, dhh * 2);
      }
    } else {
      // 圆形孔
      const drillR = this.viewport.worldToScreenDist(dc.drill.x) / 2;
      if (fillMode) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, drillR, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(pos.x, pos.y, drillR, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  private renderSpotOval(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean, layer: GerberImage) {
    const pos = tp(item.start);
    const hw = this.viewport.worldToScreenDist(item.size.x) / 2;
    const hh = this.viewport.worldToScreenDist(item.size.y) / 2;
    const r = Math.min(hw, hh);
    const dc = layer.getDCcode(item.dCode);

    const drawOval = () => {
      ctx.beginPath();
      if (hw >= hh) {
        const s = hw - r;
        ctx.arc(pos.x - s, pos.y, r, Math.PI / 2, -Math.PI / 2);
        ctx.lineTo(pos.x + s, pos.y - r);
        ctx.arc(pos.x + s, pos.y, r, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
      } else {
        const s = hh - r;
        ctx.arc(pos.x, pos.y - s, r, Math.PI, 0);
        ctx.lineTo(pos.x + r, pos.y + s);
        ctx.arc(pos.x, pos.y + s, r, 0, Math.PI);
        ctx.closePath();
      }
    };

    if (fill) {
      ctx.fillStyle = color; drawOval(); ctx.fill();
      this.renderDrillHole(ctx, pos, dc, true);
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 1; drawOval(); ctx.stroke();
      this.renderDrillHole(ctx, pos, dc, false);
    }
  }

  private renderSpotPolygon(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean, layer: GerberImage) {
    const dc = layer.getDCcode(item.dCode);
    const pos = tp(item.start);
    const radius = this.viewport.worldToScreenDist(item.size.x) / 2;
    const n = dc.edgesCount || 5;
    const rotRad = (dc.rotation || 0) * Math.PI / 180;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rotRad + (2 * Math.PI * i) / n - Math.PI / 2;
      const x = pos.x + radius * Math.cos(a), y = pos.y + radius * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = color; ctx.fill();
      this.renderDrillHole(ctx, pos, dc, true);
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      this.renderDrillHole(ctx, pos, dc, false);
    }
  }

  private renderSpotMacro(ctx: CanvasRenderingContext2D, item: GerberItem, tp: (p: Point) => Point, color: string, fill: boolean, layer: GerberImage) {
    const dc = layer.getDCcode(item.dCode);
    if (!dc || !dc.macro) return;
    const pos = tp(item.start);
    const shapes = this.generateMacroShape(dc.macro, dc.macroParams);
    const pixScale = 1 / this.viewport.scale;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    for (const shape of shapes) {
      if (shape.points.length < 3) continue;
      ctx.beginPath();
      for (let i = 0; i < shape.points.length; i++) {
        const sx = shape.points[i].x * pixScale;
        const sy = -shape.points[i].y * pixScale;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();

      if (shape.exposure) {
        if (fill) { ctx.fillStyle = color; ctx.fill(); }
        else { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
      } else if (fill) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ========== D 代码标签 ==========

  private renderDcodeLabels(ctx: CanvasRenderingContext2D, layer: GerberImage) {
    ctx.save();
    ctx.fillStyle = this.displayOptions.dcodeLabelColor || '#ffff00';
    ctx.globalAlpha = 0.8;

    for (const item of layer.items) {
      if (item.dCode < 10) continue;
      const screenSize = this.viewport.worldToScreenDist(Math.max(item.size.x, item.size.y));
      if (screenSize < 3) continue;

      const label = `D${item.dCode}`;
      const fontSize = Math.min(Math.max(screenSize / 3, 8), 20);
      ctx.font = `${fontSize}px monospace`;

      let pos: Point;
      if (item.flashed) {
        pos = this.itemToScreen(item, item.start, layer);
      } else {
        pos = this.itemToScreen(item, pt((item.start.x + item.end.x) / 2, (item.start.y + item.end.y) / 2), layer);
      }
      ctx.fillText(label, pos.x + 2, pos.y - 2);
    }
    ctx.restore();
  }

  private itemToScreen(item: GerberItem, p: Point, layer: GerberImage): Point {
    let { x, y } = p;
    x += item.layerOffset.x; y += item.layerOffset.y;
    x *= item.drawScale.x; y *= item.drawScale.y;
    if (item.mirrorA) x = -x;
    if (item.mirrorB) y = -y;
    if (item.layerRotation !== 0) {
      const rad = item.layerRotation * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const nx = x * c - y * s, ny = x * s + y * c;
      x = nx; y = ny;
    }
    if (item.swapAxis) [x, y] = [y, x];
    x += layer.imageOffset.x; y += layer.imageOffset.y;
    if (layer.imageRotation !== 0) {
      const rad = layer.imageRotation * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const nx = x * c - y * s, ny = x * s + y * c;
      x = nx; y = ny;
    }
    return this.viewport.worldToScreen({ x, y });
  }

  // ========== 光圈宏形状生成 ==========

  private generateMacroShape(macro: ApertureMacro, params: number[]): MacroShape[] {
    const resolvedParams = [...params];
    for (const [idx, param] of macro.localParams) {
      if (idx > resolvedParams.length) {
        while (resolvedParams.length < idx) resolvedParams.push(0);
      }
      if (idx > 0) resolvedParams[idx - 1] = param.evaluate(resolvedParams);
    }

    const shapes: MacroShape[] = [];
    for (const prim of macro.primitives) {
      const primShapes = this.generatePrimitiveShapes(prim, resolvedParams);
      for (const pts of primShapes) {
        if (pts.length > 0) {
          shapes.push({ points: pts, exposure: prim.exposureOn });
        }
      }
    }
    return shapes;
  }

  private generatePrimitiveShapes(prim: AmPrimitive, params: number[]): Point[][] {
    const p = (idx: number): number => {
      if (idx >= prim.params.length) return 0;
      return prim.params[idx].evaluate(params);
    };
    const toNm = (val: number) => val * IU_PER_MM;
    const makeCircle = (cx: number, cy: number, r: number, n = 64) => {
      const pts: Point[] = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        pts.push(pt(cx + r * Math.cos(a), cy + r * Math.sin(a)));
      }
      return pts;
    };
    const makeRect = (x1: number, y1: number, x2: number, y2: number) =>
      [pt(x1, y1), pt(x2, y1), pt(x2, y2), pt(x1, y2)];

    switch (prim.id) {
      case MacroPrimitiveId.Circle: {
        const diameter = toNm(p(1));
        const cx = toNm(p(2)), cy = toNm(p(3));
        return [makeCircle(cx, cy, diameter / 2)];
      }
      case MacroPrimitiveId.Line20:
      case MacroPrimitiveId.Line2: {
        const width = toNm(p(1));
        const sx = toNm(p(2)), sy = toNm(p(3));
        const ex = toNm(p(4)), ey = toNm(p(5));
        const rotation = p(6) * Math.PI / 180;
        const dx = ex - sx, dy = ey - sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return [];
        const nx = -dy / len * width / 2, ny = dx / len * width / 2;
        let pts = [pt(sx + nx, sy + ny), pt(ex + nx, ey + ny), pt(ex - nx, ey - ny), pt(sx - nx, sy - ny)];
        if (Math.abs(rotation) > 0.001) pts = rotatePoints(pts, rotation);
        return [pts];
      }
      case MacroPrimitiveId.LineCenter: {
        const width = toNm(p(1)), height = toNm(p(2));
        const cx = toNm(p(3)), cy = toNm(p(4));
        const rotation = p(5) * Math.PI / 180;
        const hw = width / 2, hh = height / 2;
        let pts = makeRect(cx - hw, cy - hh, cx + hw, cy + hh);
        if (Math.abs(rotation) > 0.001) pts = rotatePoints(pts, rotation);
        return [pts];
      }
      case MacroPrimitiveId.LineLowerLeft: {
        const width = toNm(p(1)), height = toNm(p(2));
        const x = toNm(p(3)), y = toNm(p(4));
        const rotation = p(5) * Math.PI / 180;
        let pts = makeRect(x, y, x + width, y + height);
        if (Math.abs(rotation) > 0.001) pts = rotatePoints(pts, rotation);
        return [pts];
      }
      case MacroPrimitiveId.Outline: {
        const nPoints = Math.round(p(1));
        const rotation = p(2 + nPoints * 2) * Math.PI / 180;
        let pts: Point[] = [];
        for (let i = 0; i < nPoints; i++) pts.push(pt(toNm(p(2 + i * 2)), toNm(p(3 + i * 2))));
        if (Math.abs(rotation) > 0.001) pts = rotatePoints(pts, rotation);
        return [pts];
      }
      case MacroPrimitiveId.Polygon5: {
        const nV = Math.round(p(1));
        const cx = toNm(p(2)), cy = toNm(p(3));
        const diameter = toNm(p(4));
        const rotation = p(5) * Math.PI / 180;
        const r = diameter / 2;
        const pts: Point[] = [];
        for (let i = 0; i < nV; i++) {
          const a = rotation + (2 * Math.PI * i) / nV;
          pts.push(pt(cx + r * Math.cos(a), cy + r * Math.sin(a)));
        }
        return [pts];
      }
      case MacroPrimitiveId.Moire: {
        const cx = toNm(p(0)), cy = toNm(p(1));
        const outerDia = toNm(p(2));
        const ringWidth = toNm(p(3));
        const gapWidth = toNm(p(4));
        const maxRings = Math.round(p(5));
        const crossW = toNm(p(6));
        const crossLen = toNm(p(7));
        const rotation = p(8) * Math.PI / 180;

        const shapes: Point[][] = [];
        // 同心圆环：从外到内，交替外径和内径
        let currentDia = outerDia;
        for (let ring = 0; ring < maxRings && currentDia > 0; ring++) {
          const r = currentDia / 2;
          if (r <= 0) break;
          // 环宽 vs 直径：如果环宽 >= 直径，画实心圆
          if (ringWidth >= currentDia) {
            shapes.push(makeCircle(cx, cy, r));
          } else {
            // 外圆环（用粗环近似）
            // Canvas 无法画环形多边形，用外圆近似
            shapes.push(makeCircle(cx, cy, r));
          }
          currentDia -= ringWidth * 2 + gapWidth * 2;
        }

        // 十字线（4 个矩形臂）
        const halfLen = crossLen / 2;
        const halfW = crossW / 2;
        if (crossLen > 0 && crossW > 0) {
          // 水平臂
          let arm = makeRect(cx - halfLen, cy - halfW, cx + halfLen, cy + halfW);
          if (Math.abs(rotation) > 0.001) arm = rotatePoints(arm, rotation);
          shapes.push(arm);
          // 垂直臂
          arm = makeRect(cx - halfW, cy - halfLen, cx + halfW, cy + halfLen);
          if (Math.abs(rotation) > 0.001) arm = rotatePoints(arm, rotation);
          shapes.push(arm);
        }

        return shapes;
      }
      case MacroPrimitiveId.Thermal: {
        // Thermal: 外环 - 内环 + 四个径向间隙
        // 参数: cx, cy, outer_dia, inner_dia, gap_width, rotation
        const cx = toNm(p(0)), cy = toNm(p(1));
        const outerDia = toNm(p(2));
        const innerDia = toNm(p(3));
        const gapWidth = toNm(p(4));
        const rotation = p(5) * Math.PI / 180;

        const outerR = outerDia / 2;
        const innerR = innerDia / 2;
        const halfGap = gapWidth / 2;

        // 生成 4 个扇形（每象限一个），连接成一个完整形状
        // 每个扇形由外弧段和内弧段连接而成
        const pts: Point[] = [];
        const arcSteps = 16; // 每个扇形的弧段步数
        const sectorAngle = Math.PI / 2; // 90度一个扇形

        for (let s = 0; s < 4; s++) {
          const baseAngle = rotation + s * sectorAngle;

          // 间隙角度范围：从 baseAngle - gapHalfAngle 到 baseAngle + gapHalfAngle
          // 扇形从间隙结束到下一个间隙开始
          const gapHalfAngle = halfGap > 0 && outerR > 0 ? Math.asin(Math.min(halfGap / outerR, 1)) : 0;
          const startAngle = baseAngle + gapHalfAngle;
          const endAngle = baseAngle + sectorAngle - gapHalfAngle;

          if (startAngle >= endAngle) continue;

          // 外弧（从 startAngle 到 endAngle）
          for (let i = 0; i <= arcSteps; i++) {
            const a = startAngle + (endAngle - startAngle) * i / arcSteps;
            pts.push(pt(cx + outerR * Math.cos(a), cy + outerR * Math.sin(a)));
          }

          // 内弧（从 endAngle 到 startAngle，反方向）
          for (let i = arcSteps; i >= 0; i--) {
            const a = startAngle + (endAngle - startAngle) * i / arcSteps;
            pts.push(pt(cx + innerR * Math.cos(a), cy + innerR * Math.sin(a)));
          }
        }
        return pts.length > 0 ? [pts] : [];
      }
      default: return [[]];
    }
  }
}

function rotatePoints(pts: Point[], rad: number): Point[] {
  const c = Math.cos(rad), s = Math.sin(rad);
  return pts.map(q => pt(q.x * c - q.y * s, q.x * s + q.y * c));
}
