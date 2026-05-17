import { Point, GerberItem } from '../model/gerber-item';
import { GerberImage, LayerManager } from '../model/gerber-image';
import { Viewport } from '../renderer/viewport';
import { ShapeType, Interpolation } from '../model/enums';
import { transformPointWorld } from './transform';

export interface HitResult {
  layerIndex: number;
  itemIndex: number;
  item: GerberItem;
  layer: GerberImage;
}

const HIT_THRESHOLD_PX = 8;

export function hitTest(
  screenPos: Point,
  layerManager: LayerManager,
  viewport: Viewport,
): HitResult | null {
  let best: HitResult | null = null;
  let bestDist = HIT_THRESHOLD_PX;

  for (let li = 0; li < layerManager.layers.length; li++) {
    const layer = layerManager.layers[li];
    if (!layer || !layer.visible) continue;

    for (let ii = 0; ii < layer.items.length; ii++) {
      const item = layer.items[ii];
      const d = hitDistance(screenPos, item, layer, viewport);
      if (d >= 0 && d < bestDist) {
        bestDist = d;
        best = { layerIndex: li, itemIndex: ii, item, layer };
      }
    }
  }
  return best;
}

function hitDistance(
  screenPos: Point,
  item: GerberItem,
  layer: GerberImage,
  viewport: Viewport,
): number {
  const tp = (p: Point) => viewport.worldToScreen(transformPointWorld(item, layer, p));

  switch (item.shapeType) {
    case ShapeType.Segment: {
      const s = tp(item.start);
      const e = tp(item.end);
      const lineW = viewport.worldToScreenDist(item.size.x);
      return distToSegment(screenPos, s, e, lineW / 2);
    }
    case ShapeType.Arc: {
      const center = tp(item.arcCenter);
      const s = tp(item.start);
      const r = Math.sqrt((s.x - center.x) ** 2 + (s.y - center.y) ** 2);
      const lineW = viewport.worldToScreenDist(item.size.x);
      const dc = Math.sqrt((screenPos.x - center.x) ** 2 + (screenPos.y - center.y) ** 2);
      const radialDist = Math.abs(dc - r);
      if (radialDist > lineW / 2 + HIT_THRESHOLD_PX) return -1;
      // 检查角度范围
      const startAngle = Math.atan2(s.y - center.y, s.x - center.x);
      const e = tp(item.end);
      const endAngle = Math.atan2(e.y - center.y, e.x - center.x);
      const clickAngle = Math.atan2(screenPos.y - center.y, screenPos.x - center.x);
      if (isAngleInArc(clickAngle, startAngle, endAngle, item.interpolation === Interpolation.ArcCCW)) {
        return radialDist;
      }
      return -1;
    }
    case ShapeType.Circle: {
      const c = tp(item.start);
      const r = viewport.worldToScreenDist(item.size.x) / 2;
      const dc = Math.sqrt((screenPos.x - c.x) ** 2 + (screenPos.y - c.y) ** 2);
      return dc <= r + HIT_THRESHOLD_PX ? Math.max(0, dc - r) : -1;
    }
    case ShapeType.Polygon: {
      if (item.polygonPoints.length < 3) return -1;
      const screenPts = item.polygonPoints.map(tp);
      if (pointInPolygon(screenPos, screenPts)) return 0;
      // 检查边界距离
      let minD = Infinity;
      for (let i = 0; i < screenPts.length; i++) {
        const j = (i + 1) % screenPts.length;
        const d = distToSegmentSimple(screenPos, screenPts[i], screenPts[j]);
        if (d < minD) minD = d;
      }
      return minD <= HIT_THRESHOLD_PX ? minD : -1;
    }
    case ShapeType.SpotCircle: {
      const c = tp(item.start);
      const r = viewport.worldToScreenDist(item.size.x) / 2;
      const dc = Math.sqrt((screenPos.x - c.x) ** 2 + (screenPos.y - c.y) ** 2);
      return dc <= r + HIT_THRESHOLD_PX ? Math.max(0, dc - r) : -1;
    }
    case ShapeType.SpotRect: {
      const c = tp(item.start);
      const hw = viewport.worldToScreenDist(item.size.x) / 2;
      const hh = viewport.worldToScreenDist(item.size.y) / 2;
      const dx = Math.abs(screenPos.x - c.x);
      const dy = Math.abs(screenPos.y - c.y);
      if (dx <= hw + HIT_THRESHOLD_PX && dy <= hh + HIT_THRESHOLD_PX) {
        return Math.max(0, Math.max(dx - hw, dy - hh));
      }
      return -1;
    }
    case ShapeType.SpotOval: {
      const c = tp(item.start);
      const w = viewport.worldToScreenDist(item.size.x);
      const h = viewport.worldToScreenDist(item.size.y);
      const r = Math.min(w, h) / 2;
      const hw = w / 2, hh = h / 2;
      // 胶囊形：矩形 + 两端半圆
      if (w >= h) {
        const dx = Math.abs(screenPos.x - c.x);
        const dy = Math.abs(screenPos.y - c.y);
        if (dx <= hw - r) return dy <= r + HIT_THRESHOLD_PX ? Math.max(0, dy - r) : -1;
        const cx2 = c.x + Math.sign(screenPos.x - c.x) * (hw - r);
        const dc = Math.sqrt((screenPos.x - cx2) ** 2 + (screenPos.y - c.y) ** 2);
        return dc <= r + HIT_THRESHOLD_PX ? Math.max(0, dc - r) : -1;
      } else {
        const dx = Math.abs(screenPos.x - c.x);
        const dy = Math.abs(screenPos.y - c.y);
        if (dy <= hh - r) return dx <= r + HIT_THRESHOLD_PX ? Math.max(0, dx - r) : -1;
        const cy2 = c.y + Math.sign(screenPos.y - c.y) * (hh - r);
        const dc = Math.sqrt((screenPos.x - c.x) ** 2 + (screenPos.y - cy2) ** 2);
        return dc <= r + HIT_THRESHOLD_PX ? Math.max(0, dc - r) : -1;
      }
    }
    default: {
      // SpotPoly, SpotMacro: 使用包围盒
      const c = tp(item.start);
      const maxR = viewport.worldToScreenDist(Math.max(item.size.x, item.size.y)) / 2;
      const dc = Math.sqrt((screenPos.x - c.x) ** 2 + (screenPos.y - c.y) ** 2);
      return dc <= maxR + HIT_THRESHOLD_PX ? dc : -1;
    }
  }
}

function distToSegment(p: Point, a: Point, b: Point, halfWidth: number): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2) - halfWidth;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  const dist = Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
  return dist <= halfWidth + HIT_THRESHOLD_PX ? Math.max(0, dist - halfWidth) : -1;
}

function distToSegmentSimple(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

function pointInPolygon(p: Point, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function isAngleInArc(angle: number, start: number, end: number, ccw: boolean): boolean {
  const TWO_PI = Math.PI * 2;
  const norm = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const a = norm(angle), s = norm(start), e = norm(end);
  if (ccw) {
    // CCW: s → e in increasing direction
    if (s <= e) return a >= s && a <= e;
    return a >= s || a <= e;
  } else {
    // CW: s → e in decreasing direction
    if (s >= e) return a <= s && a >= e;
    return a <= s || a >= e;
  }
}
