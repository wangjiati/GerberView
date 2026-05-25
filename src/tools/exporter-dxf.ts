import { LayerManager, GerberImage } from '../model/gerber-image';
import { GerberItem, Point } from '../model/gerber-item';
import { ShapeType, Interpolation, IU_PER_MM } from '../model/enums';
import { transformPointWorld } from './transform';
import polygonClipping, { MultiPolygon, Polygon as PolyGeom } from 'polygon-clipping';

type PolyRing = [number, number][];

function toMm(nm: number): number {
  return nm / IU_PER_MM;
}

function f(v: number): string {
  return v.toFixed(6);
}

// ========== 导出选项 ==========

export interface DxfExportOptions {
  mode: 'raw' | 'outline' | 'merged';
  selectedLayers: number[];
}

// ========== 主入口 ==========

export function exportToDXF(layerManager: LayerManager, options?: DxfExportOptions): string {
  const lines: string[] = [];
  const selectedSet = options ? new Set(options.selectedLayers) : null;

  const isSelected = (i: number) => {
    if (!selectedSet) return !!layerManager.layers[i]?.visible;
    return selectedSet.has(i);
  };

  // HEADER
  lines.push('0', 'SECTION', '2', 'HEADER');
  lines.push('9', '$INSUNITS', '70', '4'); // mm
  lines.push('0', 'ENDSEC');

  // TABLES
  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push('0', 'TABLE', '2', 'LTYPE', '70', '1');
  lines.push('0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0');
  lines.push('0', 'ENDTAB');

  // Layer table
  const selectedLayers: { idx: number; layer: GerberImage; name: string }[] = [];
  for (let i = 0; i < layerManager.layers.length; i++) {
    const layer = layerManager.layers[i];
    if (!layer || !isSelected(i)) continue;
    selectedLayers.push({ idx: i, layer, name: escDxf(layer.layerName || layer.fileName || `Layer${i}`) });
  }
  lines.push('0', 'TABLE', '2', 'LAYER', '70', String(selectedLayers.length));
  for (const { name } of selectedLayers) {
    lines.push('0', 'LAYER', '2', name, '70', '0', '62', '7', '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB');
  lines.push('0', 'ENDSEC');

  // ENTITIES
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  const mode = options?.mode ?? 'raw';

  for (const { idx, layer, name: layerName } of selectedLayers) {
    if (mode === 'raw') {
      for (const item of layer.items) {
        lines.push(...itemToDXF(item, layer, layerName));
      }
    } else if (mode === 'outline') {
      for (const item of layer.items) {
        // 跳过非闪光线段（填充用密排线段）
        if (item.shapeType === ShapeType.Segment && !item.flashed) continue;
        lines.push(...itemToDXF(item, layer, layerName));
      }
    } else if (mode === 'merged') {
      exportLayerMerged(lines, layer, layerName);
    }
  }

  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');
  return lines.join('\n');
}

// ========== 合并填充模式 ==========

function exportLayerMerged(lines: string[], layer: GerberImage, layerName: string) {
  const darkPolys: PolyRing[] = [];
  const clearPolys: PolyRing[] = [];
  const nonFillItems: GerberItem[] = [];

  for (const item of layer.items) {
    const isClear = item.layerPolarityClear;
    const poly = itemToPolyRing(item, layer);
    if (poly && poly.length >= 3) {
      (isClear ? clearPolys : darkPolys).push(poly);
    }
    // 非 fill 元素（线段不参与合并，弧线单独导出）
    if (item.shapeType === ShapeType.Arc || item.shapeType === ShapeType.Circle) {
      nonFillItems.push(item);
    }
  }

  // 导出非填充项
  for (const item of nonFillItems) {
    lines.push(...itemToDXF(item, layer, layerName));
  }

  if (darkPolys.length === 0) return;

  try {
    // 将所有 dark 多边形逐个 union
    const darkGeoms: PolyGeom = darkPolys.map(p => [p] as unknown as PolyGeom[number]);
    let merged: MultiPolygon = polygonClipping.union(darkGeoms);

    // 减去 clear 多边形
    if (clearPolys.length > 0) {
      const clearGeoms: PolyGeom = clearPolys.map(p => [p] as unknown as PolyGeom[number]);
      merged = polygonClipping.difference(merged, clearGeoms);
    }

    // 输出合并结果
    for (const polygon of merged) {
      if (!polygon || polygon.length === 0) continue;
      const outerRing = polygon[0] as [number, number][];
      if (outerRing.length < 3) continue;

      // HATCH 实体
      lines.push(...polyToHatchDxf(outerRing, layerName));
      // LWPOLYLINE 轮廓
      lines.push(...polyToLwpolylineDxf(outerRing, layerName));

      // 内环（孔洞）仅输出 LWPOLYLINE
      for (let h = 1; h < polygon.length; h++) {
        const hole = polygon[h] as [number, number][];
        if (hole.length >= 3) {
          lines.push(...polyToLwpolylineDxf(hole, layerName));
        }
      }
    }
  } catch {
    // 合并失败时 fallback 到 outline 模式
    for (const item of layer.items) {
      if (item.shapeType === ShapeType.Segment && !item.flashed) continue;
      lines.push(...itemToDXF(item, layer, layerName));
    }
  }
}

// ========== 形状 → 多边形环 ==========

function itemToPolyRing(item: GerberItem, layer: GerberImage): PolyRing | null {
  const tp = (p: Point): [number, number] => {
    const w = transformPointWorld(item, layer, p);
    return [toMm(w.x), toMm(w.y)];
  };

  switch (item.shapeType) {
    case ShapeType.Polygon: {
      if (item.polygonPoints.length < 3) return null;
      return item.polygonPoints.map(tp);
    }
    case ShapeType.SpotCircle: {
      const [cx, cy] = tp(item.start);
      const r = toMm(item.size.x) / 2;
      return regularPolygon(cx, cy, r, 16);
    }
    case ShapeType.SpotRect: {
      const [cx, cy] = tp(item.start);
      const hw = toMm(item.size.x) / 2;
      const hh = toMm(item.size.y) / 2;
      return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
    }
    case ShapeType.SpotOval: {
      const [cx, cy] = tp(item.start);
      const w = toMm(item.size.x) / 2;
      const h = toMm(item.size.y) / 2;
      const r2 = Math.min(w, h);
      const pts: [number, number][] = [];
      const seg = 16;
      if (w >= h) {
        for (let i = 0; i <= seg; i++) {
          const a = -Math.PI / 2 + Math.PI * i / seg;
          pts.push([cx + w - r2 + r2 * Math.cos(a), cy + r2 * Math.sin(a)]);
        }
        for (let i = 0; i <= seg; i++) {
          const a = Math.PI / 2 + Math.PI * i / seg;
          pts.push([cx - w + r2 + r2 * Math.cos(a), cy + r2 * Math.sin(a)]);
        }
      } else {
        for (let i = 0; i <= seg; i++) {
          const a = -Math.PI + Math.PI * i / seg;
          pts.push([cx + r2 * Math.cos(a), cy + h - r2 + r2 * Math.sin(a)]);
        }
        for (let i = 0; i <= seg; i++) {
          const a = Math.PI * i / seg;
          pts.push([cx + r2 * Math.cos(a), cy - h + r2 + r2 * Math.sin(a)]);
        }
      }
      return pts;
    }
    case ShapeType.SpotPoly: {
      const [cx, cy] = tp(item.start);
      const r = toMm(item.size.x) / 2;
      return regularPolygon(cx, cy, r, 16);
    }
    case ShapeType.Segment: {
      // 沿方向挤出为长圆形（两端半圆 + 两侧直边）
      const [sx, sy] = tp(item.start);
      const [ex, ey] = tp(item.end);
      const hw = toMm(item.size.x) / 2;
      const dx = ex - sx, dy = ey - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) return null;
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const capSeg = 8;
      const pts: [number, number][] = [];
      // 起端半圆：从底侧到顶侧
      let a = Math.atan2(-ny, -nx);
      for (let i = 0; i <= capSeg; i++) {
        const t = a + Math.PI * i / capSeg;
        pts.push([sx + hw * Math.cos(t), sy + hw * Math.sin(t)]);
      }
      // 末端半圆：从顶侧到底侧
      a = Math.atan2(ny, nx);
      for (let i = 0; i <= capSeg; i++) {
        const t = a + Math.PI * i / capSeg;
        pts.push([ex + hw * Math.cos(t), ey + hw * Math.sin(t)]);
      }
      return pts;
    }
    default:
      return null;
  }
}

