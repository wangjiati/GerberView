import {
  GerberUnit, ZeroOmission, Interpolation, Polarity, LayerPolarity,
  ArcQuadrantMode, ShapeType, ApertureType, DrillShape,
  MacroPrimitiveId, ParamItemType, IU_PER_MM, IU_PER_INCH,
} from '../model/enums';
import { Point, pt, GerberItem, createGerberItem } from '../model/gerber-item';
import {
  GerberImage, CoordFormat, StepAndRepeat, defaultStepAndRepeat,
} from '../model/gerber-image';
import { DCode, ApertureMacro, AmPrimitive, AmParam } from './aperture';

// 默认 KiCad 图层颜色（与 KiCad 一致）
export const KICAD_LAYER_COLORS: string[] = [
  '#858585', '#00B900', '#DDDD00', '#C40000',
  '#0000C4', '#C400C4', '#00C4C4', '#E0E0E0',
  '#424242', '#006F00', '#9E9E00', '#8E0000',
  '#00008E', '#8E008E', '#008E8E', '#BABABA',
  '#595959', '#004E00', '#707000', '#620000',
  '#000062', '#620062', '#006262', '#929292',
  '#707070', '#003000', '#505000', '#440000',
  '#000044', '#440044', '#004444', '#646464',
];

export class GerberParser {
  private image!: GerberImage;

  // 解析状态
  private unit: GerberUnit = GerberUnit.Metric;
  private coordFormat: CoordFormat = { integerDigits: 3, mantissaDigits: 3 };
  private zeroOmission: ZeroOmission = ZeroOmission.Leading;
  private absoluteCoords: boolean = true;
  private interpolation: Interpolation = Interpolation.Linear;
  private arcQuadrantMode: ArcQuadrantMode = ArcQuadrantMode.Multi;
  private polygonFillMode: boolean = false;
  private polygonPoints: Point[] = [];
  private polygonItemCount: number = 0;

  // 当前坐标状态
  private currentPos: Point = pt(0, 0);
  private previousPos: Point = pt(0, 0);
  private ijPos: Point = pt(0, 0);
  private hadIJCoord: boolean = false; // 当前行是否包含 I/J 数据

  // 当前工具和曝光
  private currentTool: number = 0;
  private lastPenCommand: number = 0; // 1=D01, 2=D02, 3=D03

  // 变换状态快照（解析时每项拷贝）
  private swapAxis: boolean = false;
  private mirrorA: boolean = false;
  private mirrorB: boolean = false;
  private scale: Point = pt(1, 1);
  private layerOffset: Point = pt(0, 0);
  private localRotation: number = 0;
  private layerPolarityClear: boolean = false;
  private stepAndRepeat: StepAndRepeat = defaultStepAndRepeat();

  // 当前光圈功能
  private aperFunction: string = '';

  // 当前 X2 属性
  private currentNetAttrs: string[] = [];
  private currentNetName: string = '';
  private currentCompRef: string = '';

  // 缓冲区
  private line: string = '';
  private pos: number = 0;

  parse(text: string, fileName: string, layerIndex: number): GerberImage {
    this.image = new GerberImage();
    this.image.fileName = fileName;
    this.image.layerIndex = layerIndex;

    // 重置解析状态
    this.unit = GerberUnit.Metric;
    this.coordFormat = { integerDigits: 3, mantissaDigits: 3 };
    this.zeroOmission = ZeroOmission.Leading;
    this.absoluteCoords = true;
    this.interpolation = Interpolation.Linear;
    this.arcQuadrantMode = ArcQuadrantMode.Multi;
    this.polygonFillMode = false;
    this.polygonPoints = [];
    this.polygonItemCount = 0;
    this.currentPos = pt(0, 0);
    this.previousPos = pt(0, 0);
    this.ijPos = pt(0, 0);
    this.currentTool = 0;
    this.lastPenCommand = 0;
    this.swapAxis = false;
    this.mirrorA = false;
    this.mirrorB = false;
    this.scale = pt(1, 1);
    this.layerOffset = pt(0, 0);
    this.localRotation = 0;
    this.layerPolarityClear = false;
    this.stepAndRepeat = defaultStepAndRepeat();
    this.aperFunction = '';
    this.currentNetAttrs = [];

    // 预处理：将整个文本中的 %...% 块提取出来并合并为单行
    // Gerber 文件中 % 开头的行可能跨多行（如光圈宏 %AM...%）
    const tokens = this.tokenize(text);
    for (const token of tokens) {
      if (token.type === 'block') {
        // %...% 块：提取命令 ID 和内容
        this.processBlock(token.content);
      } else {
        // 普通行
        this.line = token.content;
        this.pos = 0;
        this.hadIJCoord = false;
        this.ijPos = pt(0, 0);
        this.processDataLine();
      }
    }

    this.image.color = KICAD_LAYER_COLORS[layerIndex % KICAD_LAYER_COLORS.length];
    this.image.computeBoundingBox();
    return this.image;
  }

  // 将 Gerber 文本拆分为 token 序列
  private tokenize(text: string): Array<{ type: 'block' | 'data'; content: string }> {
    const tokens: Array<{ type: 'block' | 'data'; content: string }> = [];
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    let blockContent = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) continue;

