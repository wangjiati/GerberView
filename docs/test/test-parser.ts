// Simple parser test - run with: npx tsx test/test-parser.ts
import { GerberParser, detectGerberFile } from '../src/parser/gerber-parser';

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passCount++;
    console.log(`\x1b[32mPASS\x1b[0m: ${name}`);
  } catch(e: any) {
    failCount++;
    console.log(`\x1b[31mFAIL\x1b[0m: ${name}: ${e.message}`);
  }
}

function assertEquals(actual: any, expected: any, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}
function assertApprox(actual: number, expected: number, tolerance: number, msg: string) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${msg}: expected ${expected}±${tolerance}, got ${actual}`);
}

// Test 1: Basic line
test('Basic line drawing', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
G01X1000Y2000D02*
X5000Y6000D01*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 1, 'items count');
  assertEquals(image.items[0].shapeType, 'segment', 'shape type');
  assertApprox(image.items[0].start.x, 0.1 * 2.54e7, 100, 'start.x');
  assertApprox(image.items[0].end.x, 0.5 * 2.54e7, 100, 'end.x');
});

// Test 2: Circle flash
test('Circle flash', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.065*%
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 1, 'items');
  assertEquals(image.items[0].flashed, true, 'flashed');
  assertEquals(image.items[0].shapeType, 'spotCircle', 'shape');
});

// Test 3: Rect flash
test('Rect flash', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10R,0.06X0.08*%
D10*
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].shapeType, 'spotRect', 'shape');
});

// Test 4: Polygon fill (G36/G37)
test('Polygon fill', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
G36*
X1000Y1000D02*
X5000Y1000D01*
X5000Y5000D01*
X1000Y5000D01*
X1000Y1000D01*
G37*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 1, 'items');
  assertEquals(image.items[0].shapeType, 'polygon', 'shape');
});

// Test 5: Metric
test('Metric units', () => {
  const gerber = `%FSLAX25Y25*%
%MOMM*%
%ADD10C,0.1*%
X10000Y20000D02*
X50000Y60000D01*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertApprox(image.items[0].start.x, 0.1 * 1e6, 100, 'start.x');
  assertApprox(image.items[0].end.x, 0.5 * 1e6, 100, 'end.x');
});

