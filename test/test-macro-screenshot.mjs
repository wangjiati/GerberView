import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url'; import { pathToFileURL } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
let pw;
try { const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim(); pw = await import(pathToFileURL(join(globalRoot, 'playwright', 'index.mjs')).href); } catch { pw = await import('playwright'); }
const { chromium } = pw;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto('http://localhost:5176');
await page.waitForTimeout(1000);
await page.evaluate(async (filePath) => {
  const resp = await fetch(filePath);
  const text = await resp.text();
  const blob = new Blob([text], { type: 'text/plain' });
  const file = new File([blob], 'can2usb_SOLDERMASK-TOP.gbr');
  await window.__gerbview.loadFiles([file]);
}, 'http://localhost:5176/docs/test-files/x3-librepcb-sample-1/can2usb_SOLDERMASK-TOP.gbr');
await page.waitForTimeout(2000);

// Zoom to fit
await page.evaluate(() => window.__gerbview.zoomFit());
await page.waitForTimeout(500);

// Take full screenshot
await page.screenshot({ path: join(__dirname, 'screenshots', 'macro-check-full.png') });

// Zoom to D20 area near R15 (4.78, 1.47) to (6.5, 2.0) in mm
await page.evaluate(() => {
  const vp = window.__gerbview.viewport;
  const IU = 1e6;
  // D20 flash positions: (4.7813, 1.4665) and (6.3313, 1.4665)
  const minX = 4.0 * IU, minY = 1.0 * IU, maxX = 7.0 * IU, maxY = 2.0 * IU;
  vp.fitBoundingBox({x: minX, y: minY}, {x: maxX, y: maxY}, 0.05);
  window.__gerbview.requestRender();
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(__dirname, 'screenshots', 'macro-check-zoom.png') });

// Enable D-code display and take another screenshot
await page.evaluate(() => {
  const app = window.__gerbview;
  app.displayOptions.showDCodes = true;
  app.syncLeftToolbar();
  app.requestRender();
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(__dirname, 'screenshots', 'macro-check-dcode.png') });

console.log('Screenshots saved');
await browser.close();
