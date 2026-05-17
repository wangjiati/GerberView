import { LayerManager, GerberImage } from '../model/gerber-image';
import { GerberItem, Point } from '../model/gerber-item';
import { ShapeType, Interpolation, IU_PER_MM } from '../model/enums';
import { transformPointWorld } from './transform';

function toMm(nm: number): number {
  return nm / IU_PER_MM;
}

function f(v: number): string {
  return v.toFixed(6);
}

export function exportToDXF(layerManager: LayerManager): string {
  const lines: string[] = [];

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
  let layerCount = 0;
  for (let i = 0; i < layerManager.layers.length; i++) {
    if (layerManager.layers[i]?.visible) layerCount++;
  }
  lines.push('0', 'TABLE', '2', 'LAYER', '70', String(layerCount));
  for (let i = 0; i < layerManager.layers.length; i++) {
    const layer = layerManager.layers[i];
    if (!layer?.visible) continue;
    const name = escDxf(layer.layerName || layer.fileName || `Layer${i}`);
    lines.push('0', 'LAYER', '2', name, '70', '0', '62', '7', '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB');
  lines.push('0', 'ENDSEC');

  // ENTITIES
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (let i = 0; i < layerManager.layers.length; i++) {
    const layer = layerManager.layers[i];
    if (!layer?.visible) continue;
    const layerName = escDxf(layer.layerName || layer.fileName || `Layer${i}`);
    for (const item of layer.items) {
      const dxf = itemToDXF(item, layer, layerName);
      lines.push(...dxf);
    }
  }
  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');

  return lines.join('\n');
}

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
      const startAngle = Math.atan2(s.y - center.y, s.x - center.x) * 180 / Math.PI;
      const e = tp(item.end);
      const endAngle = Math.atan2(e.y - center.y, e.x - center.x) * 180 / Math.PI;
      // DXF ARC: always CCW from start to end
      let sa = startAngle, ea = endAngle;
      if (item.interpolation === Interpolation.ArcCW) {
        // CW in Gerber → swap angles for DXF CCW convention
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
      for (const p of pts) {
        r.push('10', f(p.x), '20', f(p.y));
      }
      break;
    }
    case ShapeType.SpotOval: {
      // 近似为多边形（胶囊形）
      const c = tp(item.start);
      const w = toMm(item.size.x) / 2;
      const h = toMm(item.size.y) / 2;
      const r2 = Math.min(w, h);
      const pts: Point[] = [];
      const segments = 16;
      if (w >= h) {
        // 水平胶囊
        for (let i = 0; i <= segments; i++) {
          const a = -Math.PI / 2 + Math.PI * i / segments;
          pts.push({ x: c.x + w - r2 + r2 * Math.cos(a), y: c.y + r2 * Math.sin(a) });
        }
        for (let i = 0; i <= segments; i++) {
          const a = Math.PI / 2 + Math.PI * i / segments;
          pts.push({ x: c.x - w + r2 + r2 * Math.cos(a), y: c.y + r2 * Math.sin(a) });
        }
      } else {
        for (let i = 0; i <= segments; i++) {
          const a = -Math.PI + Math.PI * i / segments;
          pts.push({ x: c.x + r2 * Math.cos(a), y: c.y + h - r2 + r2 * Math.sin(a) });
        }
        for (let i = 0; i <= segments; i++) {
          const a = Math.PI * i / segments;
          pts.push({ x: c.x + r2 * Math.cos(a), y: c.y - h + r2 + r2 * Math.sin(a) });
        }
      }
      r.push('0', 'LWPOLYLINE', '8', layerName, '70', '1', '90', String(pts.length));
      for (const p of pts) {
        r.push('10', f(p.x), '20', f(p.y));
      }
      break;
    }
    default: {
      // SpotPoly, SpotMacro: 使用圆形近似
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
  return s.replace(/[^a-zA-Z0-9_.\-]/g, '_').substring(0, 31);
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
