import { LayerManager, GerberImage } from '../model/gerber-image';
import { GerberItem, Point } from '../model/gerber-item';
import { ShapeType, Interpolation, IU_PER_MM } from '../model/enums';
import { transformPointWorld } from './transform';

export function exportToSVG(layerManager: LayerManager, backgroundColor: string, selectedLayers?: number[]): string {
  const bb = layerManager.computeTotalBoundingBox();
  if (!bb) return '';

  const pad = IU_PER_MM * 2; // 2mm padding
  const minX = (bb.min.x - pad) / IU_PER_MM;
  const minY = -(bb.max.y + pad) / IU_PER_MM; // SVG Y is flipped
  const maxX = (bb.max.x + pad) / IU_PER_MM;
  const maxY = -(bb.min.y - pad) / IU_PER_MM;
  const w = maxX - minX;
  const h = maxY - minY;

  const layerSet = selectedLayers ? new Set(selectedLayers) : null;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">\n`;
  svg += `  <rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="${backgroundColor}"/>\n`;

  for (let i = 0; i < layerManager.layers.length; i++) {
    const layer = layerManager.layers[i];
    if (!layer || !layer.visible) continue;
    if (layerSet && !layerSet.has(i)) continue;
    svg += `  <g id="layer-${i}" inkscape:label="${esc(layer.layerName || layer.fileName)}">\n`;
    for (const item of layer.items) {
      svg += itemToSVG(item, layer);
    }
    svg += `  </g>\n`;
  }

  svg += `</svg>`;
  return svg;
}

function itemToSVG(item: GerberItem, layer: GerberImage): string {
  const tp = (p: Point): Point => {
    const w = transformPointWorld(item, layer, p);
    return { x: w.x / IU_PER_MM, y: -w.y / IU_PER_MM }; // nm→mm, flip Y
  };
  const color = layer.color;
  const isClear = layer.layerPolarityClear !== item.layerPolarityClear;

  switch (item.shapeType) {
    case ShapeType.Segment: {
      const s = tp(item.start), e = tp(item.end);
      const lw = item.size.x / IU_PER_MM;
      return `    <line x1="${f(s.x)}" y1="${f(s.y)}" x2="${f(e.x)}" y2="${f(e.y)}" stroke="${color}" stroke-width="${f(lw)}" stroke-linecap="round" fill="none"/>\n`;
    }
    case ShapeType.Arc: {
      const center = tp(item.arcCenter);
      const s = tp(item.start);
      const r = Math.sqrt((s.x - center.x) ** 2 + (s.y - center.y) ** 2);
      const lw = item.size.x / IU_PER_MM;
      const e = tp(item.end);
      const largeArc = isArcLargeArc(item) ? 1 : 0;
      const sweep = item.interpolation === Interpolation.ArcCW ? 0 : 1;
      return `    <path d="M${f(s.x)} ${f(s.y)} A${f(r)} ${f(r)} 0 ${largeArc} ${sweep} ${f(e.x)} ${f(e.y)}" stroke="${color}" stroke-width="${f(lw)}" stroke-linecap="round" fill="none"/>\n`;
    }
    case ShapeType.Circle: {
      const c = tp(item.start);
      const r = item.size.x / IU_PER_MM / 2;
      return `    <circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${color}"/>\n`;
    }
    case ShapeType.Polygon: {
      if (item.polygonPoints.length < 3) return '';
      const pts = item.polygonPoints.map(p => tp(p));
      const ptsStr = pts.map(p => `${f(p.x)},${f(p.y)}`).join(' ');
      return `    <polygon points="${ptsStr}" fill="${color}"/>\n`;
    }
    case ShapeType.SpotCircle: {
      const c = tp(item.start);
      const r = item.size.x / IU_PER_MM / 2;
      return `    <circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${color}"/>\n`;
    }
    case ShapeType.SpotRect: {
      const c = tp(item.start);
      const hw = item.size.x / IU_PER_MM / 2;
      const hh = item.size.y / IU_PER_MM / 2;
      return `    <rect x="${f(c.x - hw)}" y="${f(c.y - hh)}" width="${f(hw * 2)}" height="${f(hh * 2)}" fill="${color}"/>\n`;
    }
    case ShapeType.SpotOval: {
      const c = tp(item.start);
      const w = item.size.x / IU_PER_MM;
      const h = item.size.y / IU_PER_MM;
      const r = Math.min(w, h) / 2;
      if (w >= h) {
        const rx = w / 2 - r;
        return `    <rect x="${f(c.x - w / 2)}" y="${f(c.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ry="${f(r)}" fill="${color}"/>\n`;
      }
      return `    <rect x="${f(c.x - w / 2)}" y="${f(c.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ry="${f(r)}" fill="${color}"/>\n`;
    }
    case ShapeType.SpotPoly:
    case ShapeType.SpotMacro: {
      // 使用包围盒近似
      const c = tp(item.start);
      const hw = item.size.x / IU_PER_MM / 2;
      return `    <circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(hw)}" fill="${color}"/>\n`;
    }
    default:
      return '';
  }
}

function isArcLargeArc(item: GerberItem): boolean {
  const cx = item.arcCenter.x, cy = item.arcCenter.y;
  const dx1 = item.start.x - cx, dy1 = item.start.y - cy;
  const dx2 = item.end.x - cx, dy2 = item.end.y - cy;
  const cross = dx1 * dy2 - dy1 * dx2;
  const dot = dx1 * dx2 + dy1 * dy2;
  const angle = Math.atan2(cross, dot);
  if (item.interpolation === Interpolation.ArcCCW) {
    return angle < 0;
  }
  return angle > 0;
}

function f(v: number): string {
  return v.toFixed(4);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadSVG(svgContent: string, filename: string = 'gerbview-export.svg') {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
