/**
 * Debug script: Load L3 plane layer and capture console output
 */
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import { execSync } from 'child_process';
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

const PORT = 5176;
const FILE = 'StickHub-F_Paste.gbr';
const BASE = join(import.meta.dirname, '..', 'docs', 'test-files', 'x3-stickhub');
const FILEPATH = join(BASE, FILE);

async function main() {
  const content = await readFile(FILEPATH, 'utf-8');
  console.log(`File: ${FILE} (${content.length} bytes)`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await ctx.newPage();

  // Capture console messages
  page.on('console', msg => {
    if (msg.text().includes('[DEBUG')) {
      console.log('BROWSER:', msg.text());
    }
  });

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Load the L3 file
  await page.evaluate(async ({ text, name }) => {
    const app = window.__gerbview;
    if (app) await app.loadGerberText(text, name);
  }, { text: content, name: FILE });

  await page.waitForTimeout(2000);

  // Take screenshot
  const canvas = await page.$('canvas');
  if (canvas) {
    await canvas.screenshot({ path: join(import.meta.dirname, 'screenshots', 'web', 'DEBUG_L3_plane.png') });
    console.log('Screenshot saved');
  }

  // Check canvas pixel data
  const pixelInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'no canvas';
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let nonBlack = 0;
    let total = w * h;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10) nonBlack++;
    }
    return { width: w, height: h, nonBlack, total, pct: (nonBlack/total*100).toFixed(1) };
  });
  console.log('Canvas pixel info:', JSON.stringify(pixelInfo));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