      if (!inBlock) {
        // 不在块中 — 寻找 % 开始
        const startIdx = line.indexOf('%');
        if (startIdx === -1) {
          // 没有百分号，普通数据行
          tokens.push({ type: 'data', content: line });
          continue;
        }

        // 找到 % 开始，看看同一行是否也结束
        const rest = line.substring(startIdx + 1);
        const endIdx = rest.indexOf('%');

        if (endIdx !== -1) {
          // 单行 %...% 块
          tokens.push({ type: 'block', content: rest.substring(0, endIdx) });
          // 如果 %...% 后面还有内容（罕见但可能）
          const after = rest.substring(endIdx + 1).trim();
          if (after.length > 0) {
            tokens.push({ type: 'data', content: after });
          }
        } else {
          // 多行块开始
          inBlock = true;
          blockContent = rest;
        }
      } else {
        // 在块中 — 寻找 % 结束
        const endIdx = line.indexOf('%');
        if (endIdx !== -1) {
          // 块结束
          blockContent += '*' + line.substring(0, endIdx);
          tokens.push({ type: 'block', content: blockContent });
          blockContent = '';
          inBlock = false;
          // % 后面的内容
          const after = line.substring(endIdx + 1).trim();
          if (after.length > 0) {
            tokens.push({ type: 'data', content: after });
          }
        } else {
          // 块内容继续
          blockContent += '*' + line;
        }
      }
    }

    // 未完成的块
    if (inBlock && blockContent.length > 0) {
      tokens.push({ type: 'block', content: blockContent });
    }

    return tokens;
  }

  // 处理 %...% 块
  private processBlock(content: string) {
    // 提取命令 ID（前两个字母）
    const cleaned = content.replace(/^\s+/, '');
    if (cleaned.length < 2) return;

    const cmdId = cleaned.substring(0, 2).toUpperCase();
    const body = cleaned.substring(2);

    this.executeRS274XCommand(cmdId, body);
  }

  // 处理普通数据行（G/D/X/Y/I/J/M 命令）
  private processDataLine() {
    while (this.pos < this.line.length) {
      const ch = this.line[this.pos];

      if (ch === '%') {
        // 行内 % 命令（不太常见但有可能）
        this.pos++;
        // 找到匹配的 %
        let end = this.line.indexOf('%', this.pos);
        if (end === -1) end = this.line.length;
        const blockContent = this.line.substring(this.pos, end);
        this.pos = end + 1;
        this.processBlock(blockContent);
      } else if (ch === 'G') {
        this.pos++;
        this.executeGCode();
      } else if (ch === 'D') {
        this.pos++;
        this.executeDCode();
      } else if (ch === 'X' || ch === 'Y') {
        this.readXYCoord();
      } else if (ch === 'I' || ch === 'J') {
        this.readIJCoord();
      } else if (ch === 'M') {
        this.pos++;
        this.readMCode();
      } else if (ch === '*') {
        this.pos++;
      } else if (ch === ' ' || ch === '\t') {
        this.pos++;
      } else {
        this.pos++;
      }
    }
  }

  // ========== RS-274X 扩展命令 ==========

  private executeRS274XCommand(cmdId: string, body: string) {
    switch (cmdId) {
      case 'FS': this.parseFormatStatement(body); break;
      case 'MO': this.parseModeOfUnits(body); break;
      case 'AD': this.parseApertureDefinition(body); break;
      case 'AM': this.parseApertureMacro(body); break;
      case 'IP': this.parseImagePolarity(body); break;
      case 'LP': this.parseLayerPolarity(body); break;
      case 'SR': this.parseStepAndRepeat(body); break;
      case 'LN': this.image.layerName = body.replace(/\*/g, ''); break;
      case 'OF': this.parseOffset(body); break;
      case 'SF': this.parseScaleFactor(body); break;
      case 'IO': this.parseImageOffset(body); break;
      case 'IR': this.parseImageRotation(body); break;
      case 'MI': this.parseMirrorImage(body); break;
      case 'AS': this.parseAxisSelect(body); break;
      case 'IC': break; // Image Justify - 简化处理
      case 'IJ': break; // Image Justify
      case 'RO': this.parseRotation(body); break;
      case 'TF': this.parseFileAttribute(body); break;
      case 'TA': this.parseApertureAttribute(body); break;
      case 'TO': this.parseObjectAttribute(body); break;
      case 'TD': this.aperFunction = ''; this.currentNetAttrs = []; this.currentNetName = ''; this.currentCompRef = ''; break;
    }
  }

  private parseFormatStatement(body: string) {
    // 格式: FS LA X23 Y23
    // L=前导零省略, T=后尾零省略
    // A=绝对坐标, I=相对坐标
    // Xnm Ynm = X和Y的整数/小数位数
    let i = 0;
    while (i < body.length) {
      const ch = body[i];
      switch (ch) {
        case 'L': this.zeroOmission = ZeroOmission.Leading; i++; break;
        case 'T': this.zeroOmission = ZeroOmission.Trailing; i++; break;
        case 'A': this.absoluteCoords = true; i++; break;
        case 'I': this.absoluteCoords = false; i++; break;
        case 'X': {
          i++;
          const xFmt = this.readCoordFormatSpec(body, i);
          this.coordFormat.integerDigits = xFmt.integer;
          this.coordFormat.mantissaDigits = xFmt.mantissa;
          i = xFmt.endPos;
          break;
        }
        case 'Y': {
          i++;
          const yFmt = this.readCoordFormatSpec(body, i);
          // 如果X没设则用Y，一般X和Y相同
          this.coordFormat.integerDigits = this.coordFormat.integerDigits || yFmt.integer;
          this.coordFormat.mantissaDigits = this.coordFormat.mantissaDigits || yFmt.mantissa;
          i = yFmt.endPos;
          break;
        }
        default: i++; break;
      }
    }
  }

  private readCoordFormatSpec(s: string, start: number): { integer: number; mantissa: number; endPos: number } {
    let i = start;
    // 读取格式如 "44" 表示 4 位整数 + 4 位小数
    const d1 = s[i] >= '0' && s[i] <= '9' ? parseInt(s[i]) : 3;
    i++;
    const d2 = i < s.length && s[i] >= '0' && s[i] <= '9' ? parseInt(s[i]) : 3;
    i++;
    return { integer: d1, mantissa: d2, endPos: i };
  }

  private parseModeOfUnits(body: string) {
    if (body.includes('IN')) this.unit = GerberUnit.Inch;
    else if (body.includes('MM')) this.unit = GerberUnit.Metric;
  }

  private parseImagePolarity(body: string) {
    if (body.includes('POS')) this.image.imagePolarity = Polarity.Positive;
    else if (body.includes('NEG')) this.image.imagePolarity = Polarity.Negative;
  }

  private parseLayerPolarity(body: string) {
    if (body.includes('D')) this.layerPolarityClear = false;
    else if (body.includes('C')) this.layerPolarityClear = true;
  }

  private parseStepAndRepeat(body: string) {
    // 格式: SR X3 Y2 I5.0 J2
    const vals = this.extractParamValues(body);
    this.stepAndRepeat.countX = vals.X ?? 1;
    this.stepAndRepeat.countY = vals.Y ?? 1;
    const iVal = vals.I ?? 0;
    const jVal = vals.J ?? 0;
    this.stepAndRepeat.distX = this.convertToNm(iVal);
    this.stepAndRepeat.distY = this.convertToNm(jVal);
    this.image.stepAndRepeat = { ...this.stepAndRepeat };
  }

  private parseOffset(body: string) {
    const vals = this.extractParamValues(body);
    const a = vals.A ?? 0;
    const b = vals.B ?? 0;
    this.layerOffset = pt(this.convertToNm(a), this.convertToNm(b));
    this.image.offset = { ...this.layerOffset };
  }

  private parseScaleFactor(body: string) {
    const vals = this.extractParamValues(body);
    this.scale = pt(vals.A ?? 1, vals.B ?? 1);
    this.image.scale = { ...this.scale };
  }

  private parseImageOffset(body: string) {
    const vals = this.extractParamValues(body);
    const a = vals.A ?? 0;
    const b = vals.B ?? 0;
    this.image.imageOffset = pt(this.convertToNm(a), this.convertToNm(b));
  }

  private parseImageRotation(body: string) {
    const val = parseFloat(body);
    if (!isNaN(val)) {
      this.image.imageRotation = val;
    }
  }

  private parseMirrorImage(body: string) {
    const vals = this.extractParamValues(body);
    this.mirrorA = (vals.A ?? 0) === 1;
    this.mirrorB = (vals.B ?? 0) === 1;
    this.image.mirrorA = this.mirrorA;
    this.image.mirrorB = this.mirrorB;
  }

  private parseAxisSelect(body: string) {
    if (body.includes('AXBY')) this.swapAxis = false;
    else if (body.includes('AYBX')) this.swapAxis = true;
    this.image.swapAxis = this.swapAxis;
  }

  private parseRotation(body: string) {
    const val = parseFloat(body);
    if (!isNaN(val)) {
      this.localRotation = val;
      this.image.localRotation = val;
    }
  }

  private parseFileAttribute(body: string) {
    // %TF.FileFunction,Copper,L1,Top*% 等
    const parts = body.split(',');
    if (parts.length > 0) {
      const func = parts[0];
      this.image.fileFunction = body;
      if (func === '.FileFunction' && parts.length > 1) {
        // 存储文件功能信息
      }
    }
  }

  private parseApertureAttribute(body: string) {
    // %TA.AperFunction,ComponentPad*%
    const parts = body.split(',');
    if (parts.length > 0 && parts[0].startsWith('.AperFunction')) {
      this.aperFunction = parts.slice(1).join(',');
    }
  }

  private parseObjectAttribute(body: string) {
    const parts = body.split(',');
    if (parts.length > 0) {
      const type = parts[0];
      if (type === '.N' && parts.length > 1) {
        this.currentNetName = parts[1];
        this.image.netNames.add(parts[1]);
      } else if (type === '.C' && parts.length > 1) {
        this.currentCompRef = parts[1];
        this.image.componentRefs.add(parts[1]);
      }
    }
    this.currentNetAttrs.push(body);
  }

  // ========== 光圈定义解析 ==========

  private parseApertureDefinition(body: string) {
    // 格式: ADD10C,0.065 或 ADD11MACRONAME,0.5X1X0
    const dCodeMatch = body.match(/^(\d+)(.*)/);
    if (!dCodeMatch) return;

    const dCodeNum = parseInt(dCodeMatch[1]);
    if (isNaN(dCodeNum) || dCodeNum < 10) return;

    const rest = dCodeMatch[2];
    const dc = this.image.getDCcode(dCodeNum);
    dc.numDcode = dCodeNum;
    dc.defined = true;

    // 确定光圈类型
    if (rest.length === 0) return;

    const typeChar = rest[0].toUpperCase();
    const paramsStr = rest.substring(1);

    if (typeChar === 'C') {
      dc.apertureType = ApertureType.Circle;
      this.parseCircleAperture(dc, paramsStr);
    } else if (typeChar === 'R') {
      dc.apertureType = ApertureType.Rect;
      this.parseRectAperture(dc, paramsStr);
    } else if (typeChar === 'O') {
      dc.apertureType = ApertureType.Oval;
      this.parseOvalAperture(dc, paramsStr);
    } else if (typeChar === 'P') {
      dc.apertureType = ApertureType.Polygon;
      this.parsePolygonAperture(dc, paramsStr);
    } else {
      // 光圈宏引用
      dc.apertureType = ApertureType.Macro;
      this.parseMacroAperture(dc, rest);
    }

    // 复制当前光圈功能
    dc.macroParams = [...(dc.macroParams || [])];
  }

  private parseCircleAperture(dc: DCode, params: string) {
    const vals = this.parseApertureParams(params);
    const diameter = vals[0] ?? 0;
    dc.size = pt(this.convertToNm(diameter), this.convertToNm(diameter));
    if (vals.length >= 3 && vals[1] > 0 && vals[2] > 0) {
      dc.drill = pt(this.convertToNm(vals[1]), this.convertToNm(vals[2]));
      dc.drillShape = DrillShape.RectHole;
    } else if (vals.length >= 2 && vals[1] > 0) {
      dc.drill = pt(this.convertToNm(vals[1]), this.convertToNm(vals[1]));
      dc.drillShape = DrillShape.RoundHole;
    }
  }

  private parseRectAperture(dc: DCode, params: string) {
    const vals = this.parseApertureParams(params);
    dc.size = pt(this.convertToNm(vals[0] ?? 0), this.convertToNm(vals[1] ?? vals[0] ?? 0));
    if (vals.length >= 4 && vals[2] > 0 && vals[3] > 0) {
      dc.drill = pt(this.convertToNm(vals[2]), this.convertToNm(vals[3]));
      dc.drillShape = DrillShape.RectHole;
    } else if (vals.length >= 3 && vals[2] > 0) {
      dc.drill = pt(this.convertToNm(vals[2]), this.convertToNm(vals[2]));
      dc.drillShape = DrillShape.RoundHole;
    }
  }

  private parseOvalAperture(dc: DCode, params: string) {
    const vals = this.parseApertureParams(params);
    dc.size = pt(this.convertToNm(vals[0] ?? 0), this.convertToNm(vals[1] ?? vals[0] ?? 0));
    if (vals.length >= 4 && vals[2] > 0 && vals[3] > 0) {
      dc.drill = pt(this.convertToNm(vals[2]), this.convertToNm(vals[3]));
      dc.drillShape = DrillShape.RectHole;
    } else if (vals.length >= 3 && vals[2] > 0) {
      dc.drill = pt(this.convertToNm(vals[2]), this.convertToNm(vals[2]));
      dc.drillShape = DrillShape.RoundHole;
    }
  }

  private parsePolygonAperture(dc: DCode, params: string) {
    const vals = this.parseApertureParams(params);
    const diameter = vals[0] ?? 0;
    dc.size = pt(this.convertToNm(diameter), this.convertToNm(diameter));
    dc.edgesCount = vals.length >= 2 ? Math.round(vals[1]) : 5;
    dc.rotation = vals.length >= 3 ? vals[2] : 0;
    if (vals.length >= 5 && vals[3] > 0 && vals[4] > 0) {
      dc.drill = pt(this.convertToNm(vals[3]), this.convertToNm(vals[4]));
      dc.drillShape = DrillShape.RectHole;
    } else if (vals.length >= 4 && vals[3] > 0) {
      dc.drill = pt(this.convertToNm(vals[3]), this.convertToNm(vals[3]));
      dc.drillShape = DrillShape.RoundHole;
    }
  }

  private parseMacroAperture(dc: DCode, rest: string) {
    // 格式: MACRONAME,param1Xparam2Xparam3
    const commaIdx = rest.indexOf(',');
    const macroName = commaIdx >= 0 ? rest.substring(0, commaIdx) : rest;
    const paramsStr = commaIdx >= 0 ? rest.substring(commaIdx + 1) : '';

    dc.macro = this.image.getApertureMacro(macroName) ?? null;
    dc.macroParams = paramsStr.length > 0
      ? paramsStr.split('X').map(v => parseFloat(v))
      : [];
  }

  private parseApertureParams(params: string): number[] {
    if (!params || params.length === 0) return [];
    // 用 X 分隔参数
    return params.split('X').map(v => parseFloat(v)).filter(v => !isNaN(v));
  }

  // ========== 光圈宏解析 ==========

  private parseApertureMacro(body: string) {
    // 格式: AMCIRCLE*1,1,$1,0,0*
    // body 包含名称，后续行直到 % 是宏内容
    // 由于我们在单行处理中调用，需要特殊处理多行宏
    // 在 readRS274XCommand 中已经处理了 %AM...% 格式
    // 这里 body 是完整的宏定义（名称 + 图元）
    const starIdx = body.indexOf('*');
    if (starIdx === -1) return;

    const macroName = body.substring(0, starIdx);
    const macroBody = body.substring(starIdx + 1);

    const macro = new ApertureMacro();
    macro.name = macroName;

    // 按 * 分隔图元
    const primitives = macroBody.split('*');
    for (const primStr of primitives) {
      const trimmed = primStr.trim();
      if (trimmed.length === 0) continue;

      // 检查是否为本地参数定义 ($4=$3/2)
      if (trimmed.startsWith('$')) {
        this.parseMacroLocalParam(macro, trimmed);
        continue;
      }

      this.parseMacroPrimitive(macro, trimmed);
    }

    this.image.setApertureMacro(macro);
  }

  private parseMacroLocalParam(macro: ApertureMacro, str: string) {
    // $4=$3/2
    const eqIdx = str.indexOf('=');
    if (eqIdx === -1) return;
    const paramIdx = parseInt(str.substring(1, eqIdx));
    if (isNaN(paramIdx)) return;
    const expr = str.substring(eqIdx + 1);
    const param = new AmParam();
    this.parseParamExpr(param, expr);
    macro.localParams.set(paramIdx, param);
  }

  private parseMacroPrimitive(macro: ApertureMacro, str: string) {
    const parts = str.split(',');
    if (parts.length === 0) return;

    const code = parseInt(parts[0]);
    if (isNaN(code)) return;

    let primId: MacroPrimitiveId;
    switch (code) {
      case 0: primId = MacroPrimitiveId.Comment; return;
      case 1: primId = MacroPrimitiveId.Circle; break;
      case 2: primId = MacroPrimitiveId.Line2; break;
      case 4: primId = MacroPrimitiveId.Outline; break;
      case 5: primId = MacroPrimitiveId.Polygon5; break;
      case 6: primId = MacroPrimitiveId.Moire; break;
      case 7: primId = MacroPrimitiveId.Thermal; break;
      case 20: primId = MacroPrimitiveId.Line20; break;
      case 21: primId = MacroPrimitiveId.LineCenter; break;
      case 22: primId = MacroPrimitiveId.LineLowerLeft; break;
      default: return;
    }

    const prim = new AmPrimitive(primId);
    for (let i = 1; i < parts.length; i++) {
      const param = new AmParam();
      this.parseParamExpr(param, parts[i].trim());
      prim.params.push(param);
    }

    // 第一个参数通常是曝光标志
    if (prim.params.length > 0 && prim.params[0].isImmediate()) {
      prim.exposureOn = prim.params[0].evaluate([]) !== 0;
    }

    macro.primitives.push(prim);
  }

  private parseParamExpr(param: AmParam, expr: string) {
    // Shunting-yard 算法：支持括号、一元负号、运算符优先级
    type Token = { type: 'num'; val: number } | { type: 'param'; idx: number } | { type: 'op'; op: ParamItemType; prec: number; unary?: boolean } | { type: 'lparen' } | { type: 'rparen' };

    // 1. 词法分析
    const tokens: Token[] = [];
    let i = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }

      if (ch === '$') {
        i++;
        let ns = '';
        while (i < expr.length && expr[i] >= '0' && expr[i] <= '9') ns += expr[i++];
        const idx = parseInt(ns);
        if (!isNaN(idx)) tokens.push({ type: 'param', idx });
      } else if ((ch >= '0' && ch <= '9') || ch === '.') {
        let ns = '';
        while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) ns += expr[i++];
        const val = parseFloat(ns);
        if (!isNaN(val)) tokens.push({ type: 'num', val });
      } else if (ch === '(') {
        tokens.push({ type: 'lparen' }); i++;
      } else if (ch === ')') {
        tokens.push({ type: 'rparen' }); i++;
      } else if (ch === '+' || ch === '-' || ch === 'x' || ch === 'X' || ch === '*' || ch === '/') {
        // 区分一元和二元运算符
        const isUnary = tokens.length === 0 ||
          (tokens[tokens.length - 1].type === 'op') ||
          (tokens[tokens.length - 1].type === 'lparen');
        if (isUnary && ch === '-') {
          // 一元负号：读取后面紧跟的数字
          i++;
          if (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.' || expr[i] === '$')) {
            if (expr[i] === '$') {
              // -$n
              i++;
              let ns = '';
              while (i < expr.length && expr[i] >= '0' && expr[i] <= '9') ns += expr[i++];
              const idx = parseInt(ns);
              if (!isNaN(idx)) {
                tokens.push({ type: 'param', idx });
                tokens.push({ type: 'op', op: ParamItemType.Negate, prec: 0, unary: true });
              }
            } else {
              let ns = '-';
              while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) ns += expr[i++];
              const val = parseFloat(ns);
              if (!isNaN(val)) tokens.push({ type: 'num', val });
            }
          } else {
            tokens.push({ type: 'op', op: ParamItemType.Negate, prec: 0, unary: true });
          }
        } else if (isUnary && ch === '+') {
          i++; // 一元正号忽略
        } else {
          // 二元运算符
          const op = ch === '+' ? ParamItemType.Add : ch === '-' ? ParamItemType.Sub
            : (ch === 'x' || ch === 'X' || ch === '*') ? ParamItemType.Mul : ParamItemType.Div;
          const prec = (op === ParamItemType.Add || op === ParamItemType.Sub) ? 1 : 2;
          tokens.push({ type: 'op', op, prec });
          i++;
        }
      } else {
        i++;
      }
    }

    // 2. Shunting-yard：中缀 → 后缀（直接写入 param 的 items 栈）
    const opStack: Token[] = [];
    const output: Token[] = [];

    for (const tok of tokens) {
      if (tok.type === 'num' || tok.type === 'param') {
        output.push(tok);
      } else if (tok.type === 'op') {
        while (opStack.length > 0) {
          const top = opStack[opStack.length - 1];
          if (top.type === 'op' && ((top.unary ? 0 : top.prec) >= (tok.unary ? 0 : tok.prec))) {
            output.push(opStack.pop()!);
          } else break;
        }
        opStack.push(tok);
      } else if (tok.type === 'lparen') {
        opStack.push(tok);
      } else if (tok.type === 'rparen') {
        while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'lparen') {
          output.push(opStack.pop()!);
        }
        if (opStack.length > 0) opStack.pop(); // 弹出左括号
      }
    }
    while (opStack.length > 0) output.push(opStack.pop()!);

    // 3. 将后缀 tokens 转为 param items
    for (const tok of output) {
      if (tok.type === 'num') param.pushValue(tok.val);
      else if (tok.type === 'param') param.pushParam(tok.idx);
      else if (tok.type === 'op') param.pushOp(tok.op);
    }
  }

  // ========== G 代码处理 ==========

  private executeGCode() {
    const num = this.readNumber();
    switch (num) {
      case 1: this.interpolation = Interpolation.Linear; break;
      case 2: this.interpolation = Interpolation.ArcCW; break;
      case 3: this.interpolation = Interpolation.ArcCCW; break;
      case 4: {
        // G04 注释 — 也可能是 X2 结构化注释 (G04 #@! ...)
        const rest = this.line.substring(this.pos);
        const scMatch = rest.match(/^#\@!\s*(.+)/);
        if (scMatch) {
          // 结构化注释，当作 % 块处理
          const scBody = scMatch[1].replace(/\*$/, '').trim();
          if (scBody.length >= 2) {
            const cmdId = scBody.substring(0, 2).toUpperCase();
            const cmdBody = scBody.substring(2);
            this.executeRS274XCommand(cmdId, cmdBody);
          }
        }
        break;
      }
      case 36: // 开始区域填充
        this.polygonFillMode = true;
        this.polygonPoints = [];
        this.polygonItemCount = 0;
        break;
      case 37: // 结束区域填充
        if (this.polygonFillMode && this.polygonPoints.length >= 3) {
          this.createPolygonItem();
        }
        this.polygonFillMode = false;
        this.polygonPoints = [];
        break;
      case 54: // 选择工具（已弃用，下一个 D 代码是工具号）
        break;
      case 70: this.unit = GerberUnit.Inch; break;
      case 71: this.unit = GerberUnit.Metric; break;
      case 74: this.arcQuadrantMode = ArcQuadrantMode.Single; this.interpolation = Interpolation.Linear; break;
      case 75: this.arcQuadrantMode = ArcQuadrantMode.Multi; break;
      case 90: this.absoluteCoords = true; break;
      case 91: this.absoluteCoords = false; break;
    }
  }

  // ========== D 代码处理 ==========

  private executeDCode() {
    const num = this.readNumber();
    if (num >= 10) {
      // 工具选择
      this.currentTool = num;
      this.image.getDCcode(num).inUse = true;
      return;
    }

    switch (num) {
      case 1: // 画线（曝光开）
        this.executeD01();
        break;
      case 2: // 移动（曝光关）
        this.executeD02();
        break;
      case 3: // 闪光
        this.executeD03();
        break;
    }
  }

  private executeD01() {
    // D01 - 画线或圆弧
    if (this.polygonFillMode) {
      // 在区域模式下，添加点
      if (this.polygonPoints.length === 0) {
        this.polygonPoints.push({ ...this.previousPos });
      }
      // 判断是否为弧（有 IJ 数据且插补为弧模式）
      if (this.interpolation !== Interpolation.Linear && this.hadIJCoord) {
        // 将弧细分为多段直线
        const arcPts = this.tessellateArc(this.previousPos, this.currentPos);
        for (const p of arcPts) this.polygonPoints.push(p);
      } else {
        this.polygonPoints.push({ ...this.currentPos });
      }
      this.polygonItemCount++;
    } else {
      // 创建线段或圆弧项
      if (this.interpolation === Interpolation.Linear || !this.hadIJCoord) {
        // 无 IJ 数据时回退为线段（KiCad: m_LastCoordIsIJPos 检查）
        this.createLineItem();
      } else {
        this.createArcItem();
      }
    }
    this.previousPos = { ...this.currentPos };
    this.lastPenCommand = 1;
  }

  // 将弧细分为多段直线点（用于多边形填充模式下的弧）
  private tessellateArc(start: Point, end: Point): Point[] {
    let icx = this.ijPos.x;
    let icy = this.ijPos.y;
    if (this.arcQuadrantMode === ArcQuadrantMode.Single) {
      icx = this.computeSingleQuadrantIC(icx, icy);
      icy = this.computeSingleQuadrantJC(icx, icy);
    }
    const cx = start.x + icx;
    const cy = start.y + icy;

    const dx1 = start.x - cx, dy1 = start.y - cy;
    const dx2 = end.x - cx, dy2 = end.y - cy;
    const r = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    if (r < 1) return [{ ...end }];

    const startAngle = Math.atan2(dy1, dx1);
    const endAngle = Math.atan2(dy2, dx2);

    // 计算弧角度跨度
    let sweep = endAngle - startAngle;
    const isCW = this.interpolation === Interpolation.ArcCW;
    if (isCW) {
      // CW: 角度递减
      if (sweep > 0) sweep -= Math.PI * 2;
      if (this.arcQuadrantMode === ArcQuadrantMode.Single && sweep < -Math.PI) sweep += Math.PI * 2;
    } else {
      // CCW: 角度递增
      if (sweep < 0) sweep += Math.PI * 2;
      if (this.arcQuadrantMode === ArcQuadrantMode.Single && sweep > Math.PI) sweep -= Math.PI * 2;
    }

    // 细分段数：每 5° 一段，至少 4 段
    const absSweep = Math.abs(sweep);
    const segments = Math.max(4, Math.ceil(absSweep / (Math.PI / 36)));

    const pts: Point[] = [];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const angle = startAngle + sweep * t;
      pts.push(pt(cx + r * Math.cos(angle), cy + r * Math.sin(angle)));
    }
    return pts;
  }

  private executeD02() {
    // D02 - 移动（不画）
    if (this.polygonFillMode && this.polygonPoints.length > 0) {
      // 在区域模式下的 D02 通常表示新起点
      // KiCad 行为：如果之前没有 D01，则只设置起点
    }
    this.previousPos = { ...this.currentPos };
    this.lastPenCommand = 2;
  }

  private executeD03() {
    // D03 - 闪光
    if (this.polygonFillMode) {
      // 不应该发生在区域模式，但以防万一
    } else {
      this.createFlashItem();
    }
    this.previousPos = { ...this.currentPos };
    this.lastPenCommand = 3;
  }

  // ========== 创建绘图项 ==========

  private createLineItem() {
    const dc = this.image.getDCcode(this.currentTool);
    const item = createGerberItem(this.image.layerIndex);
    item.shapeType = ShapeType.Segment;
    item.start = { ...this.previousPos };
    item.end = { ...this.currentPos };
    item.dCode = this.currentTool;
    item.flashed = false;

    // 线宽 = 光圈尺寸
    if (dc.apertureType === ApertureType.Rect) {
      item.size = { ...dc.size };
    } else {
      // 圆形笔，宽度 = 直径
      item.size = pt(dc.size.x, dc.size.x);
    }

    this.applyItemTransform(item);
    this.addItemWithStepAndRepeat(item);
  }

  private createArcItem() {
    const dc = this.image.getDCcode(this.currentTool);
    const item = createGerberItem(this.image.layerIndex);
    item.shapeType = ShapeType.Arc;
    item.interpolation = this.interpolation;
    item.start = { ...this.previousPos };
    item.end = { ...this.currentPos };

    // 计算 IJ 偏移（单象限模式下需推断符号）
    let icx = this.ijPos.x;
    let icy = this.ijPos.y;

    if (this.arcQuadrantMode === ArcQuadrantMode.Single) {
      // 单象限模式：I/J 是无符号绝对值，需根据起终点推断符号
      icx = this.computeSingleQuadrantIC(icx, icy);
      icy = this.computeSingleQuadrantJC(icx, icy);
    }

    // 圆心 = 起点 + IJ 偏移
    item.arcCenter = pt(this.previousPos.x + icx, this.previousPos.y + icy);
    item.dCode = this.currentTool;
    item.flashed = false;
    item.size = pt(dc.size.x, dc.size.x);

    this.applyItemTransform(item);
    this.addItemWithStepAndRepeat(item);
  }

  // 单象限模式：根据弧线方向和起终点推断 IC 的符号
  private computeSingleQuadrantIC(ic: number, jc: number): number {
    const dx = this.currentPos.x - this.previousPos.x;
    const dy = this.currentPos.y - this.previousPos.y;
    const cw = this.interpolation === Interpolation.ArcCW;
    const absIc = Math.abs(ic);

    if (ic === 0 && jc !== 0) {
      // 只有 J，推断 I = sqrt(R² - J²) 或 I = 0
      return 0;
    }

    // 推断 I 的符号
    if (cw) {
      return dx >= 0 ? absIc : -absIc;
    } else {
      return dx >= 0 ? -absIc : absIc;
    }
  }

  // 单象限模式：根据弧线方向和起终点推断 JC 的符号
  private computeSingleQuadrantJC(ic: number, jc: number): number {
    const dx = this.currentPos.x - this.previousPos.x;
    const dy = this.currentPos.y - this.previousPos.y;
    const cw = this.interpolation === Interpolation.ArcCW;
    const absJc = Math.abs(jc);

    if (jc === 0 && ic !== 0) {
      return 0;
    }

    if (cw) {
      return dy >= 0 ? -absJc : absJc;
    } else {
      return dy >= 0 ? absJc : -absJc;
    }
  }

  private createFlashItem() {
    const dc = this.image.getDCcode(this.currentTool);
    const item = createGerberItem(this.image.layerIndex);
    item.flashed = true;
    item.start = { ...this.currentPos };
    item.end = { ...this.currentPos };
    item.dCode = this.currentTool;

    // 根据光圈类型设置形状
    switch (dc.apertureType) {
      case ApertureType.Circle:
        item.shapeType = ShapeType.SpotCircle;
        item.size = { ...dc.size };
        break;
      case ApertureType.Rect:
        item.shapeType = ShapeType.SpotRect;
        item.size = { ...dc.size };
        break;
      case ApertureType.Oval:
        item.shapeType = ShapeType.SpotOval;
        item.size = { ...dc.size };
        break;
      case ApertureType.Polygon:
        item.shapeType = ShapeType.SpotPoly;
        item.size = { ...dc.size };
        break;
      case ApertureType.Macro:
        item.shapeType = ShapeType.SpotMacro;
        item.size = { ...dc.size };
        break;
    }

    this.applyItemTransform(item);
    this.addItemWithStepAndRepeat(item);
  }

  private createPolygonItem() {
    const item = createGerberItem(this.image.layerIndex);
    item.shapeType = ShapeType.Polygon;
    item.polygonPoints = [...this.polygonPoints];
    item.dCode = 0;
    item.flashed = false;

    // 自动关闭多边形
    const first = item.polygonPoints[0];
    const last = item.polygonPoints[item.polygonPoints.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
      item.polygonPoints.push({ ...first });
    }

    this.applyItemTransform(item);
    this.addItemWithStepAndRepeat(item);
  }

  private applyItemTransform(item: GerberItem) {
    item.swapAxis = this.swapAxis;
    item.mirrorA = this.mirrorA;
    item.mirrorB = this.mirrorB;
    item.drawScale = { ...this.scale };
    item.layerOffset = { ...this.layerOffset };
    item.layerRotation = this.localRotation;
    item.layerPolarityClear = this.layerPolarityClear;
    item.aperFunction = this.aperFunction;
    item.netName = this.currentNetName;
    item.componentRef = this.currentCompRef;
    if (this.aperFunction) this.image.aperFunctions.add(this.aperFunction);
  }

  private addItemWithStepAndRepeat(item: GerberItem) {
    const sr = this.stepAndRepeat;
    if (sr.countX <= 1 && sr.countY <= 1) {
      this.image.items.push(item);
    } else {
      // 步进重复：为每个重复创建副本
      for (let iy = 0; iy < sr.countY; iy++) {
        for (let ix = 0; ix < sr.countX; ix++) {
          const dx = ix * sr.distX;
          const dy = iy * sr.distY;
          if (dx === 0 && dy === 0) {
            this.image.items.push(item);
          } else {
            const copy = this.offsetItem(item, dx, dy);
            this.image.items.push(copy);
          }
        }
      }
    }
  }

  private offsetItem(item: GerberItem, dx: number, dy: number): GerberItem {
    const copy = { ...item };
    copy.start = pt(item.start.x + dx, item.start.y + dy);
    copy.end = pt(item.end.x + dx, item.end.y + dy);
    copy.arcCenter = pt(item.arcCenter.x + dx, item.arcCenter.y + dy);
    if (item.polygonPoints.length > 0) {
      copy.polygonPoints = item.polygonPoints.map(p => pt(p.x + dx, p.y + dy));
    }
    return copy;
  }

  // ========== 坐标读取 ==========

  private readXYCoord() {
    while (this.pos < this.line.length) {
      const ch = this.line[this.pos];
      if (ch === 'X') {
        this.pos++;
        this.currentPos.x = this.parseCoordValue(this.currentPos.x);
      } else if (ch === 'Y') {
        this.pos++;
        this.currentPos.y = this.parseCoordValue(this.currentPos.y);
      } else {
        break;
      }
    }
  }

  private readIJCoord() {
    // IJ 偏移在每行开头已重置（Gerber 规范：IJ 是非模态的）
    this.hadIJCoord = true;
    while (this.pos < this.line.length) {
      const ch = this.line[this.pos];
      if (ch === 'I') {
        this.pos++;
        this.ijPos.x = this.parseCoordValue(0);
      } else if (ch === 'J') {
        this.pos++;
        this.ijPos.y = this.parseCoordValue(0);
      } else {
        break;
      }
    }
  }

  private parseCoordValue(currentVal: number): number {
    // 读取带符号的数字字符串
    let sign = 1;
    if (this.pos < this.line.length && this.line[this.pos] === '-') {
      sign = -1;
      this.pos++;
    } else if (this.pos < this.line.length && this.line[this.pos] === '+') {
      this.pos++;
    }

    let digits = '';
    let hasDot = false;
    while (this.pos < this.line.length) {
      const ch = this.line[this.pos];
      if (ch >= '0' && ch <= '9') {
        digits += ch;
        this.pos++;
      } else if (ch === '.' && !hasDot) {
        hasDot = true;
        digits += ch;
        this.pos++;
      } else {
        break;
      }
    }

    if (digits.length === 0) return currentVal;

    if (hasDot) {
      const rawVal = parseFloat(digits) * sign;
      return this.absoluteCoords
        ? this.convertToNm(rawVal)
        : currentVal + this.convertToNm(rawVal);
    }

    const totalDigits = this.coordFormat.integerDigits + this.coordFormat.mantissaDigits;
    let padded = digits;

    if (this.zeroOmission === ZeroOmission.Leading) {
      while (padded.length < totalDigits) padded = '0' + padded;
    } else {
      while (padded.length < totalDigits) padded = padded + '0';
    }

    const intPart = padded.substring(0, this.coordFormat.integerDigits);
    const fracPart = padded.substring(this.coordFormat.integerDigits);
    const rawVal = parseFloat(intPart + '.' + fracPart) * sign;

    if (this.absoluteCoords) {
      return this.convertToNm(rawVal);
    } else {
      return currentVal + this.convertToNm(rawVal);
    }
  }

  private convertToNm(val: number): number {
    if (this.unit === GerberUnit.Inch) {
      return val * IU_PER_INCH;
    }
    return val * IU_PER_MM;
  }

  // ========== M 代码处理 ==========

  private readMCode() {
    const num = this.readNumber();
    if (num === 2 || num === 30) {
      // M02/M30 - 文件结束
    }
  }

  // ========== 辅助方法 ==========

  private readNumber(): number {
    let sign = 1;
    if (this.pos < this.line.length && this.line[this.pos] === '-') {
      sign = -1;
      this.pos++;
    } else if (this.pos < this.line.length && this.line[this.pos] === '+') {
      this.pos++;
    }

    let digits = '';
    while (this.pos < this.line.length && this.line[this.pos] >= '0' && this.line[this.pos] <= '9') {
      digits += this.line[this.pos++];
    }

    return parseInt(digits) * sign;
  }

  private extractParamValues(body: string): Record<string, number> {
    const result: Record<string, number> = {};
    const regex = /([A-Z])([-+]?[\d.]+)/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      result[match[1]] = parseFloat(match[2]);
    }
    return result;
  }
}

// 检测文件是否为 RS-274X 格式
export function detectGerberFile(text: string): boolean {
  let hasADD = false;
  let hasStar = false;
  let hasCoord = false;

  const sample = text.substring(0, 10000);
  if (sample.includes('%ADD')) hasADD = true;
  if (sample.includes('*')) hasStar = true;
  if (/[XY][-+]?\d/.test(sample)) hasCoord = true;

  return hasADD || (hasStar && hasCoord);
}
