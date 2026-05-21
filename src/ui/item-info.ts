import { HitResult } from '../tools/hit-test';
import { IU_PER_MM } from '../model/enums';
import { ShapeType, Interpolation, ApertureType } from '../model/enums';
import { GerberImage } from '../model/gerber-image';
import { Point } from '../model/gerber-item';

const SHAPE_NAMES: Record<string, string> = {
  [ShapeType.Segment]: '线段',
  [ShapeType.Arc]: '圆弧',
  [ShapeType.Circle]: '圆形',
  [ShapeType.Polygon]: '多边形',
  [ShapeType.SpotCircle]: '圆形焊盘',
  [ShapeType.SpotRect]: '矩形焊盘',
  [ShapeType.SpotOval]: '椭圆焊盘',
  [ShapeType.SpotPoly]: '多边形焊盘',
  [ShapeType.SpotMacro]: '宏焊盘',
};

const INTERP_NAMES: Record<number, string> = {
  [Interpolation.Linear]: '线性',
  [Interpolation.ArcCW]: '顺时针弧',
  [Interpolation.ArcCCW]: '逆时针弧',
};

export function formatNm(val: number, unit: 'mm' | 'inch' | 'mil'): string {
  if (unit === 'mm') return (val / IU_PER_MM).toFixed(4) + ' mm';
  if (unit === 'inch') return (val / (IU_PER_MM * 25.4)).toFixed(5) + ' in';
  return (val / (IU_PER_MM * 0.0254)).toFixed(2) + ' mil';
}

export function createItemTooltip(hit: HitResult, unit: 'mm' | 'inch' | 'mil'): HTMLDivElement {
  const { item, layer } = hit;
  const el = document.createElement('div');
  el.className = 'item-tooltip';

  const shape = SHAPE_NAMES[item.shapeType] || `未知(${item.shapeType})`;
  let html = `<div class="itt-header">${shape}</div>`;
  html += `<div class="itt-row"><span>图层</span><span>${layer.layerName || layer.fileName || '#' + hit.layerIndex}</span></div>`;
  if (item.dCode > 0) html += `<div class="itt-row"><span>D 代码</span><span>D${item.dCode}</span></div>`;
  html += `<div class="itt-row"><span>起点</span><span>${formatNm(item.start.x, unit)}, ${formatNm(item.start.y, unit)}</span></div>`;

  if (item.shapeType !== ShapeType.Circle && !item.flashed) {
    html += `<div class="itt-row"><span>终点</span><span>${formatNm(item.end.x, unit)}, ${formatNm(item.end.y, unit)}</span></div>`;
  }
  if (item.size.x > 0) {
    const label = item.flashed ? '尺寸' : '线宽';
    html += `<div class="itt-row"><span>${label}</span><span>${formatNm(item.size.x, unit)}</span></div>`;
  }
  if (item.netName) html += `<div class="itt-row"><span>网络</span><span>${item.netName}</span></div>`;
  if (item.componentRef) html += `<div class="itt-row"><span>元件</span><span>${item.componentRef}</span></div>`;
  if (item.aperFunction) html += `<div class="itt-row"><span>功能</span><span>${item.aperFunction}</span></div>`;

  el.innerHTML = html;
  return el;
}