function regularPolygon(cx: number, cy: number, r: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// ========== DXF HATCH 实体 ==========

function polyToHatchDxf(poly: [number, number][], layerName: string): string[] {
  const r: string[] = [];
  r.push('0', 'HATCH');
  r.push('8', layerName);
  r.push('100', 'AcDbEntity', '8', layerName);
  r.push('100', 'AcDbHatch');
  r.push('10', '0.0', '20', '0.0', '30', '0.0');
  r.push('210', '0.0', '220', '0.0', '230', '1.0');
  r.push('2', 'SOLID');
  r.push('70', '1');   // solid fill
  r.push('71', '0');   // non-associative
  r.push('91', '1');   // 1 boundary path
  r.push('92', '1');   // outermost
  r.push('93', String(poly.length)); // vertex count
  for (const [x, y] of poly) {
    r.push('10', f(x), '20', f(y));
  }
  r.push('75', '1');   // odd parity
  r.push('76', '1');   // predefined
  r.push('98', '0');   // no seed points
  return r;
}

function polyToLwpolylineDxf(poly: [number, number][], layerName: string): string[] {
  const r: string[] = [];
  r.push('0', 'LWPOLYLINE', '8', layerName, '70', '1', '90', String(poly.length));
  for (const [x, y] of poly) {
    r.push('10', f(x), '20', f(y));
  }
  return r;
}

// ========== 原始 item → DXF（保持原有逻辑） ==========

function itemToDXF(item: GerberItem, layer: GerberImage, layerName: string): string[] {
  const tp = (p: Point): Point => {
    const w = transformPointWorld(item, layer, p);
    return { x: toMm(w.x), y: toMm(w.y) };
  };
  const r: string[] = [];

  switch (item.shapeType) {
    case ShapeType.Segment: {
      const s = tp(item.start), e = tp(item.end);
      r.push('0', 'LINE', '8', layerName,
        '10', f(s.x), '20', f(s.y), '30', '0',
        '11', f(e.x), '21', f(e.y), '31', '0');
      break;
    }
    case ShapeType.Arc: {
      const center = tp(item.arcCenter);
      const s = tp(item.start);
      const radius = Math.sqrt((s.x - center.x) ** 2 + (s.y - center.y) ** 2);
      let sa = Math.atan2(s.y - center.y, s.x - center.x) * 180 / Math.PI;
      const e = tp(item.end);
      let ea = Math.atan2(e.y - center.y, e.x - center.x) * 180 / Math.PI;
      // 坐标变换（mirrorA/B, swapAxis）会翻转坐标系方向，使 CW↔CCW 反转
      const flipCount = (item.mirrorA ? 1 : 0) + (item.mirrorB ? 1 : 0) + (item.swapAxis ? 1 : 0);
      const shouldSwap = (item.interpolation === Interpolation.ArcCW) !== (flipCount % 2 === 1);
      if (shouldSwap) {
        const tmp = sa; sa = ea; ea = tmp;
      }
      r.push('0', 'ARC', '8', layerName,
        '10', f(center.x), '20', f(center.y), '30', '0',
        '40', f(radius),
        '50', f(sa), '51', f(ea));
      break;
    }
    case ShapeType.Circle:
    case ShapeType.SpotCircle: {
      const c = tp(item.start);
      const radius = toMm(item.size.x) / 2;
      r.push('0', 'CIRCLE', '8', layerName,
        '10', f(c.x), '20', f(c.y), '30', '0',
        '40', f(radius));
      break;
    }
    case ShapeType.SpotRect: {
      const c = tp(item.start);
      const hw = toMm(item.size.x) / 2;
      const hh = toMm(item.size.y) / 2;
      r.push('0', 'LWPOLYLINE', '8', layerName, '70', '1', '90', '4',
        '10', f(c.x - hw), '20', f(c.y - hh),
        '10', f(c.x + hw), '20', f(c.y - hh),
        '10', f(c.x + hw), '20', f(c.y + hh),
        '10', f(c.x - hw), '20', f(c.y + hh));
      break;
    }
    case ShapeType.Polygon: {
      if (item.polygonPoints.length < 3) break;
      const pts = item.polygonPoints.map(tp);
      r.push('0', 'LWPOLYLINE', '8', layerName, '70', '1', '90', String(pts.length));
      for (const p of pts) r.push('10', f(p.x), '20', f(p.y));
      break;
    }
    case ShapeType.SpotOval: {
      const c = tp(item.start);
      const w = toMm(item.size.x) / 2;
      const h = toMm(item.size.y) / 2;
      const r2 = Math.min(w, h);
      const pts: Point[] = [];
      const seg = 16;
      if (w >= h) {
        for (let i = 0; i <= seg; i++) {
          const a = -Math.PI / 2 + Math.PI * i / seg;
          pts.push({ x: c.x + w - r2 + r2 * Math.cos(a), y: c.y + r2 * Math.sin(a) });
        }
        for (let i = 0; i <= seg; i++) {
          const a = Math.PI / 2 + Math.PI * i / seg;
          pts.push({ x: c.x - w + r2 + r2 * Math.cos(a), y: c.y + r2 * Math.sin(a) });
        }
      } else {
        for (let i = 0; i <= seg; i++) {
          const a = -Math.PI + Math.PI * i / seg;
          pts.push({ x: c.x + r2 * Math.cos(a), y: c.y + h - r2 + r2 * Math.sin(a) });
        }
        for (let i = 0; i <= seg; i++) {
          const a = Math.PI * i / seg;
          pts.push({ x: c.x + r2 * Math.cos(a), y: c.y - h + r2 + r2 * Math.sin(a) });
        }
      }
      r.push('0', 'LWPOLYLINE', '8', layerName, '70', '1', '90', String(pts.length));
      for (const p of pts) r.push('10', f(p.x), '20', f(p.y));
      break;
    }
    default: {
      const c = tp(item.start);
      const radius = toMm(Math.max(item.size.x, item.size.y)) / 2;
      r.push('0', 'CIRCLE', '8', layerName,
        '10', f(c.x), '20', f(c.y), '30', '0',
        '40', f(radius));
      break;
    }
  }
  return r;
}

function escDxf(s: string): string {
  return s.replace(/[\r\n]/g, ' ').trim();
}

export function downloadDXF(content: string, filename: string = 'gerbview-export.dxf') {
  const blob = new Blob([content], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
