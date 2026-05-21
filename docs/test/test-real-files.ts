// Test with real Gerber files - run with: npx tsx test/test-real-files.ts
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GerberParser, detectGerberFile } from '../src/parser/gerber-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.join(__dirname, 'gerber_test_files');

let passCount = 0;
let failCount = 0;
const errors: string[] = [];

function testFile(filePath: string) {
  const fileName = path.basename(filePath);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!detectGerberFile(content)) {
      console.log(`  SKIP: ${fileName} (not detected as Gerber)`);
      return;
    }
    const parser = new GerberParser();
    const image = parser.parse(content, fileName, 0);
    // 检查是否为空文件（无光圈定义）
    const hasApertures = content.includes('%ADD');
    if (image.items.length === 0 && !hasApertures) {
      passCount++;
      console.log(`\x1b[32m  PASS\x1b[0m: ${fileName} - empty file (OK)`);
    } else if (image.items.length === 0 && hasApertures) {
      failCount++;
      errors.push(`${fileName}: has apertures but 0 items parsed`);
      console.log(`\x1b[31m  FAIL\x1b[0m: ${fileName} - has apertures but 0 items`);
    } else {
      passCount++;
      console.log(`\x1b[32m  PASS\x1b[0m: ${fileName} - ${image.items.length} items`);
    }
  } catch (e: any) {
    failCount++;
    errors.push(`${fileName}: ${e.message}`);
    console.log(`\x1b[31m  FAIL\x1b[0m: ${fileName} - ${e.message}`);
  }
}

// Test all .gbr files
console.log('Testing .gbr files from test/gerber_test_files/:\n');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.gbr'));
for (const file of files.sort()) {
  testFile(path.join(testDir, file));
}

// Test some files from docs/test-files
const docsDir = path.join(__dirname, '..', 'docs', 'test-files');
if (fs.existsSync(docsDir)) {
  console.log('\nTesting files from docs/test-files/:\n');
  function findGerberFiles(dir: string, depth: number = 0): string[] {
    if (depth > 3) return [];
    const results: string[] = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findGerberFiles(fullPath, depth + 1));
        } else if (entry.name.endsWith('.gbr') || entry.name.endsWith('.gtl') || entry.name.endsWith('.gbl') || entry.name.endsWith('.gts') || entry.name.endsWith('.gbs') || entry.name.endsWith('.gko') || entry.name.endsWith('.gbo') || entry.name.endsWith('.gto') || entry.name.endsWith('.gtp') || entry.name.endsWith('.gbp')) {
          results.push(fullPath);
        }
      }
    } catch {}
    return results;
  }
  const docFiles = findGerberFiles(docsDir);
  for (const file of docFiles.sort()) {
    testFile(file);
  }
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (errors.length > 0) {
  console.log('\nErrors:');
  errors.forEach(e => console.log(`  - ${e}`));
}
