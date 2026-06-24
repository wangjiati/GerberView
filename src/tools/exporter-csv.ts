import { LayerManager, GerberImage } from '../model/gerber-image';
import { GerberItem, ComponentInfo } from '../model/gerber-item';
import { transformPointWorld } from './transform';
import { IU_PER_MM, LayerType } from '../model/enums';

/**
 * 元件级元数据聚合：遍历所有图层 items，按 componentRef 聚合，
 * 用 transformPointWorld 计算焊盘质心坐标(mm)，统计 padCount/nets，
 * 从所在图层 layerType 推断 top/bottom。
 *
 * 返回的 Map 以位号为键，合并了 GerberImage.components 中已捕获的
 * X2 属性(value/footprint/mountType/rotation/manufacturer/mpn)与
 * 从 items 聚合的几何/统计信息。
 */
export function collectComponents(layerManager: LayerManager): Map<string, ComponentInfo> {
  // 每个元件累积的焊盘位置(用于质心)与网络
  const padX: Record<string, number[]> = {};
  const padY: Record<string, number[]> = {};
  const padCount: Record<string, number> = {};
  const nets: Record<string, Set<string>> = {};
  const side: Record<string, 'top' | 'bottom' | 'unknown'> = {};

  // 先把已解析的 X2 元件属性拷贝出来作为基础
  const result = new Map<string, ComponentInfo>();
  for (let i = 0; i < 32; i++) {
    const layer = layerManager.getLayer(i);
    if (!layer) continue;
    for (const [ref, info] of layer.components) {
      if (!result.has(ref)) {
        result.set(ref, { ...info, nets: [...info.nets] });
      }
    }
  }

  for (let i = 0; i < 32; i++) {
    const layer = layerManager.getLayer(i);
    if (!layer) continue;
    for (const item of layer.items) {
      const ref = item.componentRef;
      if (!ref) continue;
      // 仅统计闪光焊盘作为质心/数量来源
      if (item.flashed) {
        const w = transformPointWorld(item, layer, item.start);
        (padX[ref] ??= []).push(w.x);
        (padY[ref] ??= []).push(w.y);
        padCount[ref] = (padCount[ref] ?? 0) + 1;
      }
      if (item.netName) {
        (nets[ref] ??= new Set()).add(item.netName);
      }
      // 面：以所在图层层类型推断(优先铜层)
      if (!side[ref] || side[ref] === 'unknown') {
        side[ref] = layerSideFromType(layer.layerType);
      }
    }
  }

  // 合并几何/统计信息到 result
  for (const ref of new Set([...Object.keys(padCount), ...result.keys()])) {
    const info = result.get(ref) ?? {
      ref, value: '', footprint: '', mountType: '', rotation: 0,
      manufacturer: '', mpn: '', layerSide: 'unknown', padCount: 0,
      centerX: 0, centerY: 0, nets: [],
    };
    const xs = padX[ref];
    if (xs && xs.length) {
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const ys = padY[ref];
      const cy = ys ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
      info.centerX = +(cx / IU_PER_MM).toFixed(4);
      info.centerY = +(cy / IU_PER_MM).toFixed(4);
    }
    info.padCount = padCount[ref] ?? info.padCount;
    info.nets = nets[ref] ? Array.from(nets[ref]) : info.nets;
    if (side[ref]) info.layerSide = side[ref];
    result.set(ref, info);
  }

  return result;
}

function layerSideFromType(t: LayerType): 'top' | 'bottom' | 'unknown' {
  if (t === LayerType.TopCopper || t === LayerType.TopSolderMask ||
      t === LayerType.TopSilkscreen || t === LayerType.TopPaste || t === LayerType.TopOther) {
    return 'top';
  }
  if (t === LayerType.BottomCopper || t === LayerType.BottomSolderMask ||
      t === LayerType.BottomSilkscreen || t === LayerType.BottomPaste || t === LayerType.BottomOther) {
    return 'bottom';
  }
  return 'unknown';
}

/** 焊盘信息(焊盘维度列表与导出用) */
export interface PadInfo {
  ref: string;                                    // 位号
  padName: string;                                // 焊盘名 (.P 第2参数)
  pinFunction: string;                            // 引脚功能 (.P 第3参数)
  netName: string;                                // 关联网络
  centerX: number;                                // 中心X(mm)
  centerY: number;                                // 中心Y(mm)
  layerSide: 'top' | 'bottom' | 'unknown';        // 顶/底面
  padType: string;                                // 焊盘类型(C/R/O/P/M)
  sizeX: number;                                  // 尺寸X(mm)
  sizeY: number;                                  // 尺寸Y(mm)
  dCode: number;                                  // D 码编号
}

/**
 * 收集全部焊盘：遍历所有图层 items，筛选 flashed 且带 componentRef+padName 的项，
 * 用 transformPointWorld 计算中心坐标(mm)，从 D-Code 取类型/尺寸，从层类型推断面。
 * 同一焊盘(同位号+焊盘名+中心点)在多图层出现时去重，优先保留铜层。
 */
