import {
  ApertureType, DrillShape, MacroPrimitiveId, ParamItemType,
} from '../model/enums';
import { Point, pt } from '../model/gerber-item';

// ============ AM_PARAM — 光圈宏参数 ============
// 支持立即数和延迟引用（$n）以及算术表达式

export interface ParamItem {
  type: ParamItemType;
  value: number;     // 立即数值
  paramIndex: number; // $n 参数索引（1-based）
}

export class AmParam {
  items: ParamItem[] = [];

  reset() {
    this.items = [];
  }

  pushValue(val: number) {
    this.items.push({ type: ParamItemType.PushValue, value: val, paramIndex: 0 });
  }

  pushParam(index: number) {
    this.items.push({ type: ParamItemType.PushParam, value: 0, paramIndex: index });
  }

  pushOp(type: number) {
    this.items.push({ type, value: 0, paramIndex: 0 });
  }

  // 求值：传入宏实例化参数（%ADD 时传入的 X 分隔参数）
  evaluate(params: number[]): number {
    const stack: number[] = [];
    for (const item of this.items) {
      switch (item.type) {
        case ParamItemType.PushValue:
          stack.push(item.value);
          break;
        case ParamItemType.PushParam: {
          const val = params[item.paramIndex - 1] ?? 0;
          stack.push(val);
          break;
        }
        case ParamItemType.Add: {
          const b = stack.pop() ?? 0;
          const a = stack.pop() ?? 0;
          stack.push(a + b);
          break;
        }
        case ParamItemType.Sub: {
          const b = stack.pop() ?? 0;
          const a = stack.pop() ?? 0;
          stack.push(a - b);
          break;
        }
        case ParamItemType.Mul: {
          const b = stack.pop() ?? 0;
          const a = stack.pop() ?? 0;
          stack.push(a * b);
          break;
        }
        case ParamItemType.Div: {
          const b = stack.pop() ?? 0;
          const a = stack.pop() ?? 0;
          stack.push(b !== 0 ? a / b : 0);
          break;
        }
        case ParamItemType.Negate: {
          const v = stack.pop() ?? 0;
          stack.push(-v);
          break;
        }
      }
    }
    return stack[0] ?? 0;
  }

  // 是否为立即数（无参数引用）
  isImmediate(): boolean {
    return !this.items.some(i => i.type === ParamItemType.PushParam);
  }
}

// ============ AM_PRIMITIVE — 光圈宏图元 ============

export class AmPrimitive {
  id: MacroPrimitiveId = MacroPrimitiveId.Comment;
  params: AmParam[] = [];
  exposureOn: boolean = true;

  constructor(id: MacroPrimitiveId) {
    this.id = id;
  }
}

// ============ APERTURE_MACRO — 光圈宏定义 ============

export class ApertureMacro {
  name: string = '';
  primitives: AmPrimitive[] = [];
  // 本地参数定义（如 $4=$3/2）
  localParams: Map<number, AmParam> = new Map();

  // 缓存的形状多边形
  cachedShape: Point[][] | null = null;
  cachedForParams: string = '';
}

// ============ D_CODE — 光圈定义 ============

export class DCode {
  numDcode: number = 0;
  apertureType: ApertureType = ApertureType.Circle;
  size: Point = pt(0, 0);         // 宽/高（nm）
  drill: Point = pt(0, 0);        // 钻孔尺寸（nm）
  drillShape: DrillShape = DrillShape.NoHole;
  rotation: number = 0;           // 度
  edgesCount: number = 0;         // 正多边形边数（3-12）
  defined: boolean = false;
  inUse: boolean = false;
  aperFunction: string = '';      // 光圈功能（从 TA 命令获取）

  // 宏相关
  macro: ApertureMacro | null = null;
  macroParams: number[] = [];     // 宏实例化参数

  // 缓存的闪光形状多边形
  cachedFlashShape: Point[][] | null = null;
}
