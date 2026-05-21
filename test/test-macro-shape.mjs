import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pw;
try {
  const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
  const modPath = join(globalRoot, 'playwright', 'index.mjs');
  pw = await import(pathToFileURL(modPath).href);
} catch {
  pw = await import('playwright');
}
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto('http://localhost:5177');
await page.waitForTimeout(2000);

// Load multiple files to test layer ordering
const testDir = join(__dirname, '..', 'docs', 'test-files', 'x3-librepcb-sample-1');
const files = [
  'can2usb_SOLDERMASK-TOP.gbr',
  'can2usb_COPPER-BOTTOM.gbr',
  'can2usb_COPPER-TOP.gbr',
  'can2usb_SILKSCREEN-TOP.gbr',
  'can2usb_OUTLINES.gbr',
  'can2usb_SOLDERPASTE-TOP.gbr',
].map(f => join(testDir, f));

// Load via evaluate using loadFiles (which triggers auto-sort)
const fileData = files.map(f => ({
  text: readFileSync(f, 'utf-8'),
  name: f.split(/[/\\]/).pop(),
}));
await page.evaluate(async (fileData) => {
  const app = window.__gerbview || window.__app;
  const fileObjects = fileData.map(d => {
    const blob = new Blob([d.text], { type: 'text/plain' });
    return new File([blob], d.name);
  });
  if (app && app.loadFiles) await app.loadFiles(fileObjects);
}, fileData);
await page.waitForTimeout(2000);

// Check layer ordering after auto-sort
const result = await page.evaluate(() => {
  const app = window.__gerbview || window.__app;
  const layers = [];
  for (let i = 0; i < 32; i++) {
    const l = app.layerManager.getLayer(i);
    if (l) layers.push({ idx: i, name: l.layerName || l.fileName, type: l.layerType });
  }
  return { layers, total: layers.length };
});

console.log('Layer order after auto-sort:');
for (const l of result.layers) {
  console.log(`  [${l.idx}] ${l.name} (${l.type})`);
}

// Take screenshot
await page.screenshot({ path: join(__dirname, 'screenshots', 'layer-menu-test.png'), fullPage: false });

await browser.close();
