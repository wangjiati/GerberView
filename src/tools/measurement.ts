import { Point } from '../model/gerber-item';
import { IU_PER_MM } from '../model/enums';
import { Viewport } from '../renderer/viewport';
import { HitResult } from './hit-test';

export enum MeasureMode {
  PointToPoint = 'p2p',
  Angle = 'angle',
  Radius = 'radius',
  Area = 'area',
}

export interface Measurement {
  mode: MeasureMode;
  points: Point[];
  result: string;
  resultValue: number;
}

export class MeasurementManager {
  measurements: Measurement[] = [];

  add(m: Measurement) {
    this.measurements.push(m);
  }

  removeLast() {
    this.measurements.pop();
  }

  clearAll() {
    this.measurements = [];
  }
}

export function formatNm(val: number, unit: 'mm' | 'inch' | 'mil'): string {
  if (unit === 'mm') return (val / IU_PER_MM).toFixed(4) + ' mm';
  if (unit === 'inch') return (val / (IU_PER_MM * 25.4)).toFixed(5) + ' in';
  return (val / (IU_PER_MM * 0.0254)).toFixed(2) + ' mil';
}

export function computeDistance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function computeAngleDeg(a: Point, vertex: Point, b: Point): number {
  const v1x = a.x - vertex.x, v1y = a.y - vertex.y;
  const v2x = b.x - vertex.x, v2y = b.y - vertex.y;
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;
  return Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
}

// 计算多边形面积（Shoelace 公式），返回 nm^2
export function computePolygonArea(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(area) / 2;
}

// 渲染所有持久化测量 + 当前进行中的测量
export function renderMeasurements(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  mgr: MeasurementManager,
  unit: 'mm' | 'inch' | 'mil',
  activeMode: MeasureMode,
  inProgressPoints: Point[],
  cursorWorld: Point | null,
): void {
  // 持久化测量
  for (const m of mgr.measurements) {
    renderMeasurement(ctx, viewport, m, unit, 0.6);
  }

  // 进行中的测量
  if (inProgressPoints.length > 0) {
    const pts = [...inProgressPoints];
    if (cursorWorld) pts.push(cursorWorld);
    if (pts.length >= 2) {
      renderInProgress(ctx, viewport, pts, activeMode, unit);
    }
  }
}

function renderMeasurement(ctx: CanvasRenderingContext2D, viewport: Viewport, m: Measurement, unit: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;

  if (m.mode === MeasureMode.PointToPoint) {
    const s = viewport.worldToScreen(m.points[0]);
    const e = viewport.worldToScreen(m.points[m.points.length - 1]);
    // 连线
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    // X/Y 分量
    ctx.strokeStyle = '#ffffff60';
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    // 端点圆
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fill();
    // 标签
    drawMeasureLabel(ctx, e.x + 8, e.y - 8, m.result);
  } else if (m.mode === MeasureMode.Angle) {
    const pts = m.points.map(p => viewport.worldToScreen(p));
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawMeasureLabel(ctx, pts[1].x + 8, pts[1].y - 8, m.result);
  } else if (m.mode === MeasureMode.Radius) {
    const c = viewport.worldToScreen(m.points[0]);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    drawMeasureLabel(ctx, c.x + 12, c.y - 8, m.result);
  } else if (m.mode === MeasureMode.Area) {
    if (m.points.length >= 3) {
      const pts = m.points.map(p => viewport.worldToScreen(p));
      ctx.strokeStyle = '#ff66aa';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      // 半透明填充
      ctx.fillStyle = '#ff66aa20';
      ctx.fill();
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      drawMeasureLabel(ctx, cx + 8, cy - 8, m.result);
    }
  }

  ctx.restore();
}

function renderInProgress(ctx: CanvasRenderingContext2D, viewport: Viewport, pts: Point[], mode: MeasureMode, unit: string) {
  ctx.save();
  const screenPts = pts.map(p => viewport.worldToScreen(p));

  if (mode === MeasureMode.PointToPoint) {
    const s = screenPts[0], e = screenPts[screenPts.length - 1];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    // X/Y 分量
    ctx.strokeStyle = '#ffffff60';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fill();

    const dist = computeDistance(pts[0], pts[pts.length - 1]);
    const dx = Math.abs(pts[pts.length - 1].x - pts[0].x);
    const dy = Math.abs(pts[pts.length - 1].y - pts[0].y);
    const angle = Math.atan2(pts[pts.length - 1].y - pts[0].y, pts[pts.length - 1].x - pts[0].x) * 180 / Math.PI;
    const label = `距离: ${formatNm(dist, unit as any)}\nΔX: ${formatNm(dx, unit as any)} ΔY: ${formatNm(dy, unit as any)}\n角度: ${angle.toFixed(1)}°`;
    drawMeasureLabel(ctx, e.x + 8, e.y - 8, label);
  } else if (mode === MeasureMode.Angle && pts.length >= 2) {
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    ctx.stroke();
    if (pts.length === 3) {
      const angle = computeAngleDeg(pts[0], pts[1], pts[2]);
      drawMeasureLabel(ctx, screenPts[1].x + 8, screenPts[1].y - 8, `角度: ${angle.toFixed(1)}°`);
    }
  } else if (mode === MeasureMode.Area && pts.length >= 2) {
    ctx.strokeStyle = '#ff66aa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
    // 闭合到第一个点
    ctx.lineTo(screenPts[0].x, screenPts[0].y);
    ctx.stroke();
    if (pts.length >= 3) {
      const area = computePolygonArea(pts);
      const areaMm2 = area / (IU_PER_MM * IU_PER_MM);
      drawMeasureLabel(ctx, screenPts[screenPts.length - 1].x + 8, screenPts[screenPts.length - 1].y - 8, `面积: ${areaMm2.toFixed(4)} mm²`);
    }
  }

  ctx.restore();
}

function drawMeasureLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  const lines = text.split('\n');
  ctx.font = '11px monospace';
  const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
  const h = lines.length * 15 + 6;
  ctx.fillStyle = '#000000cc';
  ctx.fillRect(x, y - h + 4, maxWidth + 12, h);
  ctx.fillStyle = '#00ff00';
  lines.forEach((line, i) => {
    ctx.fillText(line, x + 6, y - h + 16 + i * 15);
  });
}
