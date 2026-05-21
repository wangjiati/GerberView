import { LayerManager, GerberImage } from '../model/gerber-image';
import { GerberItem, Point } from '../model/gerber-item';
import { ShapeType, IU_PER_MM, ApertureType, DrillShape } from '../model/enums';
import { transformPointWorld } from './transform';

export interface DfmReport {
  minWidth: number;
  minWidthItem: GerberItem | null;
  minWidthLayer: number;

  minSpacing: number;
  minSpacingItems: [GerberItem, GerberItem] | null;
  minSpacingLayers: [number, number];

  minDrillSize: number;
  minDrillItem: GerberItem | null;
  minDrillLayer: number;

  minAnnularRing: number;
  minAnnularItem: GerberItem | null;
  minAnnularLayer: number;

  totalItems: number;
  totalLayers: number;
}

const INCH_TO_NM = 2.54e7;

function toNm(val: number, unit: string): number {
  return unit === 'inch' ? val * INCH_TO_NM : val * IU_PER_MM;
}

export function runDfmAnalysis(layerManager: LayerManager): DfmReport {
  const report: DfmReport = {
    minWidth: Infinity,
    minWidthItem: null,
    minWidthLayer: -1,
    minSpacing: Infinity,
    minSpacingItems: null,
    minSpacingLayers: [-1, -1],
    minDrillSize: Infinity,
    minDrillItem: null,
    minDrillLayer: -1,
    minAnnularRing: Infinity,
    minAnnularItem: null,
    minAnnularLayer: -1,
    totalItems: 0,
    totalLayers: 0,
  };

  // 收集所有可见层的非清除极性 item
  const allItems: { item: GerberItem; layerIdx: number; layer: GerberImage }[] = [];
  for (let i = 0; i < layerManager.layers.length; i++) {
    const layer = layerManager.layers[i];
    if (!layer || !layer.visible) continue;
    report.totalLayers++;
    for (const item of layer.items) {
      if (item.layerPolarityClear) continue;
      report.totalItems++;
      allItems.push({ item, layerIdx: i, layer });
    }
  }

  // 1. 最小线宽
  for (const { item, layerIdx } of allItems) {
    if (item.flashed) continue;
    if (item.size.x > 0 && item.size.x < report.minWidth) {
      report.minWidth = item.size.x;
      report.minWidthItem = item;
      report.minWidthLayer = layerIdx;
    }
  }

  // 2. 最小孔径和最小环宽
  for (const { item, layerIdx, layer } of allItems) {
    if (!item.flashed || item.dCode <= 0) continue;
    const dc = layer.getDCcode(item.dCode);
    if (!dc) continue;

    if (dc.drillShape !== DrillShape.NoHole && dc.drill.x > 0) {
      const drillDiameter = Math.min(dc.drill.x, dc.drill.y || dc.drill.x);
      if (drillDiameter < report.minDrillSize) {
        report.minDrillSize = drillDiameter;
        report.minDrillItem = item;
        report.minDrillLayer = layerIdx;
      }

      // 环宽 = pad半径 - drill半径
      const padR = Math.min(dc.size.x, dc.size.y || dc.size.x) / 2;
      const drillR = drillDiameter / 2;
      const annular = padR - drillR;
      if (annular > 0 && annular < report.minAnnularRing) {
        report.minAnnularRing = annular;
        report.minAnnularItem = item;
        report.minAnnularLayer = layerIdx;
      }
    }
  }

  // 3. 最小线距（空间索引加速）
  computeMinSpacing(allItems, report);

  // 无结果时设置默认值
  if (report.minWidth === Infinity) report.minWidth = 0;
  if (report.minSpacing === Infinity) report.minSpacing = 0;
  if (report.minDrillSize === Infinity) report.minDrillSize = 0;
  if (report.minAnnularRing === Infinity) report.minAnnularRing = 0;

  return report;
}

