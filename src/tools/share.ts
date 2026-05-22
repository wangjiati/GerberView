import { LayerManager, GerberImage, StepAndRepeat, defaultStepAndRepeat } from '../model/gerber-image';
import { GerberItem, Point, pt, createGerberItem } from '../model/gerber-item';
import { DCode, ApertureMacro, AmParam, AmPrimitive } from '../parser/aperture';
import { ShapeType, Interpolation, ApertureType, DrillShape, Polarity, MacroPrimitiveId, ParamItemType, LayerType } from '../model/enums';

const SHARE_VERSION = 1;

// ---- JSON-friendly types ----

interface SerializedPoint { x: number; y: number }

interface SerializedGerberItem {
  st: string;       // shapeType
  sx: number; sy: number;   // start
  ex: number; ey: number;   // end
  cx: number; cy: number;   // arcCenter
  wx: number; wy: number;   // size
  pp: SerializedPoint[] | null; // polygonPoints (null if empty)
  d: number;        // dCode
  f: number;        // flashed (0/1)
  pc: number;       // layerPolarityClear (0/1)
  i: number;        // interpolation
  sa: number;       // swapAxis (0/1)
  ma: number;       // mirrorA (0/1)
  mb: number;       // mirrorB (0/1)
  dsx: number; dsy: number; // drawScale
  lox: number; loy: number; // layerOffset
  lr: number;       // layerRotation
}

interface SerializedDCode {
  nd: number;       // numDcode
  at: string;       // apertureType
  sx: number; sy: number;   // size
  dx: number; dy: number;   // drill
  ds: string;       // drillShape
  r: number;        // rotation
  ec: number;       // edgesCount
  df: number;       // defined (0/1)
  mn: string | null; // macroName
  mp: number[];     // macroParams
}

interface SerializedAmParam {
  items: { t: number; v: number; p: number }[];
}

interface SerializedAmPrimitive {
  id: number;
  params: SerializedAmParam[];
  eo: number; // exposureOn (0/1)
}

interface SerializedApertureMacro {
  name: string;
  prims: SerializedAmPrimitive[];
  lp: [number, SerializedAmParam][];
}

interface SerializedGerberImage {
  fn: string;       // fileName
  li: number;       // layerIndex
  lt: string;       // layerType
  items: SerializedGerberItem[];
  dc: [number, SerializedDCode][];
  am: [string, SerializedApertureMacro][];
  ln: string;       // layerName
  lpc: number;      // layerPolarityClear
  sr: { cx: number; cy: number; dx: number; dy: number } | null;
  ip: string;       // imagePolarity
  iox: number; ioy: number; // imageOffset
  ir: number;       // imageRotation
  ijc: number;      // imageJustifyCenter
  ijox: number; ijoy: number; // imageJustifyOffset
  sa: number;       // swapAxis
  ma: number;       // mirrorA
  mb: number;       // mirrorB
  scx: number; scy: number; // scale
  ofx: number; ofy: number; // offset
  lr: number;       // localRotation
  ff: string;       // fileFunction
  fp: string;       // filePart
  fpl: string;      // filePolarity
  nn: string[];     // netNames
  cr: string[];     // componentRefs
  af: string[];     // aperFunctions
  col: string;      // color
  vis: number;      // visible (0/1)
  op: number;       // opacity
  bb: [number, number, number, number] | null; // boundingBox [minX,minY,maxX,maxY]
}

interface SharePayload {
  v: number;
  layers: SerializedGerberImage[];
}

// ---- Serialization helpers ----

function serPoint(p: Point): SerializedPoint { return p; }

function serItem(item: GerberItem): SerializedGerberItem {
  return {
    st: item.shapeType,
    sx: item.start.x, sy: item.start.y,
    ex: item.end.x, ey: item.end.y,
    cx: item.arcCenter.x, cy: item.arcCenter.y,
    wx: item.size.x, wy: item.size.y,
    pp: item.polygonPoints.length > 0 ? item.polygonPoints.map(serPoint) : null,
    d: item.dCode,
    f: item.flashed ? 1 : 0,
    pc: item.layerPolarityClear ? 1 : 0,
    i: item.interpolation,
    sa: item.swapAxis ? 1 : 0,
    ma: item.mirrorA ? 1 : 0,
    mb: item.mirrorB ? 1 : 0,
    dsx: item.drawScale.x, dsy: item.drawScale.y,
    lox: item.layerOffset.x, loy: item.layerOffset.y,
    lr: item.layerRotation,
  };
}

