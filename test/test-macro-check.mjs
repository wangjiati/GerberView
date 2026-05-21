import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

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

// Now test generateMacroShape output
const result = await page.evaluate(() => {
  const app = window.__gerbview;
  const layer = app.layerManager.getLayer(0);
  const dc20 = layer.getDCcode(20);
  
  // Call renderer's generateMacroShape directly
  const renderer = app.renderer;
  if (!renderer || !renderer.generateMacroShape) {
    // generateMacroShape is private, let's check via reflection
    return { error: 'no access to generateMacroShape' };
  }
  
  // Instead, let's check the macro's primitives more carefully
  const macro = dc20.macro;
  
  // Evaluate each primitive's parameters
  const primDetails = macro.primitives.map(prim => {
    const params = dc20.macroParams;
    const evaluated = prim.params.map(p => p.evaluate(params));
    return {
      id: prim.id,
      exposureOn: prim.exposureOn,
      paramsCount: prim.params.length,
      evaluatedParams: evaluated,
    };
  });
  
  return {
    macroName: macro.name,
    localParams: Array.from(macro.localParams.entries()).map(([k, v]) => [k, v.evaluate([])]),
    macroParams: dc20.macroParams,
    primDetails,
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
