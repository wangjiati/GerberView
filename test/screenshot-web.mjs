/**
 * Web GerbView 自动截图脚本 (Playwright)
 *
 * 启动 Vite dev server → 打开浏览器 → 逐文件加载 Gerber → 截图
 *
 * 用法: node test/screenshot-web.mjs [--max-files N] [--port 5173]
 */

import { spawn, execSync } from 'child_process';
import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join, extname, basename } from 'path';

// 使用全局安装的 playwright (Windows 需要 file:// URL)
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

const GERBER_EXTS = new Set([
  '.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo',
  '.gko', '.gm1', '.gm2', '.gm3', '.gpb', '.gpt', '.drl', '.xnc',
  '.xln', '.drd', '.gdl', '.gdr',
]);

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
};
const MAX_FILES = parseInt(getArg('max-files') || '0') || 0;
const PORT = parseInt(getArg('port') || '5173');
const TEST_DIR = getArg('test-dir') || join(import.meta.dirname, '..', 'docs', 'test-files');
const OUTPUT_DIR = getArg('output-dir') || join(import.meta.dirname, 'screenshots', 'web');

async function findGerberFiles(rootDir, maxFiles = 0) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (GERBER_EXTS.has(extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  await walk(rootDir);
  files.sort();
  return maxFiles > 0 ? files.slice(0, maxFiles) : files;
}

function safeName(name) {
  return name.replace(/ /g, '_').replace(/\$/g, 'S').replace(/#/g, 'H').slice(0, 80);
}

async function main() {
  // 1. 查找文件
  const files = await findGerberFiles(TEST_DIR, MAX_FILES);
  console.log(`找到 ${files.length} 个 Gerber 文件`);
  if (files.length === 0) { console.log('没有文件可处理'); return; }

  await mkdir(OUTPUT_DIR, { recursive: true });

  // 2. 检查 dev server 是否已运行
  let needStartServer = false;
  try {
    const resp = await fetch(`http://localhost:${PORT}`);
    if (!resp.ok) needStartServer = true;
  } catch {
    needStartServer = true;
  }

  let viteProcess = null;
  if (needStartServer) {
    console.log('启动 Vite dev server...');
    viteProcess = spawn('npx', ['vite', '--port', String(PORT), '--host'], {
      cwd: join(import.meta.dirname, '..'),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    viteProcess.stdout.on('data', d => process.stdout.write(d));
    viteProcess.stderr.on('data', d => process.stderr.write(d));

    // 等待 dev server 就绪
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const resp = await fetch(`http://localhost:${PORT}`);
        if (resp.ok) break;
      } catch { /* not ready yet */ }
    }
    console.log('Dev server 已就绪');
  } else {
    console.log('Dev server 已在运行');
  }

  // 3. 启动浏览器
  // KiCad canvas is 3797x1851 at ~2x DPI → logical ~1899x926
  // Match aspect ratio: use viewport that produces similar canvas proportions
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1713, height: 925 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // 4. 打开应用 (强制禁用缓存)
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 禁用网格，隐藏 UI 面板使 canvas 填满视口（匹配 KiCad 的全画布截图）
  await page.evaluate(() => {
    const app = window.__gerbview;
    if (app && app.displayOptions) {
      app.displayOptions.showGrid = false;
    }
    // 隐藏左侧工具栏、右侧面板、菜单栏、顶部工具栏、状态栏，让 canvas 填满窗口
    for (const sel of ['.left-toolbar', '.left-toolbar-wrap', '.layer-panel', '.menu-bar', '.top-toolbar', '.status-bar']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
    // 触发 resize 让 canvas 重新适配
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(500);

  // 5. 逐文件加载并截图
  for (let i = 0; i < files.length; i++) {
    const filepath = files[i];
    const base = basename(filepath, extname(filepath));
    const outname = safeName(base) + '.png';
    const outpath = join(OUTPUT_DIR, outname);

    console.log(`[${i + 1}/${files.length}] ${basename(filepath)}`);

    try {
      const content = await readFile(filepath, 'utf-8');
      const fileName = basename(filepath);

      // 清除之前加载的图层
      await page.evaluate(() => {
        const app = window.__gerbview;
        if (app) app.clearAllLayers();
      });
      await page.waitForTimeout(200);

      // 通过测试 API 加载文件
      await page.evaluate(async ({ text, name }) => {
        const app = window.__gerbview;
        if (app) await app.loadGerberText(text, name);
      }, { text: content, name: fileName });

      await page.waitForTimeout(1000);

      // 截取 canvas 元素
      const canvas = await page.$('canvas');
      if (canvas) {
        await canvas.screenshot({ path: outpath });
        console.log(`  保存: ${outname}`);
      } else {
        console.log('  找不到 canvas 元素');
        await page.screenshot({ path: outpath });
      }
    } catch (err) {
      console.error(`  失败: ${err.message}`);
    }
  }

  // 6. 清理
  await browser.close();
  if (viteProcess) viteProcess.kill();
  console.log('完成');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