function deserItem(s: SerializedGerberItem, layerIndex: number): GerberItem {
  const item = createGerberItem(layerIndex);
  item.shapeType = s.st as ShapeType;
  item.start = pt(s.sx, s.sy);
  item.end = pt(s.ex, s.ey);
  item.arcCenter = pt(s.cx, s.cy);
  item.size = pt(s.wx, s.wy);
  item.polygonPoints = s.pp ? s.pp.map(p => pt(p.x, p.y)) : [];
  item.dCode = s.d;
  item.flashed = s.f === 1;
  item.layerPolarityClear = s.pc === 1;
  item.interpolation = s.i;
  item.swapAxis = s.sa === 1;
  item.mirrorA = s.ma === 1;
  item.mirrorB = s.mb === 1;
  item.drawScale = pt(s.dsx, s.dsy);
  item.layerOffset = pt(s.lox, s.loy);
  item.layerRotation = s.lr;
  return item;
}

function serDCode(dc: DCode): SerializedDCode {
  return {
    nd: dc.numDcode,
    at: dc.apertureType,
    sx: dc.size.x, sy: dc.size.y,
    dx: dc.drill.x, dy: dc.drill.y,
    ds: dc.drillShape,
    r: dc.rotation,
    ec: dc.edgesCount,
    df: dc.defined ? 1 : 0,
    mn: dc.macro ? dc.macro.name : null,
    mp: dc.macroParams,
  };
}

function deserDCode(s: SerializedDCode): DCode {
  const dc = new DCode();
  dc.numDcode = s.nd;
  dc.apertureType = s.at as ApertureType;
  dc.size = pt(s.sx, s.sy);
  dc.drill = pt(s.dx, s.dy);
  dc.drillShape = s.ds as DrillShape;
  dc.rotation = s.r;
  dc.edgesCount = s.ec;
  dc.defined = s.df === 1;
  dc.macroParams = s.mp;
  return dc;
}

function serAmParam(p: AmParam): SerializedAmParam {
  return { items: p.items.map(i => ({ t: i.type, v: i.value, p: i.paramIndex })) };
}

function deserAmParam(s: SerializedAmParam): AmParam {
  const p = new AmParam();
  p.items = s.items.map(i => ({ type: i.t, value: i.v, paramIndex: i.p }));
  return p;
}

function serAmPrimitive(prim: AmPrimitive): SerializedAmPrimitive {
  return {
    id: prim.id,
    params: prim.params.map(serAmParam),
    eo: prim.exposureOn ? 1 : 0,
  };
}

function deserAmPrimitive(s: SerializedAmPrimitive): AmPrimitive {
  const prim = new AmPrimitive(s.id as MacroPrimitiveId);
  prim.params = s.params.map(deserAmParam);
  prim.exposureOn = s.eo === 1;
  return prim;
}

function serApertureMacro(am: ApertureMacro): SerializedApertureMacro {
  return {
    name: am.name,
    prims: am.primitives.map(serAmPrimitive),
    lp: Array.from(am.localParams.entries()).map(([k, v]) => [k, serAmParam(v)]),
  };
}

function deserApertureMacro(s: SerializedApertureMacro): ApertureMacro {
  const am = new ApertureMacro();
  am.name = s.name;
  am.primitives = s.prims.map(deserAmPrimitive);
  am.localParams = new Map(s.lp.map(([k, v]) => [k, deserAmParam(v)]));
  return am;
}

function serImage(img: GerberImage): SerializedGerberImage {
  const sr = img.stepAndRepeat;
  return {
    fn: img.fileName,
    li: img.layerIndex,
    lt: img.layerType,
    items: img.items.map(serItem),
    dc: Array.from(img.dCodes.entries()).map(([k, v]) => [k, serDCode(v)]),
    am: Array.from(img.apertureMacros.entries()).map(([k, v]) => [k, serApertureMacro(v)]),
    ln: img.layerName,
    lpc: img.layerPolarityClear ? 1 : 0,
    sr: (sr.countX !== 1 || sr.countY !== 1) ? { cx: sr.countX, cy: sr.countY, dx: sr.distX, dy: sr.distY } : null,
    ip: img.imagePolarity,
    iox: img.imageOffset.x, ioy: img.imageOffset.y,
    ir: img.imageRotation,
    ijc: img.imageJustifyCenter ? 1 : 0,
    ijox: img.imageJustifyOffset.x, ijoy: img.imageJustifyOffset.y,
    sa: img.swapAxis ? 1 : 0,
    ma: img.mirrorA ? 1 : 0,
    mb: img.mirrorB ? 1 : 0,
    scx: img.scale.x, scy: img.scale.y,
    ofx: img.offset.x, ofy: img.offset.y,
    lr: img.localRotation,
    ff: img.fileFunction,
    fp: img.filePart,
    fpl: img.filePolarity,
    nn: Array.from(img.netNames),
    cr: Array.from(img.componentRefs),
    af: Array.from(img.aperFunctions),
    col: img.color,
    vis: img.visible ? 1 : 0,
    op: img.opacity,
    bb: img.boundingBox ? [img.boundingBox.min.x, img.boundingBox.min.y, img.boundingBox.max.x, img.boundingBox.max.y] : null,
  };
}