export function createItemDetailDialog(hit: HitResult, unit: 'mm' | 'inch' | 'mil'): HTMLDivElement {
  const { item, layer } = hit;
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dialog item-detail-dialog';

  const shape = SHAPE_NAMES[item.shapeType] || `未知(${item.shapeType})`;
  let html = `<div class="dialog-title">元素详情 — ${shape}</div><div class="dialog-body">`;

  // 基本信息
  html += '<table class="item-detail-table">';
  html += row('图层', `${layer.layerName || layer.fileName || '#' + hit.layerIndex}`);
  html += row('形状类型', shape);
  if (item.dCode > 0) {
    html += row('D 代码', `D${item.dCode}`);
    const dc = layer.getDCcode(item.dCode);
    if (dc) {
      html += row('光圈类型', apertureTypeName(dc.apertureType));
      html += row('光圈尺寸', `${formatNm(dc.size.x, unit)} × ${formatNm(dc.size.y, unit)}`);
      if (dc.rotation !== 0) html += row('光圈旋转', `${dc.rotation}°`);
    }
  }
  html += row('插补模式', INTERP_NAMES[item.interpolation] || '-');
  html += row('闪光', item.flashed ? '是' : '否');
  html += row('清除极性', item.layerPolarityClear ? '是' : '否');
  html += '</table>';

  // 坐标
  html += '<div class="dialog-section-title">坐标</div><table class="item-detail-table">';
  html += row('起点 X', formatNm(item.start.x, unit));
  html += row('起点 Y', formatNm(item.start.y, unit));
  if (!item.flashed) {
    html += row('终点 X', formatNm(item.end.x, unit));
    html += row('终点 Y', formatNm(item.end.y, unit));
  }
  if (item.shapeType === ShapeType.Arc || item.shapeType === ShapeType.Circle) {
    html += row('圆心 X', formatNm(item.arcCenter.x, unit));
    html += row('圆心 Y', formatNm(item.arcCenter.y, unit));
    const dx = item.start.x - item.arcCenter.x;
    const dy = item.start.y - item.arcCenter.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    html += row('半径', formatNm(r, unit));
    html += row('直径', formatNm(r * 2, unit));
  }
  if (item.size.x > 0) {
    html += row('线宽/尺寸', formatNm(item.size.x, unit));
  }
  if (item.size.y > 0 && item.size.y !== item.size.x) {
    html += row('高度', formatNm(item.size.y, unit));
  }
  html += '</table>';

  // 面积计算
  const areaNm2 = computeItemArea(item);
  if (areaNm2 > 0) {
    const areaMm2 = areaNm2 / (IU_PER_MM * IU_PER_MM);
    html += '<div class="dialog-section-title">面积</div><table class="item-detail-table">';
    html += row('面积', areaMm2 >= 1 ? `${areaMm2.toFixed(4)} mm²` : `${(areaMm2 * 1e6).toFixed(2)} µm²`);
    html += '</table>';
  }

  // X2 属性
  if (item.netName || item.componentRef || item.aperFunction) {
    html += '<div class="dialog-section-title">X2 属性</div><table class="item-detail-table">';
    if (item.netName) html += row('网络名', item.netName);
    if (item.componentRef) html += row('元件参考', item.componentRef);
    if (item.aperFunction) html += row('光圈功能', item.aperFunction);
    html += '</table>';
  }

  html += '</div>';
  html += '<div class="dialog-buttons"><button class="dialog-btn dialog-btn-primary" id="item-detail-close">关闭</button></div>';
  dialog.innerHTML = html;
  overlay.appendChild(dialog);
  overlay.querySelector('#item-detail-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}

function row(label: string, value: string): string {
  return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

function apertureTypeName(type: ApertureType): string {
  switch (type) {
    case ApertureType.Circle: return '圆形';
    case ApertureType.Rect: return '矩形';
    case ApertureType.Oval: return '椭圆';
    case ApertureType.Polygon: return '多边形';
    case ApertureType.Macro: return '宏';
    default: return '未知';
  }
}

function computeItemArea(item: any): number {
  const s = item as { shapeType: ShapeType; size: Point; start: Point; end: Point; arcCenter: Point; polygonPoints: Point[]; interpolation: Interpolation };
  switch (s.shapeType) {
    case ShapeType.Circle:
    case ShapeType.SpotCircle: {
      const r = s.size.x / 2;
      return Math.PI * r * r;
    }
    case ShapeType.SpotRect: {
      return s.size.x * s.size.y;
    }
    case ShapeType.SpotOval: {
      const w = s.size.x, h = s.size.y;
      const r = Math.min(w, h) / 2;
      // 矩形 + 两端半圆
      if (w >= h) return (w - 2 * r) * h + Math.PI * r * r;
      return w * (h - 2 * r) + Math.PI * r * r;
    }
    case ShapeType.Polygon: {
      return shoelaceArea(s.polygonPoints);
    }
    case ShapeType.Segment: {
      // 线段面积 = 线宽 × 长度
      const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      return s.size.x * len;
    }
    case ShapeType.Arc: {
      // 弧形面积 ≈ 线宽 × 弧长
      const dx = s.start.x - s.arcCenter.x, dy = s.start.y - s.arcCenter.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      const dx2 = s.end.x - s.arcCenter.x, dy2 = s.end.y - s.arcCenter.y;
      const startAngle = Math.atan2(dy, dx);
      const endAngle = Math.atan2(dy2, dx2);
      let sweep = endAngle - startAngle;
      if (s.interpolation === Interpolation.ArcCCW) {
        if (sweep < 0) sweep += Math.PI * 2;
      } else {
        if (sweep > 0) sweep -= Math.PI * 2;
      }
      const arcLen = Math.abs(sweep) * r;
      return s.size.x * arcLen;
    }
    default:
      return 0;
  }
}

function shoelaceArea(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(area) / 2;
}
