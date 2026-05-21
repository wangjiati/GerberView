import { execSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';

let playwrightModule;
try {
  const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
  const modPath = join(globalRoot, 'playwright', 'index.mjs');
  playwrightModule = await import(pathToFileURL(modPath).href);
} catch {
  playwrightModule = await import('playwright');
}
const { chromium } = playwrightModule;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1900, height: 930 },
  deviceScaleFactor: 2,
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const { readFileSync } = await import('fs');
const content = readFileSync('docs/test-files/x3-stickhub/StickHub-B_Cu.gbr', 'utf-8');

const debugInfo = await page.evaluate(async ({ text, name }) => {
  const app = window.__gerbview;
  if (!app) return null;
  
  await app.loadGerberText(text, name);
  await new Promise(r => setTimeout(r, 500));
  
  const layer = app.layerManager.layers[0];
  if (!layer) return { error: 'no layer' };
  
  // Item type distribution
  const types = {};
  for (const it of layer.items) {
    types[it.shapeType] = (types[it.shapeType] || 0) + 1;
  }
  
  // Min/max X/Y across all items
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const it of layer.items) {
    if (it.start) {
      minX = Math.min(minX, it.start.x);
      maxX = Math.max(maxX, it.start.x);
      minY = Math.min(minY, it.start.y);
      maxY = Math.max(maxY, it.start.y);
    }
    if (it.end) {
      minX = Math.min(minX, it.end.x);
      maxX = Math.max(maxX, it.end.x);
      minY = Math.min(minY, it.end.y);
      maxY = Math.max(maxY, it.end.y);
    }
    if (it.polygonPoints) {
      for (const p of it.polygonPoints) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  
  return {
    itemCount: layer.items.length,
    types,
    imagePolarity: layer.imagePolarity,
    color: layer.color,
    stepAndRepeat: layer.stepAndRepeat,
    imageOffset: layer.imageOffset,
    imageRotation: layer.imageRotation,
    boundingBox: layer.boundingBox,
    rawCoordRange: { minX, maxX, minY, maxY },
    viewport: {
      center: app.viewport.center,
      scale: app.viewport.scale,
      canvasWidth: app.viewport.canvasWidth,
      canvasHeight: app.viewport.canvasHeight,
    },
    // First polygon item
    firstPolygon: layer.items.find(it => it.shapeType === 'polygon'),
    // First segment item
    firstSegment: layer.items.find(it => it.shapeType === 'segment'),
  };
}, { text: content, name: 'StickHub-B_Cu.gbr' });

console.log(JSON.stringify(debugInfo, null, 2));
await browser.close();
