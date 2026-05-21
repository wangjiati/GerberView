import { GerberParser } from '../src/parser/gerber-parser';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(__dirname, '..', 'docs', 'test-files', 'pcb-fabrication-test-2', 'pcb_fabrication_data_in_gerber_example_2');
const files = fs.readdirSync(base).filter(f => f.includes('L3'));
const file = files[0];
const full = path.join(base, file);
const t = fs.readFileSync(full, 'utf-8');
const parser = new GerberParser();
const img = parser.parse(t, file, 0);

const dc16 = img.getDCcode(16);
if (dc16.macro) {
  const wMm = (dc16.size.x / 1e6).toFixed(3);
  console.log(`THERS4 D16 size: ${wMm}mm x ${(dc16.size.y / 1e6).toFixed(3)}mm`);
}

// Also check mask layer
const maskFile = fs.readdirSync(path.join(__dirname, '..', 'docs', 'test-files', 'x3-stickhub')).find(f => f.includes('Mask'));
if (maskFile) {
  const maskPath = path.join(__dirname, '..', 'docs', 'test-files', 'x3-stickhub', maskFile);
  const maskText = fs.readFileSync(maskPath, 'utf-8');
  const maskParser = new GerberParser();
  const maskImg = maskParser.parse(maskText, maskFile, 0);
  for (let d = 10; d <= 20; d++) {
    const dc = maskImg.getDCcode(d);
    if (dc.defined && dc.macro) {
      const wMm = (dc.size.x / 1e6).toFixed(3);
      console.log(`Mask D${d}: ${wMm}mm x ${(dc.size.y / 1e6).toFixed(3)}mm (macro=${dc.macro.name})`);
    }
  }
}
