import { Point, pt } from '../model/gerber-item';
import { IU_PER_MM } from '../model/enums';

export class Viewport {
  center: Point = pt(0, 0);
  scale: number = IU_PER_MM * 0.1; // nm/px
  canvasWidth: number = 800;
  canvasHeight: number = 600;
  dpr: number = 1; // devicePixelRatio

  worldToScreen(world: Point): Point {
    const sx = (world.x - this.center.x) / this.scale + this.canvasWidth / 2;
    const sy = -(world.y - this.center.y) / this.scale + this.canvasHeight / 2;
    return pt(sx, sy);
  }

  screenToWorld(screen: Point): Point {
    const wx = (screen.x - this.canvasWidth / 2) * this.scale + this.center.x;
    const wy = -(screen.y - this.canvasHeight / 2) * this.scale + this.center.y;
    return pt(wx, wy);
  }

  worldToScreenDist(d: number): number {
    return d / this.scale;
  }

  zoom(factor: number, anchor?: Point) {
    const minScale = IU_PER_MM * 0.00001; // 10nm/px 最小
    const maxScale = IU_PER_MM * 1000; // 1m/px 最大
    const newScale = this.scale / factor;
    if (newScale < minScale || newScale > maxScale) return;

    if (anchor) {
      const worldBefore = this.screenToWorld(anchor);
      this.scale = newScale;
      const worldAfter = this.screenToWorld(anchor);
      this.center.x += worldBefore.x - worldAfter.x;
      this.center.y += worldBefore.y - worldAfter.y;
    } else {
      this.scale = newScale;
    }
  }

  pan(dxPx: number, dyPx: number) {
    this.center.x -= dxPx * this.scale;
    this.center.y += dyPx * this.scale;
  }

  fitBoundingBox(min: Point, max: Point, padding: number = 0.1) {
    const worldW = max.x - min.x;
    const worldH = max.y - min.y;
    if (worldW <= 0 || worldH <= 0) return;

    this.center = pt((min.x + max.x) / 2, (min.y + max.y) / 2);
    const padFactor = 1 + padding * 2;
    const scaleX = worldW / this.canvasWidth * padFactor;
    const scaleY = worldH / this.canvasHeight * padFactor;
    this.scale = Math.max(scaleX, scaleY);
  }

  getZoomMmPerPx(): number {
    return this.scale / IU_PER_MM;
  }
}