export function collectPads(layerManager: LayerManager): PadInfo[] {
  // 层优先级：铜层 > 其他(同一焊盘在铜/阻焊/丝印层都会 flash)
  const layerRank = (t: LayerType): number =>
    t === LayerType.TopCopper || t === LayerType.BottomCopper ? 0 : 1;

  const dedup = new Map<string, { info: PadInfo; rank: number }>();
  for (let i = 0; i < 32; i++) {
    const layer = layerManager.getLayer(i);
    if (!layer) continue;
    const side = layerSideFromType(layer.layerType);
    const rank = layerRank(layer.layerType);
    for (const item of layer.items) {
      if (!item.flashed || !item.componentRef || !item.padName) continue;
      const w = transformPointWorld(item, layer, item.start);
      const dc = layer.getDCcode(item.dCode);
      // 去重键：位号 + 焊盘名 + 中心点(四舍五入到 0.01mm)
      const key = `${item.componentRef}|${item.padName}|${(w.x / IU_PER_MM).toFixed(2)},${(w.y / IU_PER_MM).toFixed(2)}`;
      const existing = dedup.get(key);
      // 已存在且当前不是铜层、已存在是铜层 → 跳过(铜层优先)
      if (existing && existing.rank <= rank) continue;
      dedup.set(key, {
        info: {
          ref: item.componentRef,
          padName: item.padName,
          pinFunction: item.pinFunction || '',
          netName: item.netName || '',
          centerX: +(w.x / IU_PER_MM).toFixed(4),
          centerY: +(w.y / IU_PER_MM).toFixed(4),
          layerSide: side,
          padType: dc ? dc.apertureType : '',
          sizeX: dc ? +(dc.size.x / IU_PER_MM).toFixed(4) : 0,
          sizeY: dc ? +(dc.size.y / IU_PER_MM).toFixed(4) : 0,
          dCode: item.dCode,
        },
        rank,
      });
    }
  }
  return Array.from(dedup.values()).map(v => v.info);
}

/** 对位号做自然排序（数字部分按数值），如 R2 < R10 < R100 */
export function naturalRefSort(a: string, b: string): number {
  const ma = a.match(/^([A-Za-z]+)(\d+)$/);
  const mb = b.match(/^([A-Za-z]+)(\d+)$/);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
    return parseInt(ma[2]) - parseInt(mb[2]);
  }
  return a.localeCompare(b);
}

/** 转义 CSV 字段：含逗号/引号/换行则用双引号包裹并转义内部引号 */
function csvField(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 导出贴装坐标(Pick & Place) CSV。
 * 列：Designator, Footprint, CenterX(mm), CenterY(mm), Rotation, Layer, Comment
 */
export function exportPickPlaceCSV(layerManager: LayerManager): string {
  const comps = collectComponents(layerManager);
  const rows = Array.from(comps.values())
    .filter(c => c.padCount > 0)  // 仅导出有焊盘的元件
    .sort((a, b) => naturalRefSort(a.ref, b.ref));
  const header = ['Designator', 'Footprint', 'CenterX(mm)', 'CenterY(mm)', 'Rotation', 'Layer', 'Comment'];
  const lines = [header.map(csvField).join(',')];
  for (const c of rows) {
    const layer = c.layerSide === 'top' ? 'Top' : c.layerSide === 'bottom' ? 'Bottom' : 'Unknown';
    const comment = c.value ? `${c.value}` : '';
    lines.push([
      c.ref, c.footprint, c.centerX, c.centerY, c.rotation, layer, comment,
    ].map(csvField).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * 导出 BOM CSV。按 Footprint+Value+Manufacturer+MPN 聚合。
 * 列：Comment, Designator, Footprint, Value, Manufacturer, MPN, Quantity
 */
export function exportBomCSV(layerManager: LayerManager): string {
  const comps = collectComponents(layerManager);
  // 聚合键：footprint|value|manufacturer|mpn
  interface BomRow {
    designators: string[]; footprint: string; value: string;
    manufacturer: string; mpn: string;
  }
  const groups = new Map<string, BomRow>();
  for (const c of comps.values()) {
    const key = `${c.footprint}|${c.value}|${c.manufacturer}|${c.mpn}`;
    let g = groups.get(key);
    if (!g) {
      g = { designators: [], footprint: c.footprint, value: c.value, manufacturer: c.manufacturer, mpn: c.mpn };
      groups.set(key, g);
    }
    g.designators.push(c.ref);
  }
  const rows = Array.from(groups.values())
    .map(g => ({ ...g, designators: g.designators.sort(naturalRefSort) }))
    .sort((a, b) => {
      // 按 footprint 排序，再按 value
      if (a.footprint !== b.footprint) return a.footprint.localeCompare(b.footprint);
      return a.value.localeCompare(b.value);
    });
  const header = ['Comment', 'Designator', 'Footprint', 'Value', 'Manufacturer', 'MPN', 'Quantity'];
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) {
    const comment = r.value || r.mpn || '';
    lines.push([
      comment,
      r.designators.join(','),
      r.footprint,
      r.value,
      r.manufacturer,
      r.mpn,
      r.designators.length,
    ].map(csvField).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

/** 下载 CSV 文本为文件（带 BOM 头防 Excel 乱码） */
export function downloadCSV(csv: string, filename: string = 'export.csv') {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
