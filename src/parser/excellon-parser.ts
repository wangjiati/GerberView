import { IU_PER_MM, IU_PER_INCH, ShapeType, GerberUnit, ZeroOmission } from '../model/enums';
import { Point, pt, GerberItem, createGerberItem } from '../model/gerber-item';
import { GerberImage, defaultStepAndRepeat } from '../model/gerber-image';
import { KICAD_LAYER_COLORS } from './gerber-parser';

export class ExcellonParser {
  private image!: GerberImage;
  private unit: GerberUnit = GerberUnit.Metric;
  private absoluteCoords: boolean = true;
  private coordFormat = { integer: 3, mantissa: 3 };
  private zeroOmission: ZeroOmission = ZeroOmission.Leading;
  private currentPos: Point = pt(0, 0);
  private currentTool: number = 0;
  private inHeader: boolean = false;
  private drillMode: boolean = true; // true=drill, false=route
  private routeStart: Point = pt(0, 0);
  private routePoints: Point[] = [];

  parse(text: string, fileName: string, layerIndex: number): GerberImage {
    this.image = new GerberImage();
    this.image.fileName = fileName;
    this.image.layerIndex = layerIndex;
    this.unit = GerberUnit.Metric;
    this.absoluteCoords = true;
    this.coordFormat = { integer: 3, mantissa: 3 };
    this.zeroOmission = ZeroOmission.Leading;
    this.currentPos = pt(0, 0);
    this.currentTool = 0;
    this.inHeader = false;
    this.drillMode = true;
    this.routeStart = pt(0, 0);
    this.routePoints = [];

    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      this.processLine(line);
    }