// Test 6: Trailing zero omission
test('Trailing zero omission', () => {
  const gerber = `%FSTAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
X12Y2D02*
X50Y60D01*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertApprox(image.items[0].start.x, 12.0 * 2.54e7, 1000, 'start.x');
  assertApprox(image.items[0].end.x, 50.0 * 2.54e7, 1000, 'end.x');
});

// Test 7: Multi-quadrant arc (G75)
test('Multi-quadrant arc CW', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
G75*
X2000Y1000D02*
G02X3000Y2000I1000J0D01*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 1, 'items');
  assertEquals(image.items[0].shapeType, 'arc', 'shape');
});

// Test 8: Layer polarity
test('Layer polarity', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
%LPC*%
X1000Y2000D02*
X5000Y6000D01*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].layerPolarityClear, true, 'clear');
});

// Test 9: Step and Repeat
test('Step and Repeat', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
%SRX3Y2I0.1J0.1*%
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 6, 'items (3x2)');
});

// Test 10: Aperture macro with params
test('Aperture macro with params', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%AMDONUT*
1,1,$1,0,0*
1,0,$2,0,0*
%ADD10DONUT,0.1X0.05*%
D10*
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 1, 'items');
  assertEquals(image.items[0].shapeType, 'spotMacro', 'shape');
  const dc = image.getDCcode(10);
  assertEquals(dc.macroParams.length, 2, 'params');
});

// Test 11: Structured comment X2
test('Structured comment X2', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
G04 #@! TA.AperFunction,MainPad*
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].aperFunction, 'MainPad', 'aperFunction');
});

// Test 12: TO.N net attribute + TD delete
test('TO.N + TD delete', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
%TO.N,GND*%
X1000Y2000D03*
%TD*%
X2000Y3000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].netName, 'GND', 'net');
  assertEquals(image.items[1].netName, '', 'net after TD');
});

// Test 13: Multiple sub-polygons via D02
test('Multiple sub-polygons via D02', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
G36*
X1000Y1000D02*
X2000Y1000D01*
X2000Y2000D01*
X1000Y2000D01*
D02*
X3000Y1000D02*
X4000Y1000D01*
X4000Y2000D01*
X3000Y2000D01*
G37*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 2, '2 polygons');
  assertEquals(image.items[0].shapeType, 'polygon', 'poly0');
  assertEquals(image.items[1].shapeType, 'polygon', 'poly1');
});

// Test 14: Relative coordinates
test('Relative coordinates', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
G91*
%ADD10C,0.010*%
X1000Y2000D02*
X1000Y1000D01*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertApprox(image.items[0].start.x, 0.1 * 2.54e7, 100, 'start.x');
  assertApprox(image.items[0].end.x, 0.2 * 2.54e7, 100, 'end.x');
});

// Test 15: Mirror + axis swap
test('Mirror + axis swap', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%MIA0B1*%
%ASAYBX*%
%ADD10C,0.010*%
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].mirrorB, true, 'mirrorB');
  assertEquals(image.items[0].swapAxis, true, 'swapAxis');
});

// Test 16: Detect gerber
test('Detect gerber file', () => {
  assertEquals(detectGerberFile('%FSLAX24Y24*%\n%ADD10C,0.01*%\nX1000Y2000D01*'), true, 'detect');
  assertEquals(detectGerberFile('Hello World\nThis is not gerber'), false, 'not detect');
});

// Test 17: TD selective delete
test('TD selective delete .N', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
%TO.N,GND*%
%TO.C,R1*%
X1000Y2000D03*
%TD.N*%
X2000Y3000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].netName, 'GND', 'net before TD.N');
  assertEquals(image.items[0].componentRef, 'R1', 'comp before TD.N');
  assertEquals(image.items[1].netName, '', 'net after TD.N');
  assertEquals(image.items[1].componentRef, 'R1', 'comp preserved after TD.N');
});

// Test 18: TO.P pad attribute
test('TO.P pad attribute', () => {
  const gerber = `%FSLAX24Y24*%
%MOIN*%
%ADD10C,0.010*%
%TO.P,R1,1*%
X1000Y2000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items[0].componentRef, 'R1', 'comp ref from TO.P');
  assertEquals(image.componentRefs.has('R1'), true, 'comp ref collected');
});

// Test 19: RoundRect macro (outline + circles + line20)
test('RoundRect aperture macro', () => {
  const gerber = `%FSLAX46Y46*%
%MOMM*%
%LPD*%
%AMRoundRect*
0 Rectangle with rounded corners*
0 $1 Rounding radius*
0 $2 $3 $4 $5 $6 $7 $8 $9 X,Y pos of 4 corners*
4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0*
1,1,$1+$1,$2,$3*
1,1,$1+$1,$4,$5*
1,1,$1+$1,$6,$7*
1,1,$1+$1,$8,$9*
20,1,$1+$1,$2,$3,$4,$5,0*
20,1,$1+$1,$4,$5,$6,$7,0*
20,1,$1,$1,$6,$7,$8,$9,0*
20,1,$1,$1,$8,$9,$2,$3,0*%
%ADD10RoundRect,0.250000X-0.475000X0.250000X-0.475000X-0.250000X0.475000X-0.250000X0.475000X0.250000X0*%
D10*
X500000Y-500000D03*
M02*`;
  const parser = new GerberParser();
  const image = parser.parse(gerber, 'test.gbr', 0);
  assertEquals(image.items.length, 1, 'items');
  assertEquals(image.items[0].shapeType, 'spotMacro', 'shape');
  const dc = image.getDCcode(10);
  assertEquals(dc.macro !== null, true, 'has macro');
  assertEquals(dc.macroParams.length, 10, 'params count');
  assertApprox(dc.macroParams[0], 0.25, 0.001, 'rounding radius');
});

// Summary
console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