function deserImage(s: SerializedGerberImage): GerberImage {
  const img = new GerberImage();
  img.fileName = s.fn;
  img.layerIndex = s.li;
  img.layerType = s.lt as LayerType;

  // Build aperture macros first
  const macros = new Map<string, ApertureMacro>();
  for (const [k, v] of s.am) {
    macros.set(k, deserApertureMacro(v));
  }
  img.apertureMacros = macros;

  // Build d-codes, resolving macro references
  img.dCodes = new Map();
  for (const [k, v] of s.dc) {
    const dc = deserDCode(v);
    if (v.mn) dc.macro = macros.get(v.mn) ?? null;
    img.dCodes.set(k, dc);
  }

  // Build items
  img.items = s.items.map(si => deserItem(si, s.li));

  img.layerName = s.ln;
  img.layerPolarityClear = s.lpc === 1;
  img.stepAndRepeat = s.sr ? { countX: s.sr.cx, countY: s.sr.cy, distX: s.sr.dx, distY: s.sr.dy } : defaultStepAndRepeat();
  img.imagePolarity = s.ip as Polarity;
  img.imageOffset = pt(s.iox, s.ioy);
  img.imageRotation = s.ir;
  img.imageJustifyCenter = s.ijc === 1;
  img.imageJustifyOffset = pt(s.ijox, s.ijoy);
  img.swapAxis = s.sa === 1;
  img.mirrorA = s.ma === 1;
  img.mirrorB = s.mb === 1;
  img.scale = pt(s.scx, s.scy);
  img.offset = pt(s.ofx, s.ofy);
  img.localRotation = s.lr;
  img.fileFunction = s.ff;
  img.filePart = s.fp;
  img.filePolarity = s.fpl;
  img.netNames = new Set(s.nn);
  img.componentRefs = new Set(s.cr);
  img.aperFunctions = new Set(s.af);
  img.color = s.col;
  img.visible = s.vis === 1;
  img.opacity = s.op;
  img.boundingBox = s.bb ? { min: pt(s.bb[0], s.bb[1]), max: pt(s.bb[2], s.bb[3]) } : null;

  return img;
}

// ---- Public API ----

export function serializeLayerManager(lm: LayerManager): SharePayload {
  const layers: SerializedGerberImage[] = [];
  for (const layer of lm.layers) {
    if (layer) layers.push(serImage(layer));
  }
  return { v: SHARE_VERSION, layers };
}

export function deserializeToLayerManager(payload: SharePayload): LayerManager {
  const lm = new LayerManager();
  for (const sImg of payload.layers) {
    const img = deserImage(sImg);
    lm.addLayer(img, sImg.li);
  }
  return lm;
}

// ---- Compression ----

export async function compressToBase64(text: string): Promise<string> {
  if (typeof CompressionStream !== 'undefined') {
    const blob = new Blob([text]);
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return arrayBufferToBase64(buf);
  }
  // Fallback: raw base64
  return btoa(unescape(encodeURIComponent(text)));
}

export async function decompressFromBase64(base64: string): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    const bytes = base64ToArrayBuffer(base64);
    const ab = new ArrayBuffer(bytes.length);
    new Uint8Array(ab).set(bytes);
    const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  // Fallback: raw base64
  return decodeURIComponent(escape(atob(base64)));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- HTML generation ----

export async function generateShareHTML(lm: LayerManager): Promise<Blob> {
  const payload = serializeLayerManager(lm);
  const json = JSON.stringify(payload);
  const compressed = await compressToBase64(json);

  // Extract current page's style and script content
  const styleEl = document.querySelector('style');
  const scriptEl = document.querySelector('script[type="module"]');
  let css = styleEl?.textContent ?? '';
  let js = scriptEl?.textContent ?? '';

  // Fallback for dev mode: inline script has no content, fetch page source
  if (!js.trim()) {
    try {
      const resp = await fetch(location.href);
      const src = await resp.text();
      const styleMatch = src.match(/<style>([\s\S]*?)<\/style>/i);
      if (styleMatch) css = styleMatch[1];
      const scriptMatch = src.match(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/i);
      if (scriptMatch) js = scriptMatch[1];
    } catch { /* ignore */ }
  }

  js = js.replace(/<\/script/gi, '<\\/script');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GerberView - Shared</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>window.__SHARE_DATA__="${compressed}";</script>
<script type="module">${js}</script>
</body>
</html>`;

  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

export function downloadShareHTML(blob: Blob, filename: string = 'gerberview-share.html') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadShareData(): Promise<LayerManager | null> {
  const data = (window as any).__SHARE_DATA__;
  if (!data || typeof data !== 'string') return null;

  const json = await decompressFromBase64(data);
  const payload: SharePayload = JSON.parse(json);
  return deserializeToLayerManager(payload);
}