// 使用网格分桶的空间索引来加速线距计算
function computeMinSpacing(
  items: { item: GerberItem; layerIdx: number; layer: GerberImage }[],
  report: DfmReport,
) {
  if (items.length < 2 || items.length > 100000) return;

  // 计算全局 bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bboxes: { min: Point; max: Point }[] = [];
  for (const { item, layer } of items) {
    const bb = itemBBox(item, layer);
    bboxes.push(bb);
    if (bb.min.x < minX) minX = bb.min.x;
    if (bb.min.y < minY) minY = bb.min.y;
    if (bb.max.x > maxX) maxX = bb.max.x;
    if (bb.max.y > maxY) maxY = bb.max.y;
  }

  // 采样策略：当 item 太多时，只检查前 5000 个
  const maxCheck = Math.min(items.length, 5000);

  // 使用简单的 N^2 比较，但用 bounding box 预筛选
  for (let i = 0; i < maxCheck; i++) {
    for (let j = i + 1; j < maxCheck; j++) {
      const a = bboxes[i], b = bboxes[j];
      // 快速排除
      const gap = report.minSpacing;
      if (a.max.x + gap < b.min.x || b.max.x + gap < a.min.x) continue;
      if (a.max.y + gap < b.min.y || b.max.y + gap < a.min.y) continue;

      // 详细距离计算（使用中心距离 - 尺寸/2 的近似）
      const dist = approxItemDistance(items[i].item, items[j].item, items[i].layer, items[j].layer);
      if (dist > 0 && dist < report.minSpacing) {
        report.minSpacing = dist;
        report.minSpacingItems = [items[i].item, items[j].item];
        report.minSpacingLayers = [items[i].layerIdx, items[j].layerIdx];
      }
    }
  }
}

function itemBBox(item: GerberItem, layer: GerberImage): { min: Point; max: Point } {
  let minP: Point, maxP: Point;
  if (item.polygonPoints.length > 0) {
    const pts = item.polygonPoints.map(p => transformPointWorld(item, layer, p));
    minP = { x: Math.min(...pts.map(p => p.x)), y: Math.min(...pts.map(p => p.y)) };
    maxP = { x: Math.max(...pts.map(p => p.x)), y: Math.max(...pts.map(p => p.y)) };
  } else {
    const s = transformPointWorld(item, layer, item.start);
    const e = transformPointWorld(item, layer, item.end);
    const hw = item.size.x / 2;
    minP = { x: Math.min(s.x, e.x) - hw, y: Math.min(s.y, e.y) - hw };
    maxP = { x: Math.max(s.x, e.x) + hw, y: Math.max(s.y, e.y) + hw };
  }
  return { min: minP, max: maxP };
}

function approxItemDistance(a: GerberItem, b: GerberItem, la: GerberImage, lb: GerberImage): number {
  const as = transformPointWorld(a, la, a.start);
  const ae = transformPointWorld(a, la, a.end);
  const bs = transformPointWorld(b, lb, b.start);
  const be = transformPointWorld(b, lb, b.end);

  // 使用端点到端点的最小距离减去线宽
  const d1 = ptDist(as, bs);
  const d2 = ptDist(as, be);
  const d3 = ptDist(ae, bs);
  const d4 = ptDist(ae, be);
  const minCenterDist = Math.min(d1, d2, d3, d4);
  const halfWidth = (a.size.x + b.size.x) / 2;
  return minCenterDist - halfWidth;
}

function ptDist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function formatDfmValue(nm: number, unit: 'mm' | 'inch' | 'mil'): string {
  if (nm === 0) return '-';
  if (unit === 'mm') {
    const mm = nm / IU_PER_MM;
    return mm >= 1 ? mm.toFixed(3) + ' mm' : (mm * 1000).toFixed(2) + ' µm';
  }
  if (unit === 'inch') return (nm / INCH_TO_NM).toFixed(5) + ' in';
  return (nm / (INCH_TO_NM / 1000)).toFixed(2) + ' mil';
}
