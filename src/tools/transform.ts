import { Point } from '../model/gerber-item';
import { GerberImage } from '../model/gerber-image';

/**
 * 对一个世界坐标点应用 item + layer 级别的所有变换（不含 viewport 投影）。
 * 变换顺序与 renderer.ts renderItemShape 中的闭包一致：
 *   layerOffset → drawScale → mirrorA/B → layerRotation → swapAxis → imageOffset → imageRotation
 */
export function transformPointWorld(item: {
  layerOffset: Point;
  drawScale: Point;
  mirrorA: boolean;
  mirrorB: boolean;
  layerRotation: number;
  swapAxis: boolean;
}, layer: GerberImage, p: Point): Point {
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
  if (item.swapAxis) { const t = x; x = y; y = t; }
  x += layer.imageOffset.x; y += layer.imageOffset.y;
  if (layer.imageRotation !== 0) {
    const rad = layer.imageRotation * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const nx = x * c - y * s, ny = x * s + y * c;
    x = nx; y = ny;
  }
  return { x, y };
}
