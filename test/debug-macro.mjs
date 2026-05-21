import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto('http://localhost:5177');
await page.waitForTimeout(1000);

// Load the file
const fileInput = await page.$('input[type="file"]');
const fs = await import('fs');
const path = await import('path');
const filePath = path.resolve('docs/test-files/x3-librepcb-sample-1/can2usb_SOLDERMASK-TOP.gbr');
const buffer = fs.readFileSync(filePath);
const file = new File([buffer], 'can2usb_SOLDERMASK-TOP.gbr');

// Use evaluate to trigger file loading
await page.evaluate(async (filePath) => {
  // Just find and click load
}, filePath);

// Use file chooser
const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.click('text=加载 Gerber')
]);
await fileChooser.setFiles(filePath);
await page.waitForTimeout(3000);

// Add debug logging
const result = await page.evaluate(() => {
  const app = window.__app;
  if (!app) return 'no app';
  const layerMgr = app.layerManager;
  const layers = [];
  for (const l of layerMgr.layers) {
    if (l) {
      layers.push({
        name: l.fileName,
        type: l.layerType,
        itemCount: l.items.length,
        dcodes: Array.from(l.dCodes.entries()).filter(([k,v]) => v.defined).map(([k,v]) => ({
          num: k,
          type: v.apertureType,
          hasMacro: !!v.macro,
          macroName: v.macro?.name,
          macroPrimCount: v.macro?.primitives?.length,
          macroParams: v.macroParams,
          size: v.size,
        })),
        items: l.items.slice(0, 20).map(i => ({
          shapeType: i.shapeType,
          flashed: i.flashed,
          dCode: i.dCode,
          start: i.start,
        })),
      });
    }
  }
  return layers;
});
console.log(JSON.stringify(result, null, 2));

await browser.close();
