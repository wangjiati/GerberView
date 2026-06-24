import { ShapeType, Interpolation } from './enums';

export interface Point {
  x: number;
  y: number;
}

export function pt(x: number, y: number): Point {
  return { x, y };
}

/**
 * 元件级元数据（聚合自 Gerber X2 对象属性 .C/.CVal/.CFtp/.CMnt/.CRot/.CMfr/.CMPN
 * 及该元件全部焊盘的几何/网络信息）。
 */
export interface ComponentInfo {
  ref: string;                                    // 位号 R301 (.C)
  value: string;                                  // 值 4K7 (.CVal)
  footprint: string;                              // 封装 R_0805 (.CFtp)
  mountType: string;                              // 贴装 SMD/TH (.CMnt)
  rotation: number;                               // 旋转角度 -90 (.CRot)
  manufacturer: string;                           // 制造商 (.CMfr)
  mpn: string;                                    // 制造商零件号 (.CMPN)
  layerSide: 'top' | 'bottom' | 'unknown';        // 顶/底面(由所在图层推断)
  padCount: number;                               // 焊盘数
  centerX: number;                                // 焊盘质心 X(mm)
  centerY: number;                                // 焊盘质心 Y(mm)
  nets: string[];                                 // 关联网络名
}

export interface GerberItem {
  shapeType: ShapeType;
  start: Point;
  end: Point;
  arcCenter: Point;
  size: Point;
  polygonPoints: Point[];
  dCode: number;
  flashed: boolean;
  layerIndex: number;
  layerPolarityClear: boolean;
  aperFunction: string;
  netName: string;
  componentRef: string;
  padName: string;          // 焊盘名 (.P 第2参数)
  pinFunction: string;      // 引脚功能 (.P 第3参数)
  // 插补模式 — 用于渲染时判断弧线方向
  interpolation: Interpolation;
  // 变换参数
  swapAxis: boolean;
  mirrorA: boolean;
  mirrorB: boolean;
  drawScale: Point;
  layerOffset: Point;
  layerRotation: number;
}

export function createGerberItem(layerIndex: number): GerberItem {
  return {
    shapeType: ShapeType.Segment,
    start: pt(0, 0),
    end: pt(0, 0),
    arcCenter: pt(0, 0),
    size: pt(0, 0),
    polygonPoints: [],
    dCode: 0,
    flashed: false,
    layerIndex,
    layerPolarityClear: false,
    aperFunction: '',
    netName: '',
    componentRef: '',
    padName: '',
    pinFunction: '',
    interpolation: Interpolation.Linear,
    swapAxis: false,
    mirrorA: false,
    mirrorB: false,
    drawScale: pt(1, 1),
    layerOffset: pt(0, 0),
    layerRotation: 0,
  };
}