    this.image.color = KICAD_LAYER_COLORS[layerIndex % KICAD_LAYER_COLORS.length];
    this.image.computeBoundingBox();
    return this.image;
  }

  private processLine(line: string) {
    // 注释
    if (line.startsWith(';')) {
      // Altium 格式声明
      const fmtMatch = line.match(/FILE_FORMAT=([\d]+):([\d]+)/i);
      if (fmtMatch) {
        this.coordFormat.integer = parseInt(fmtMatch[1]);
        this.coordFormat.mantissa = parseInt(fmtMatch[2]);
      }
      return;
    }

    // 命令处理
    if (line === 'M48') {
      this.inHeader = true;
      return;
    }
    if (line === 'M95' || line === '%') {
      this.inHeader = false;
      return;
    }
    if (line === 'M30' || line === 'M00') return;

    if (this.inHeader) {
      this.processHeaderLine(line);
      return;
    }

    // 正文
    if (line.startsWith('T')) {
      this.processToolLine(line);
      return;
    }

    // G 代码
    if (line.startsWith('G')) {
      this.processGCode(line);
      return;
    }

    // M 代码
    if (line.startsWith('M')) {
      const mMatch = line.match(/^M(\d+)/);
      if (mMatch) {
        const code = parseInt(mMatch[1]);
        if (code === 71) this.unit = GerberUnit.Metric;
        else if (code === 72) this.unit = GerberUnit.Inch;
        else if (code === 15) {
          // M15: 开始铣削/路由（XNC 格式）
          if (line.includes('X') || line.includes('Y')) this.processCoordLine(line);
        }
        else if (code === 16) {
          // M16: 结束铣削/路由（XNC 格式）
          if (line.includes('X') || line.includes('Y')) this.processCoordLine(line);
          this.finishRoute();
        }
        else if (code === 30 || code === 0) return;
      }
      return;
    }

    // 坐标行（X/Y 数据）
    if (line.includes('X') || line.includes('Y')) {
      this.processCoordLine(line);
    }
  }

  private processHeaderLine(line: string) {
    const upper = line.toUpperCase();

    if (upper.startsWith('METRIC')) {
      this.unit = GerberUnit.Metric;
      const tzMatch = upper.match(/TZ|LZ/);
      if (tzMatch) this.zeroOmission = tzMatch[0] === 'LZ' ? ZeroOmission.Leading : ZeroOmission.Trailing;
      const fmtMatch = upper.match(/(\d)\.(\d)/);
      if (fmtMatch) {
        this.coordFormat.integer = parseInt(fmtMatch[1]);
        this.coordFormat.mantissa = parseInt(fmtMatch[2]);
      }
    } else if (upper.startsWith('INCH')) {
      this.unit = GerberUnit.Inch;
      const tzMatch = upper.match(/TZ|LZ/);
      if (tzMatch) this.zeroOmission = tzMatch[0] === 'LZ' ? ZeroOmission.Leading : ZeroOmission.Trailing;
    } else if (upper.startsWith('FMAT')) {
      const fmtMatch = line.match(/FMAT\s*(\d)/i);
      if (fmtMatch) {
        const f = parseInt(fmtMatch[1]);
        if (f === 1) { this.coordFormat = { integer: 3, mantissa: 3 }; }
        else if (f === 2) { this.coordFormat = { integer: 2, mantissa: 4 }; }
      }
    } else if (line.startsWith('T')) {
      // 头部刀具定义
      this.processToolDef(line);
    }
  }

  private processToolLine(line: string) {
    // T 命令：可能是刀具定义或刀具选择
    const toolDefMatch = line.match(/^T(\d+)C([0-9.]+)/i);
    if (toolDefMatch) {
      // 刀具定义（可能在正文出现）
      this.processToolDef(line);
      return;
    }
    // 刀具选择
    const toolMatch = line.match(/^T(\d+)/);
    if (toolMatch) {
      this.currentTool = parseInt(toolMatch[1]);
    }
  }

  private processToolDef(line: string) {
    // T1C0.02 或 T1F00S00C0.02
    const match = line.match(/^T(\d+)(?:[FS]\d*)*C([0-9.]+)/i);
    if (!match) return;
    const toolNum = parseInt(match[1]);
    const diameter = parseFloat(match[2]);
    if (isNaN(diameter)) return;

    // 创建 DCode 对应刀具
    const dc = this.image.getDCcode(toolNum);
    dc.numDcode = toolNum;
    dc.defined = true;
    dc.inUse = true;
    dc.apertureType = 'C' as any; // Circle
    const diameterNm = this.unit === GerberUnit.Inch ? diameter * IU_PER_INCH : diameter * IU_PER_MM;
    dc.size = pt(diameterNm, diameterNm);
  }

  private processGCode(line: string) {
    const match = line.match(/^G(\d+)/);
    if (!match) return;
    const code = parseInt(match[1]);
    switch (code) {
      case 0: // 路由模式
        this.drillMode = false;
        // G00 可带坐标，先解析坐标再初始化路由
        if (line.includes('X') || line.includes('Y')) this.processCoordLine(line.substring(line.indexOf('X') > -1 ? line.indexOf('X') : line.indexOf('Y')));
        this.routeStart = { ...this.currentPos };
        this.routePoints = [{ ...this.currentPos }];
        break;
      case 1: // 线性路由
        // G01 可带坐标
        if (line.includes('X') || line.includes('Y')) this.processCoordLine(line.substring(line.indexOf('X') > -1 ? line.indexOf('X') : line.indexOf('Y')));
        this.routePoints.push({ ...this.currentPos });
        break;
      case 2: // CW 圆弧路由
      case 3: // CCW 圆弧路由
        // 简化：解析坐标后按直线处理
        if (line.includes('X') || line.includes('Y')) this.processCoordLine(line.substring(line.indexOf('X') > -1 ? line.indexOf('X') : line.indexOf('Y')));
        this.routePoints.push({ ...this.currentPos });
        break;
      case 5: // 回到钻孔模式
        this.finishRoute();
        this.drillMode = true;
        break;
      case 85: // 槽孔
        this.processSlot(line);
        break;
      case 90: this.absoluteCoords = true; break;
      case 91: this.absoluteCoords = false; break;
    }
  }

  private processCoordLine(line: string) {
    let xVal: number | null = null;
    let yVal: number | null = null;

    const xMatch = line.match(/X([-+]?[\d.]+)/i);
    const yMatch = line.match(/Y([-+]?[\d.]+)/i);

    if (xMatch) xVal = this.parseExcellonCoord(xMatch[1]);
    if (yMatch) yVal = this.parseExcellonCoord(yMatch[1]);

    if (xVal !== null) this.currentPos.x = xVal;
    if (yVal !== null) this.currentPos.y = yVal;

    if (this.drillMode) {
      // 钻孔模式：当前位置是一个钻孔点
      this.createDrillHit();
    } else {
      // 路由模式：记录路径点
      this.routePoints.push({ ...this.currentPos });
    }
  }

  private parseExcellonCoord(str: string): number {
    // 检查是否有显式小数点
    if (str.includes('.')) {
      const val = parseFloat(str);
      return this.unit === GerberUnit.Inch ? val * IU_PER_INCH : val * IU_PER_MM;
    }

    // 隐含小数点
    const totalDigits = this.coordFormat.integer + this.coordFormat.mantissa;
    let digits = str.replace(/[+-]/, '');
    const sign = str.startsWith('-') ? -1 : 1;

    if (this.zeroOmission === ZeroOmission.Leading) {
      while (digits.length < totalDigits) digits = '0' + digits;
    } else {
      while (digits.length < totalDigits) digits = digits + '0';
    }

    const intPart = digits.substring(0, this.coordFormat.integer);
    const fracPart = digits.substring(this.coordFormat.integer);
    const val = parseFloat(intPart + '.' + fracPart) * sign;
    return this.unit === GerberUnit.Inch ? val * IU_PER_INCH : val * IU_PER_MM;
  }

  private createDrillHit() {
    const dc = this.image.getDCcode(this.currentTool);
    if (!dc.defined) return;

    const item = createGerberItem(this.image.layerIndex);
    item.shapeType = ShapeType.SpotCircle;
    item.flashed = true;
    item.start = { ...this.currentPos };
    item.end = { ...this.currentPos };
    item.size = { ...dc.size };
    item.dCode = this.currentTool;
    this.image.items.push(item);
  }

  private processSlot(line: string) {
    // G85 X... Y... — 在当前位置和指定位置之间铣槽
    const dc = this.image.getDCcode(this.currentTool);
    if (!dc.defined) return;

    // 槽 — 用矩形表示
    const xMatch = line.match(/X([-+]?[\d.]+)/i);
    const yMatch = line.match(/Y([-+]?[\d.]+)/i);
    let endX = this.currentPos.x, endY = this.currentPos.y;
    if (xMatch) endX = this.parseExcellonCoord(xMatch[1]);
    if (yMatch) endY = this.parseExcellonCoord(yMatch[1]);

    // 画一条线段表示槽
    const item = createGerberItem(this.image.layerIndex);
    item.shapeType = ShapeType.Segment;
    item.start = { ...this.currentPos };
    item.end = pt(endX, endY);
    item.size = { ...dc.size };
    item.dCode = this.currentTool;
    this.image.items.push(item);

    this.currentPos = pt(endX, endY);
  }

  private finishRoute() {
    if (this.routePoints.length < 2) return;
    const dc = this.image.getDCcode(this.currentTool);
    if (!dc.defined) return;

    // 路由路径 — 用线段序列表示
    for (let i = 1; i < this.routePoints.length; i++) {
      const item = createGerberItem(this.image.layerIndex);
      item.shapeType = ShapeType.Segment;
      item.start = { ...this.routePoints[i - 1] };
      item.end = { ...this.routePoints[i] };
      item.size = { ...dc.size };
      item.dCode = this.currentTool;
      this.image.items.push(item);
    }
    this.routePoints = [];
  }
}

// 检测是否为 Excellon 钻孔文件
export function detectExcellonFile(text: string): boolean {
  const sample = text.substring(0, 5000);
  const upper = sample.toUpperCase();

  // M48 是最明确的 Excellon 标识
  if (/\bM48\b/.test(upper)) return true;

  // 检查是否有 T 刀具和 X/Y 坐标但不包含 Gerber 标识
  const hasT = /\bT\d+\b/.test(sample);
  const hasXY = /X\d+.*Y\d+|Y\d+.*X\d+/.test(sample);
  const hasGerber = /%ADD|%FS|%AM|%MO|%IP|%LP/.test(sample);

  if (hasT && hasXY && !hasGerber) return true;

  return false;
}
