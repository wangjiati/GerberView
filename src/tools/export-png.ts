import JSZip from 'jszip';
import { GerberImage, LayerManager } from '../model/gerber-image';
import { Point, pt } from '../model/gerber-item';
import { IU_PER_MM } from '../model/enums';
import { Renderer, DisplayOptions, DEFAULT_DISPLAY_OPTIONS } from '../renderer/renderer';
import { Viewport } from '../renderer/viewport';

const NM_PER_INCH = IU_PER_MM * 25.4; // 1 inch = 25.4mm

/**
 * 将单个图层渲染到离屏 canvas，返回 PNG blob。
 * 画布尺寸由图层的 bounding box 和 DPI 决定。
 */
export function renderLayerToCanvas(
  layer: GerberImage,
  dpi: number,
  displayOptions: DisplayOptions,
): HTMLCanvasElement | null {
  if (!layer.boundingBox || layer.items.length === 0) return null;

  const bb = layer.boundingBox;
  const worldW = bb.max.x - bb.min.x; // nm
  const worldH = bb.max.y - bb.min.y; // nm

  const padding = 0.02; // 2% padding
  const padW = worldW * padding;
  const padH = worldH * padding;

  const totalW = worldW + padW * 2;
  const totalH = worldH + padH * 2;

  // nm/px = (nm per inch) / dpi
  const scale = NM_PER_INCH / dpi;

  const canvasW = Math.ceil(totalW / scale);
  const canvasH = Math.ceil(totalH / scale);

  // 限制最大分辨率避免内存溢出
  const maxPx = 16000;
  if (canvasW > maxPx || canvasH > maxPx) return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 创建独立 viewport
  const vp = new Viewport();
  vp.canvasWidth = canvasW;
  vp.canvasHeight = canvasH;
  vp.dpr = 1;
  vp.center = pt((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2);
  vp.scale = scale;

  // 创建只包含此图层的临时 LayerManager
  const tmpLm = new LayerManager();
  tmpLm.layers[layer.layerIndex] = layer;

  const renderer = new Renderer(ctx, vp, tmpLm);
  renderer.displayOptions = { ...displayOptions };
  renderer.displayOptions.showGrid = false;
  renderer.displayOptions.showAxes = false;
  renderer.displayOptions.showDcodes = false;
  renderer.displayOptions.highContrastMode = false;
  renderer.displayOptions.opacityMode = false;
  renderer.displayOptions.xorMode = false;
  renderer.displayOptions.simulationMode = false;
  renderer.displayOptions.mirror = false;
  renderer.render();

  return canvas;
}

/**
 * 将多个图层分别渲染为 PNG，打包到 ZIP 中下载。
 */
export async function exportLayersAsZip(
  layerManager: LayerManager,
  selectedIndices: number[],
  dpi: number,
  displayOptions: DisplayOptions,
): Promise<Blob> {
  const zip = new JSZip();

  for (const idx of selectedIndices) {
    const layer = layerManager.getLayer(idx);
    if (!layer) continue;

    const canvas = renderLayerToCanvas(layer, dpi, displayOptions);
    if (!canvas) continue;

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png');
    });

    const displayName = layer.layerName || layer.fileName || `layer_${idx}`;
    const safeName = displayName.replace(/[/\\?%*:|"<>]/g, '_');
    zip.file(`${safeName}.png`, blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function downloadZip(blob: Blob, filename: string = 'gerberview-layers.zip') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
