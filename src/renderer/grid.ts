import { Viewport } from './viewport';
import { IU_PER_MM } from '../model/enums';

const GRID_SCALES = [
  IU_PER_MM * 0.001, IU_PER_MM * 0.005, IU_PER_MM * 0.01,
  IU_PER_MM * 0.025, IU_PER_MM * 0.05, IU_PER_MM * 0.1,
  IU_PER_MM * 0.25, IU_PER_MM * 0.5, IU_PER_MM * 1,
  IU_PER_MM * 2.54, IU_PER_MM * 5, IU_PER_MM * 10,
  IU_PER_MM * 25.4, IU_PER_MM * 50, IU_PER_MM * 100,
];

export type GridStyle = 'dots' | 'lines' | 'crosshairs';

export interface GridConfig {
  showOriginCrosshair: boolean;
  originColor: string;

  // 细网格
  fineStyle: GridStyle;
  fineColor: string;
  fineDenseColor: string;
  fineSpacing: number | null;   // null = auto

  // 粗网格
  showCoarse: boolean;
  coarseStyle: GridStyle;
  coarseColor: string;
  coarseSpacing: number | null; // null = fine * multiplier
  coarseMultiplier: number;
}

export const DEFAULT_GRID_CONFIG: GridConfig = {
  showOriginCrosshair: true,
  originColor: '#4a4a5a',

  fineStyle: 'dots',
  fineColor: '#3a3a4a',
  fineDenseColor: '#2a2a3a',
  fineSpacing: null,

  showCoarse: false,
  coarseStyle: 'lines',
  coarseColor: '#4a4a5a',
  coarseSpacing: null,
  coarseMultiplier: 5,
};

// 兼容旧字段
export function mergeGridConfig(partial: Partial<GridConfig> & Record<string, any>): Partial<GridConfig> {
  const result: any = { ...partial };
  // 旧字段映射
  if (partial.style && !partial.fineStyle) result.fineStyle = partial.style;
  if (partial.color && !partial.fineColor) result.fineColor = partial.color;
  if (partial.denseColor && !partial.fineDenseColor) result.fineDenseColor = partial.denseColor;
  if (partial.spacing !== undefined && partial.fineSpacing === undefined) result.fineSpacing = partial.spacing;
  return result;
}

function autoGridSpacing(viewport: Viewport, targetPx: number): number {
  const targetWorldSpacing = targetPx * viewport.scale;
  let s = GRID_SCALES[GRID_SCALES.length - 1];
  for (const g of GRID_SCALES) {
    if (g >= targetWorldSpacing) { s = g; break; }
  }
  return s;
}

export function drawGrid(ctx: CanvasRenderingContext2D, viewport: Viewport, config?: Partial<GridConfig>) {
  const cfg: GridConfig = { ...DEFAULT_GRID_CONFIG, ...mergeGridConfig(config || {}) };

  const fineSpacing = cfg.fineSpacing ?? autoGridSpacing(viewport, 60);

  const topLeft = viewport.screenToWorld({ x: 0, y: 0 });
  const bottomRight = viewport.screenToWorld({ x: viewport.canvasWidth, y: viewport.canvasHeight });
  const wMinX = Math.min(topLeft.x, bottomRight.x), wMaxX = Math.max(topLeft.x, bottomRight.x);
  const wMinY = Math.min(topLeft.y, bottomRight.y), wMaxY = Math.max(topLeft.y, bottomRight.y);

  // 粗网格（先画，在底层）
  if (cfg.showCoarse) {
    const coarseSpacing = cfg.coarseSpacing ?? fineSpacing * cfg.coarseMultiplier;
    const coarsePx = viewport.worldToScreenDist(coarseSpacing);
    if (coarsePx >= 15) {
      const csX = Math.floor(wMinX / coarseSpacing) * coarseSpacing;
      const ceX = Math.ceil(wMaxX / coarseSpacing) * coarseSpacing;
      const csY = Math.floor(wMinY / coarseSpacing) * coarseSpacing;
      const ceY = Math.ceil(wMaxY / coarseSpacing) * coarseSpacing;
      drawGridStyle(ctx, viewport, cfg.coarseStyle, cfg.coarseColor,
        coarseSpacing, csX, ceX, csY, ceY, coarsePx);
    }
  }

  // 细网格
  const finePx = viewport.worldToScreenDist(fineSpacing);
  const fsX = Math.floor(wMinX / fineSpacing) * fineSpacing;
  const feX = Math.ceil(wMaxX / fineSpacing) * fineSpacing;
  const fsY = Math.floor(wMinY / fineSpacing) * fineSpacing;
  const feY = Math.ceil(wMaxY / fineSpacing) * fineSpacing;

  const fineStyle = finePx < 8 ? 'lines' : cfg.fineStyle;
  const fineColor = finePx < 8 ? cfg.fineDenseColor : cfg.fineColor;
  drawGridStyle(ctx, viewport, fineStyle, fineColor, fineSpacing, fsX, feX, fsY, feY, finePx);

  // 原点十字线
  if (cfg.showOriginCrosshair) {
    const origin = viewport.worldToScreen({ x: 0, y: 0 });
    ctx.strokeStyle = cfg.originColor;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, viewport.canvasHeight);
    ctx.moveTo(0, origin.y); ctx.lineTo(viewport.canvasWidth, origin.y);
    ctx.stroke();
  }
}

function drawGridStyle(
  ctx: CanvasRenderingContext2D, viewport: Viewport,
  style: GridStyle, color: string,
  spacing: number, startX: number, endX: number, startY: number, endY: number,
  pixelSpacing: number
) {
  if (style === 'lines') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += spacing) {
      const sp = viewport.worldToScreen({ x, y: 0 });
      ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, viewport.canvasHeight);
    }
    for (let y = startY; y <= endY; y += spacing) {
      const sp = viewport.worldToScreen({ x: 0, y });
      ctx.moveTo(0, sp.y); ctx.lineTo(viewport.canvasWidth, sp.y);
    }
    ctx.stroke();
  } else if (style === 'crosshairs') {
    const arm = Math.min(5, pixelSpacing * 0.15);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += spacing) {
      for (let y = startY; y <= endY; y += spacing) {
        const sp = viewport.worldToScreen({ x, y });
        ctx.moveTo(sp.x - arm, sp.y); ctx.lineTo(sp.x + arm, sp.y);
        ctx.moveTo(sp.x, sp.y - arm); ctx.lineTo(sp.x, sp.y + arm);
      }
    }
    ctx.stroke();
  } else {
    const dotSize = pixelSpacing > 20 ? 1.5 : 1;
    ctx.fillStyle = color;
    for (let x = startX; x <= endX; x += spacing) {
      for (let y = startY; y <= endY; y += spacing) {
        const sp = viewport.worldToScreen({ x, y });
        ctx.fillRect(sp.x - dotSize / 2, sp.y - dotSize / 2, dotSize, dotSize);
      }
    }
  }
}
