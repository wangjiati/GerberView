import { ShapeType, Interpolation } from './enums';

export interface Point {
  x: number;
  y: number;
}

export function pt(x: number, y: number): Point {
  return { x, y };
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
    interpolation: Interpolation.Linear,
    swapAxis: false,
    mirrorA: false,
    mirrorB: false,
    drawScale: pt(1, 1),
    layerOffset: pt(0, 0),
    layerRotation: 0,
  };
}
