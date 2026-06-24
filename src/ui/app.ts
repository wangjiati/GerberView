import JSZip from 'jszip';
import { Viewport } from '../renderer/viewport';
import { Renderer, DisplayOptions, DEFAULT_DISPLAY_OPTIONS } from '../renderer/renderer';
import { LayerManager, GerberImage } from '../model/gerber-image';
import { GerberParser, detectGerberFile, KICAD_LAYER_COLORS } from '../parser/gerber-parser';
import { ExcellonParser, detectExcellonFile } from '../parser/excellon-parser';
import { IU_PER_MM, ShapeType, LayerType, LAYER_TYPE_COLORS, LAYER_TYPE_LABELS, MAX_LAYERS, LAYER_CATEGORIES } from '../model/enums';
import { Point, pt, GerberItem } from '../model/gerber-item';
import { ThemeColors, PRESET_THEMES, loadTheme, saveTheme, applyThemeToGridConfig } from './theme';
import { hitTest, HitResult } from '../tools/hit-test';
import { createItemTooltip, createItemDetailDialog } from './item-info';
import { transformPointWorld } from '../tools/transform';
import { Interpolation } from '../model/enums';
import { exportToSVG, downloadSVG } from '../tools/exporter-svg';
import { exportToDXF, downloadDXF } from '../tools/exporter-dxf';
import { showExportDxfDialog } from './export-dxf-dialog';
import { showExportSvgDialog } from './export-svg-dialog';
import { MeasurementManager, MeasureMode, Measurement, computeDistance, computeAngleDeg, computePolygonArea, formatNm, renderMeasurements } from '../tools/measurement';
import { runDfmAnalysis, formatDfmValue, DfmReport } from '../tools/dfm-analysis';
import { loadShareData, generateShareHTML, downloadShareHTML } from '../tools/share';
import { showShareDialog } from './share-dialog';
import { showExportPngDialog } from './export-png-dialog';
import { exportLayersAsZip, downloadZip } from '../tools/export-png';

export type UnitMode = 'mm' | 'inch' | 'mil';

// ============ 捕捉点类型 ============

enum SnapType {
  Endpoint = 1,  // 端点（线段/弧的起终点、多边形顶点）
  Midpoint = 2,  // 中点（线段中点、弧中点、多边形边中点）
  Center = 3,    // 中心点（弧心、焊盘中心）
}

interface SnapResult {
  world: Point;
  type: SnapType;
}

// 屏幕空间捕捉阈值（像素）
const SNAP_THRESHOLD_PX = 10;

const svg = (paths: string, fill = false) =>
  `<svg viewBox="0 0 20 20" ${fill ? 'class="filled"' : ''}>${paths}</svg>`;

const ICONS = {
  clearAll: svg('<path d="M4 4h12v12H4z M6 6l8 8M14 6l-8 8" stroke-width="1.5"/>'),
  openFile: svg('<rect x="3" y="2" width="14" height="16" rx="1" fill="none" stroke-width="1.2"/><path d="M6 7h8M6 10h8M6 13h5" stroke-width="1"/>'),
  openDrill: svg('<circle cx="7" cy="7" r="2.5" fill="none" stroke-width="1.2"/><circle cx="13" cy="7" r="2.5" fill="none" stroke-width="1.2"/><circle cx="7" cy="13" r="2.5" fill="none" stroke-width="1.2"/><circle cx="13" cy="13" r="2.5" fill="none" stroke-width="1.2"/>'),
  print: svg('<path d="M5 8V3h10v5M4 8h12v6h-3v3H7v-3H4z" fill="none" stroke-width="1.2"/>'),
  redraw: svg('<path d="M10 4a6 6 0 1 1-5.2 3" fill="none" stroke-width="1.5"/><path d="M10 1l0 5 4-3z" fill="currentColor" stroke="none"/>'),
  zoomIn: svg('<circle cx="9" cy="9" r="5.5" fill="none" stroke-width="1.3"/><path d="M13 13l4 4" stroke-width="1.5"/><path d="M7 9h4M9 7v4" stroke-width="1.3"/>'),
  zoomOut: svg('<circle cx="9" cy="9" r="5.5" fill="none" stroke-width="1.3"/><path d="M13 13l4 4" stroke-width="1.5"/><path d="M7 9h4" stroke-width="1.3"/>'),
  zoomFit: svg('<rect x="3" y="3" width="14" height="14" rx="1" fill="none" stroke-width="1.2"/><path d="M6 6l3 3M6 6v3M6 6h3M14 14l-3-3M14 14v-3M14 14h-3" stroke-width="1"/>'),
  zoomArea: svg('<rect x="2" y="2" width="16" height="16" rx="1" fill="none" stroke-width="1.2" stroke-dasharray="3,2"/>'),
  layerInfo: svg('<circle cx="10" cy="10" r="7" fill="none" stroke-width="1.2"/><path d="M10 7v1M10 10v4" stroke-width="1.5"/>'),
  select: svg('<path d="M5 2l10 8-5 1-2 5z" fill="currentColor" stroke="none"/>'),
  measure: svg('<path d="M4 16L16 4" stroke-width="1.5"/><path d="M4 16l2-1M4 16l1-2M16 4l-2 1M16 4l-1 2" stroke-width="1.2"/>'),
  grid: svg('<path d="M4 4h12v12H4z" fill="none" stroke-width="1"/><path d="M4 8h12M4 12h12M8 4v12M12 4v12" stroke-width="0.8"/>'),
  polarCoord: svg('<circle cx="10" cy="10" r="6" fill="none" stroke-width="1"/><path d="M10 10l5-3M10 10l0-6" stroke-width="1.2"/>'),
  fullCursor: svg('<path d="M10 2v16M2 10h16" stroke-width="1.2"/>'),
  flashSketch: svg('<rect x="4" y="4" width="5" height="5" fill="none" stroke-width="1.2"/><circle cx="14" cy="7" r="3" fill="none" stroke-width="1.2"/>'),
  lineSketch: svg('<path d="M4 16L16 4" fill="none" stroke-width="1.5"/>'),
  polySketch: svg('<path d="M4 14l5-8 5 4 3-5" fill="none" stroke-width="1.2"/>'),
  negativeObj: svg('<rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke-width="1.2"/><path d="M6 10h8" stroke-width="1.5"/>'),
  dcode: svg('<text x="10" y="14" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor" stroke="none" font-family="monospace">D</text>'),
  diffMode: svg('<rect x="3" y="4" width="6" height="12" rx="1" fill="none" stroke-width="1.2"/><rect x="11" y="4" width="6" height="12" rx="1" fill="none" stroke-width="1.2"/><path d="M9 7h2M9 10h2M9 13h2" stroke-width="1"/>'),
  contrast: svg('<circle cx="10" cy="10" r="7" fill="none" stroke-width="1.2"/><path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" opacity="0.6"/>'),
  showLayers: svg('<rect x="3" y="5" width="14" height="4" rx="1" fill="none" stroke-width="1.2"/><rect x="3" y="11" width="14" height="4" rx="1" fill="none" stroke-width="1.2"/>'),
  mirror: svg('<path d="M4 10h12" stroke-width="1.2"/><path d="M14 7l3 3-3 3" fill="none" stroke-width="1.3"/><path d="M6 7l-3 3 3 3" fill="none" stroke-width="1.3"/>'),
  highlightNet: svg('<path d="M4 10l4-6 4 4 4-4" fill="none" stroke-width="1.5"/><circle cx="4" cy="10" r="1" fill="currentColor" stroke="none"/>'),
  highlightComp: svg('<rect x="5" y="5" width="10" height="10" rx="2" fill="none" stroke-width="1.2"/><path d="M8 3v4M12 3v4" stroke-width="1"/>'),
  highlightAttr: svg('<path d="M4 4l6 12 6-12" fill="none" stroke-width="1.5"/>'),
};

export class App {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private viewport: Viewport = new Viewport();
  private layerManager: LayerManager = new LayerManager();
  private renderer!: Renderer;
  private displayOptions: DisplayOptions = { ...DEFAULT_DISPLAY_OPTIONS };

  private layerListEl!: HTMLElement;
  private statusBarEl!: HTMLElement;
  private zoomDisplayEl!: HTMLElement;
  private coordDisplayEl!: HTMLElement;
  private layerPanelEl!: HTMLElement;
  private layerPanelWidth: number = 250;
  private layerTabBtns: HTMLElement[] = [];
  private layerTabContents: HTMLElement[] = [];
  private activeLayerSelect!: HTMLSelectElement;
  private leftToolbarBtns: Map<string, HTMLElement> = new Map();
  private _netSel!: HTMLSelectElement;
  private _compSel!: HTMLSelectElement;
  private _attrSel!: HTMLSelectElement;
  private fileInfoEl!: HTMLElement;

  // 测量工具状态
  private measureActive: boolean = false;
  private measureStart: Point | null = null;
  private measureEnd: Point | null = null;

  // 捕捉状态
  private currentSnap: SnapResult | null = null;

  // 光标状态
  private cursorScreenPos: Point = pt(0, 0);
  private fullCursor: boolean = false;
  private polarCoords: boolean = false;

  private isPanning = false;
  private zoomAreaActive = false;
  private zoomAreaStart: { x: number; y: number } | null = null;
  private zoomAreaEnd: { x: number; y: number } | null = null;
  private lastMousePos = { x: 0, y: 0 };
  private unitMode: UnitMode = 'mm';
  private layerPanelVisible = true;
  private theme: ThemeColors = loadTheme();
  private selectedItem: HitResult | null = null;
  private hoveredItem: HitResult | null = null;
  private itemTooltip: HTMLDivElement | null = null;
  private measureMgr = new MeasurementManager();
  private measureMode: MeasureMode = MeasureMode.PointToPoint;
  private measureInProgress: Point[] = [];
  private shareMode: boolean = false;
  private simulationActive: boolean = false;
  private simulationFlip: boolean = false;
  private savedFillState = { lines: true, flashes: true, polygons: true };

  constructor(container: HTMLElement, mode: 'share' | 'full' = 'full') {
    this.shareMode = mode === 'share';
    this.buildUI(container);
    this.initRenderer();
    this.applyTheme();
    this.bindEvents();
    this.requestRender();
  }

  // ========== UI 构建 ==========

  private buildUI(container: HTMLElement) {
    container.innerHTML = '';
    container.className = 'gerberview-app';
    container.appendChild(this.createMenuBar());
    container.appendChild(this.createTopToolbar());
    const mainArea = document.createElement('div');
    mainArea.className = 'main-area';
    mainArea.appendChild(this.createLeftToolbar());
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'canvas-container';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    canvasContainer.appendChild(this.canvas);
    mainArea.appendChild(canvasContainer);
    const resizer = document.createElement('div');
    resizer.className = 'layer-panel-resizer';
    mainArea.appendChild(resizer);
    this.layerPanelEl = this.createLayerPanel();
    mainArea.appendChild(this.layerPanelEl);
    this.initLayerPanelResize(resizer);
    container.appendChild(mainArea);
    this.statusBarEl = this.createStatusBar();
    container.appendChild(this.statusBarEl);
  }

  private createMenuBar(): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'menu-bar';
    const fileItems: any[] = [];
    if (!this.shareMode) {
      fileItems.push(
        { label: '自动检测并打开文件...', action: () => this.openFiles('all') },
        { label: '打开 Gerber 文件...', action: () => this.openFiles('gerber') },
        { label: '打开钻孔文件...', action: () => this.openFiles('excellon') },
        { type: 'separator' as const },
        { label: '清除所有图层', action: () => this.clearAll() },
        { type: 'separator' as const },
      );
    }
    fileItems.push(
      { label: '导出为 PNG...', action: () => this.exportPNG() },
      { label: '导出为 SVG...', action: () => this.exportSVG() },
      { label: '导出为 DXF...', action: () => this.exportDXF() },
    );
    if (!this.shareMode) {
      fileItems.push(
        { type: 'separator' as const },
        { label: '分享为只读模式...', action: () => this.exportShareHTML() },
      );
    }
    const menus = [
      { label: '文件', items: fileItems },
      { label: '视图', items: [
        { label: '适应窗口', action: () => this.zoomFit() },
        { label: '放大', action: () => { this.viewport.zoom(1.5); this.requestRender(); } },
        { label: '缩小', action: () => { this.viewport.zoom(1 / 1.5); this.requestRender(); } },
        { type: 'separator' as const },
        { label: '显示网格', action: () => { this.displayOptions.showGrid = !this.displayOptions.showGrid; this.syncLeftToolbar(); this.requestRender(); }, checked: () => this.displayOptions.showGrid },
        { type: 'separator' as const },
        { label: '高对比度模式', action: () => { this.displayOptions.highContrastMode = !this.displayOptions.highContrastMode; this.syncLeftToolbar(); this.requestRender(); }, checked: () => this.displayOptions.highContrastMode },
        { type: 'separator' as const },
        { label: '仿真视图', action: () => { this.toggleSimulation(!this.simulationActive); }, checked: () => this.simulationActive },
      ]},
      { label: '图层', items: [
        { label: '按扩展名排序', action: () => this.sortLayers() },
        { label: '按板结构排序', action: () => { this.layerManager.sortByBoardStructure(); this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender(); } },
        { type: 'separator' as const },
        { label: '显示全部', action: () => this.setAllLayersVisible(true) },
        { label: '隐藏全部', action: () => this.setAllLayersVisible(false) },
      ]},
      { label: '工具', items: [
        { label: 'DFM 分析...', action: () => this.showDfmReport() },
        { label: '清除测量', action: () => { this.measureMgr.clearAll(); this.requestRender(); } },
      ]},
      { label: '帮助', items: [
        { label: '快捷键参考', action: () => this.showShortcutsDialog() },
        { type: 'separator' as const },
        { label: '关于 GerberView', action: () => this.showAboutDialog() },
      ]},
    ];

    for (const m of menus) {
      const btn = document.createElement('div');
      btn.className = 'menu-item';
      btn.textContent = m.label;
      const dropdown = document.createElement('div');
      dropdown.className = 'menu-dropdown';
      for (const item of m.items) {
        if (item.type === 'separator') {
          const sep = document.createElement('div'); sep.className = 'menu-separator';
          dropdown.appendChild(sep);
        } else {
          const el = document.createElement('div');
          el.className = 'menu-dropdown-item';
          el.textContent = item.label!;
          if (item.checked?.()) el.classList.add('checked');
          el.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = 'none'; item.action?.(); });
          dropdown.appendChild(el);
        }
      }
      btn.appendChild(dropdown);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const vis = dropdown.style.display === 'block';
        document.querySelectorAll('.menu-dropdown').forEach(d => (d as HTMLElement).style.display = 'none');
        dropdown.style.display = vis ? 'none' : 'block';
      });
      menu.appendChild(btn);
    }
    document.addEventListener('click', () => {
      document.querySelectorAll('.menu-dropdown').forEach(d => (d as HTMLElement).style.display = 'none');
    });
    return menu;
  }

  private createTopToolbar(): HTMLElement {
    const tb = document.createElement('div');
    tb.className = 'top-toolbar';
    if (!this.shareMode) {
      tb.appendChild(this.tbBtn(ICONS.clearAll, '清除所有图层', () => this.clearAll()));
      tb.appendChild(sep());
      tb.appendChild(this.tbBtn(ICONS.openFile, '打开 Gerber 文件', () => this.openFiles('gerber')));
      tb.appendChild(this.tbBtn(ICONS.openDrill, '打开钻孔文件', () => this.openFiles('excellon')));
      tb.appendChild(sep());
    }
    tb.appendChild(this.tbBtn(ICONS.print, '导出 PNG', () => this.exportPNG()));
    tb.appendChild(this.tbBtn(ICONS.redraw, '重绘', () => this.requestRender()));
    tb.appendChild(sep());
    tb.appendChild(this.tbBtn(ICONS.zoomIn, '放大 (+)', () => { this.viewport.zoom(1.5); this.requestRender(); }));
    tb.appendChild(this.tbBtn(ICONS.zoomOut, '缩小 (-)', () => { this.viewport.zoom(1 / 1.5); this.requestRender(); }));
    tb.appendChild(this.tbBtn(ICONS.zoomFit, '适应窗口 (Home)', () => this.zoomFit()));
    tb.appendChild(this.tbBtn(ICONS.zoomArea, '缩放到选区', () => this.zoomToSelection()));
    tb.appendChild(sep());

    const lbl = document.createElement('span'); lbl.className = 'tb-label'; lbl.textContent = '活动图层:';
    tb.appendChild(lbl);
    this.activeLayerSelect = document.createElement('select');
    this.activeLayerSelect.className = 'tb-select';
    this.activeLayerSelect.innerHTML = '<option value="-1">无</option>';
    this.activeLayerSelect.addEventListener('change', () => {
      this.displayOptions.activeLayer = parseInt(this.activeLayerSelect.value);
      this.updateLayerPanel(); this.updateFileInfo(); this.requestRender();
    });
    tb.appendChild(this.activeLayerSelect);
    tb.appendChild(this.tbBtn(ICONS.layerInfo, '图层信息', () => {}));
    tb.appendChild(sep());

    // X2 高亮选择器
    const netLbl = document.createElement('span'); netLbl.className = 'tb-label'; netLbl.textContent = 'Net:';
    tb.appendChild(netLbl);
    const netSel = document.createElement('select'); netSel.className = 'tb-select';
    netSel.innerHTML = '<option value="">-</option>';
    netSel.addEventListener('change', () => { this.displayOptions.highlightNet = netSel.value; this.requestRender(); });
    tb.appendChild(netSel);
    this._netSel = netSel;

    const compLbl = document.createElement('span'); compLbl.className = 'tb-label'; compLbl.textContent = 'Cmp:';
    tb.appendChild(compLbl);
    const compSel = document.createElement('select'); compSel.className = 'tb-select';
    compSel.innerHTML = '<option value="">-</option>';
    compSel.addEventListener('change', () => { this.displayOptions.highlightComp = compSel.value; this.requestRender(); });
    tb.appendChild(compSel);
    this._compSel = compSel;

    const attrLbl = document.createElement('span'); attrLbl.className = 'tb-label'; attrLbl.textContent = 'Attr:';
    tb.appendChild(attrLbl);
    const attrSel = document.createElement('select'); attrSel.className = 'tb-select';
    attrSel.innerHTML = '<option value="">-</option>';
    attrSel.addEventListener('change', () => { this.displayOptions.highlightAttr = attrSel.value; this.requestRender(); });
    tb.appendChild(attrSel);
    this._attrSel = attrSel;

    return tb;
  }

  private tbBtn(iconHtml: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'tb-btn'; btn.title = title; btn.innerHTML = iconHtml;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private leftPanelEl: HTMLElement | null = null;
  private activePanelKey: string = '';

  private createLeftToolbar(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'left-toolbar-wrap';

    const tb = document.createElement('div');
    tb.className = 'left-toolbar';

    // 工具按钮（点击可在右侧展开面板）
    tb.appendChild(this.ltPanelBtn('select', ICONS.select, '选择工具\n点击选中元素查看属性，双击查看详细信息\n快捷键: Esc', true));
    tb.appendChild(this.ltPanelBtn('measure', ICONS.measure, '测量工具\n支持距离、角度、半径、面积测量\n快捷键: M', false));
    tb.appendChild(sep(true));
    tb.appendChild(this.ltPanelBtn('grid', ICONS.grid, '网格显示开关\n点击展开网格间距和样式设置\n快捷键: G', true));
    tb.appendChild(this.ltBtn('polar', ICONS.polarCoord, '极坐标显示\n在状态栏显示极坐标 (R, θ)', false));
    tb.appendChild(sep(true));

    // 单位选择
    const unitGroup = document.createElement('div'); unitGroup.className = 'lt-unit-group';
    for (const u of [{ key: 'inch' as UnitMode, label: 'in' }, { key: 'mil' as UnitMode, label: 'mil' }, { key: 'mm' as UnitMode, label: 'mm' }]) {
      const btn = document.createElement('button');
      btn.className = 'lt-unit-btn' + (u.key === this.unitMode ? ' active' : '');
      btn.textContent = u.label;
      btn.addEventListener('click', () => {
        this.unitMode = u.key;
        unitGroup.querySelectorAll('.lt-unit-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      unitGroup.appendChild(btn);
    }
    tb.appendChild(unitGroup);
    tb.appendChild(sep(true));
    tb.appendChild(this.ltBtn('fullcursor', ICONS.fullCursor, '全屏十字光标\n光标线贯穿整个画布区域', false));
    tb.appendChild(sep(true));
    tb.appendChild(this.ltBtn('flashSketch', ICONS.flashSketch, '焊盘轮廓模式\n仅显示焊盘 (Flash) 的外形轮廓', true));
    tb.appendChild(this.ltBtn('lineSketch', ICONS.lineSketch, '线条轮廓模式\n仅显示线条的中心线和轮廓', true));
    tb.appendChild(this.ltBtn('polySketch', ICONS.polySketch, '多边形轮廓模式\n仅显示多边形的轮廓边框', true));
    tb.appendChild(sep(true));
    tb.appendChild(this.ltBtn('negative', ICONS.negativeObj, '显示负极性对象\n显示被极性清除 (Clear) 的区域轮廓', true));
    tb.appendChild(this.ltBtn('dcodes', ICONS.dcode, '显示 D 代码标签\n在每个图元旁标注使用的 D 码编号', false));
    tb.appendChild(this.ltBtn('diff', ICONS.diffMode, '差异模式 (XOR)\n使用异或混合模式显示层间差异', false));
    tb.appendChild(this.ltBtn('contrast', ICONS.contrast, '高对比度模式\n增强图层颜色对比度便于区分', false));
    tb.appendChild(sep(true));
    tb.appendChild(this.ltBtn('layerMgr', ICONS.showLayers, '显示/隐藏图层面板\n快捷键: L', true));
    tb.appendChild(this.ltBtn('mirror', ICONS.mirror, '镜像视图\n水平翻转整个画布内容', false));
    tb.appendChild(sep(true));
    tb.appendChild(this.ltBtn('simulation', ICONS.contrast, '仿真视图\n近似真实 PCB 外观\n快捷键: Ctrl+Shift+S', false));
    tb.appendChild(this.ltBtn('simFlip', ICONS.mirror, '仿真翻转\n翻转查看 PCB 底层\n仅在仿真模式下可用', false));

    // 可展开面板
    const panel = document.createElement('div');
    panel.className = 'left-panel hidden';
    this.leftPanelEl = panel;

    wrap.appendChild(tb);
    wrap.appendChild(panel);
    return wrap;
  }

  private ltPanelBtn(key: string, iconHtml: string, title: string, initialActive: boolean): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'lt-btn' + (initialActive ? ' active' : '');
    btn.innerHTML = iconHtml; btn.dataset.key = key;
    this.setupLtTooltip(btn, title);
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      // 切换面板：点击已展开的按钮则关闭，否则展开
      if (this.activePanelKey === key) {
        this.activePanelKey = '';
        this.leftPanelEl!.classList.add('hidden');
        this.leftPanelEl!.innerHTML = '';
        return;
      }
      this.activePanelKey = key;
      this.leftPanelEl!.classList.remove('hidden');
      this.leftPanelEl!.innerHTML = '';
      this.buildPanelContent(key);
      this.onLeftToolbarClick(key, true);
    });
    this.leftToolbarBtns.set(key, btn);
    return btn;
  }

  private buildPanelContent(key: string) {
    const panel = this.leftPanelEl!;
    if (key === 'select') {
      panel.innerHTML = `<div class="lp-title">选择工具</div>
        <div class="lp-row"><label>选中高亮</label></div>
        <div class="lp-hint">点击元素查看属性<br>双击查看详细信息</div>`;
    } else if (key === 'measure') {
      this.buildMeasurePanel(panel);
    } else if (key === 'grid') {
      this.buildGridPanel(panel);
    }
  }

  private buildMeasurePanel(panel: HTMLElement) {
    panel.innerHTML = `<div class="lp-title">测量工具</div>
      <div class="lp-row"><label>类型</label>
        <select class="lp-select" id="lp-measure-mode">
          <option value="p2p">距离</option>
          <option value="angle">角度</option>
          <option value="radius">半径</option>
          <option value="area">面积</option>
        </select>
      </div>
      <div class="lp-hint" id="lp-measure-hint">点击两点测量距离</div>
      <div class="lp-row" style="margin-top:auto">
        <button class="lp-btn" id="lp-measure-clear">清除所有测量</button>
      </div>`;

    const sel = panel.querySelector('#lp-measure-mode') as HTMLSelectElement;
    sel.value = this.measureMode;
    sel.addEventListener('change', () => {
      this.measureMode = sel.value as MeasureMode;
      this.measureInProgress = [];
      this.measureStart = null;
      this.updateMeasureHint();
      this.requestRender();
    });

    panel.querySelector('#lp-measure-clear')!.addEventListener('click', () => {
      this.measureMgr.clearAll();
      this.measureInProgress = [];
      this.measureStart = null;
      this.requestRender();
    });

    this.updateMeasureHint();
  }

  private updateMeasureHint() {
    const el = this.leftPanelEl?.querySelector('#lp-measure-hint');
    if (!el) return;
    const hints: Record<string, string> = {
      p2p: '点击两点测量距离',
      angle: '依次点击三个点测量夹角',
      radius: '点击圆弧/圆测量半径',
      area: '依次点击多边形顶点\n双击结束并计算面积',
    };
    el.textContent = hints[this.measureMode] || '';
  }

  private buildGridPanel(panel: HTMLElement) {
    const gc = this.displayOptions.gridConfig;
    const fineS = gc?.fineStyle || (gc as Record<string, any>)?.style || 'dots';
    const coarseS = gc?.coarseStyle || 'lines';

    panel.innerHTML = `<div class="lp-title">网格设置</div>
      <div class="lp-section">细网格</div>
      <div class="lp-row"><label>样式</label>
        <select class="lp-select" id="lp-fine-style">
          <option value="dots" ${fineS === 'dots' ? 'selected' : ''}>点</option>
          <option value="lines" ${fineS === 'lines' ? 'selected' : ''}>线</option>
          <option value="crosshairs" ${fineS === 'crosshairs' ? 'selected' : ''}>十字</option>
        </select>
      </div>
      <div class="lp-row"><label>间距(mm)</label>
        <input type="number" class="lp-input" id="lp-fine-spacing" min="0" step="any" placeholder="自动" value="${gc?.fineSpacing ? (gc.fineSpacing / IU_PER_MM).toFixed(4) : ''}">
      </div>
      <div class="lp-section">粗网格</div>
      <div class="lp-row"><label>启用</label>
        <input type="checkbox" id="lp-grid-coarse" ${gc?.showCoarse ? 'checked' : ''}>
      </div>
      <div class="lp-row"><label>样式</label>
        <select class="lp-select" id="lp-coarse-style">
          <option value="dots" ${coarseS === 'dots' ? 'selected' : ''}>点</option>
          <option value="lines" ${coarseS === 'lines' ? 'selected' : ''}>线</option>
          <option value="crosshairs" ${coarseS === 'crosshairs' ? 'selected' : ''}>十字</option>
        </select>
      </div>
      <div class="lp-row"><label>间距(mm)</label>
        <input type="number" class="lp-input" id="lp-coarse-spacing" min="0" step="any" placeholder="自动" value="${gc?.coarseSpacing ? (gc.coarseSpacing / IU_PER_MM).toFixed(4) : ''}">
      </div>
      <div class="lp-section">原点</div>
      <div class="lp-row"><label>显示十字线</label>
        <input type="checkbox" id="lp-grid-origin" ${gc?.showOriginCrosshair !== false ? 'checked' : ''}>
      </div>`;

    const update = (patch: Record<string, any>) => {
      this.displayOptions.gridConfig = { ...this.displayOptions.gridConfig, ...patch };
      this.requestRender();
    };

    panel.querySelector('#lp-fine-style')!.addEventListener('change', (e) => {
      update({ fineStyle: (e.target as HTMLSelectElement).value });
    });
    panel.querySelector('#lp-coarse-style')!.addEventListener('change', (e) => {
      update({ coarseStyle: (e.target as HTMLSelectElement).value });
    });
    panel.querySelector('#lp-grid-origin')!.addEventListener('change', (e) => {
      update({ showOriginCrosshair: (e.target as HTMLInputElement).checked });
    });
    panel.querySelector('#lp-grid-coarse')!.addEventListener('change', (e) => {
      update({ showCoarse: (e.target as HTMLInputElement).checked });
    });
    panel.querySelector('#lp-fine-spacing')!.addEventListener('change', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      update({ fineSpacing: isNaN(v) || v <= 0 ? null : v * IU_PER_MM });
    });
    panel.querySelector('#lp-coarse-spacing')!.addEventListener('change', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      update({ coarseSpacing: isNaN(v) || v <= 0 ? null : v * IU_PER_MM });
    });
  }

  private ltBtn(key: string, iconHtml: string, title: string, initialActive: boolean): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'lt-btn' + (initialActive ? ' active' : '');
    btn.innerHTML = iconHtml; btn.dataset.key = key;
    this.setupLtTooltip(btn, title);
    btn.addEventListener('click', () => { btn.classList.toggle('active'); this.onLeftToolbarClick(key, btn.classList.contains('active')); });
    this.leftToolbarBtns.set(key, btn);
    return btn;
  }

  private setupLtTooltip(btn: HTMLElement, text: string) {
    let tipEl: HTMLElement | null = null;
    btn.addEventListener('mouseenter', () => {
      tipEl = document.createElement('div');
      tipEl.className = 'lt-tooltip';
      tipEl.textContent = text;
      document.body.appendChild(tipEl);
      const r = btn.getBoundingClientRect();
      tipEl.style.left = (r.right + 8) + 'px';
      tipEl.style.top = Math.max(4, r.top + r.height / 2 - tipEl.offsetHeight / 2) + 'px';
    });
    btn.addEventListener('mouseleave', () => {
      if (tipEl) { tipEl.remove(); tipEl = null; }
    });
  }

  private onLeftToolbarClick(key: string, active: boolean) {
    switch (key) {
      case 'select': if (active) { this.measureActive = false; this.measureStart = null; this.measureEnd = null; this.measureInProgress = []; } break;
      case 'measure': this.measureActive = active; if (active) { this.measureStart = null; this.measureEnd = null; this.measureInProgress = []; } break;
      case 'grid': this.displayOptions.showGrid = active; break;
      case 'polar': this.polarCoords = active; break;
      case 'fullcursor': this.fullCursor = active; break;
      case 'origin': this.displayOptions.gridConfig = { ...this.displayOptions.gridConfig, showOriginCrosshair: active }; break;
      case 'flashSketch': this.displayOptions.flashesFill = active; break;
      case 'lineSketch': this.displayOptions.linesFill = active; break;
      case 'polySketch': this.displayOptions.polygonsFill = active; break;
      case 'negative': this.displayOptions.showNegativeObjects = active; break;
      case 'dcodes': this.displayOptions.showDcodes = active; break;
      case 'contrast': this.displayOptions.highContrastMode = active; break;
      case 'diff': this.displayOptions.xorMode = active; break;
      case 'layerMgr': this.layerPanelVisible = active; this.layerPanelEl.classList.toggle('hidden', !active); break;
      case 'mirror': this.displayOptions.mirror = active; break;
      case 'simulation': this.toggleSimulation(active); break;
      case 'simFlip': this.toggleSimFlip(); break;
    }
    this.requestRender();
  }

  private syncLeftToolbar() {
    const set = (key: string, active: boolean) => { const b = this.leftToolbarBtns.get(key); if (b) b.classList.toggle('active', active); };
    set('grid', this.displayOptions.showGrid);
    set('flashSketch', this.displayOptions.flashesFill);
    set('lineSketch', this.displayOptions.linesFill);
    set('polySketch', this.displayOptions.polygonsFill);
    set('negative', this.displayOptions.showNegativeObjects);
    set('dcodes', this.displayOptions.showDcodes);
    set('contrast', this.displayOptions.highContrastMode);
    set('diff', this.displayOptions.xorMode);
    set('layerMgr', this.layerPanelVisible);
    set('mirror', this.displayOptions.mirror);
    set('simulation', this.simulationActive);
    set('simFlip', this.simulationFlip);
  }

  private createLayerPanel(): HTMLElement {
    const panel = document.createElement('div'); panel.className = 'layer-panel';
    const tabsEl = document.createElement('div'); tabsEl.className = 'layer-panel-tabs';
    const layersTab = document.createElement('div'); layersTab.className = 'layer-tab active'; layersTab.textContent = '图层';
    const itemsTab = document.createElement('div'); itemsTab.className = 'layer-tab'; itemsTab.textContent = '项目';
    tabsEl.appendChild(layersTab); tabsEl.appendChild(itemsTab);
    panel.appendChild(tabsEl);

    const layersContent = document.createElement('div'); layersContent.className = 'layer-tab-content active';
    this.layerListEl = document.createElement('div'); this.layerListEl.className = 'layer-list';
    layersContent.appendChild(this.layerListEl); panel.appendChild(layersContent);

    const itemsContent = document.createElement('div'); itemsContent.className = 'layer-tab-content';
    itemsContent.innerHTML = `<div class="items-tab-content">
      <div class="items-section"><div class="items-section-title">主题预设</div>
        <div class="items-row"><select class="theme-select">
          ${PRESET_THEMES.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
        </select></div>
      </div>
      <div class="items-section"><div class="items-section-title">显示颜色</div>
        <div class="items-row"><label>背景</label><input type="color" data-theme="canvasBackground" class="items-color-pick" value="${this.theme.canvasBackground}"></div>
        <div class="items-row"><label>网格</label><input type="color" data-theme="gridDot" class="items-color-pick" value="${this.theme.gridDot}"></div>
        <div class="items-row"><label>原点</label><input type="color" data-theme="gridOrigin" class="items-color-pick" value="${this.theme.gridOrigin}"></div>
        <div class="items-row"><label>D 代码</label><input type="color" data-theme="dcodeLabel" class="items-color-pick" value="${this.theme.dcodeLabel}"></div>
        <div class="items-row"><label>选中高亮</label><input type="color" data-theme="selectionHighlight" class="items-color-pick" value="${this.theme.selectionHighlight}"></div>
      </div></div>`;
    panel.appendChild(itemsContent);

    // 主题预设选择
    const themeSelect = itemsContent.querySelector('.theme-select') as HTMLSelectElement;
    themeSelect.value = this.theme.name;
    themeSelect.addEventListener('change', () => {
      const preset = PRESET_THEMES.find(t => t.name === themeSelect.value);
      if (preset) this.setTheme(preset);
    });

    // 颜色选择器
    itemsContent.querySelectorAll<HTMLInputElement>('input[data-theme]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.theme as keyof ThemeColors;
        (this.theme as any)[key] = input.value;
        this.theme.name = 'Custom';
        saveTheme(this.theme);
        this.applyTheme();
      });
    });

    this.layerTabBtns = [layersTab, itemsTab];
    this.layerTabContents = [layersContent, itemsContent];
    layersTab.addEventListener('click', () => this.switchTab(0));
    itemsTab.addEventListener('click', () => this.switchTab(1));
    return panel;
  }

  private switchTab(index: number) {
    this.layerTabBtns.forEach((b, i) => b.classList.toggle('active', i === index));
    this.layerTabContents.forEach((c, i) => c.classList.toggle('active', i === index));
  }

  private createStatusBar(): HTMLElement {
    const bar = document.createElement('div'); bar.className = 'status-bar';
    if (this.shareMode) {
      const badge = document.createElement('span');
      badge.className = 'status-item share-badge';
      badge.textContent = '[分享]';
      badge.style.color = 'var(--accent)';
      badge.style.fontWeight = 'bold';
      bar.appendChild(badge);
    }
    this.coordDisplayEl = document.createElement('span'); this.coordDisplayEl.className = 'status-item';
    this.zoomDisplayEl = document.createElement('span'); this.zoomDisplayEl.className = 'status-item';
    this.fileInfoEl = document.createElement('span'); this.fileInfoEl.className = 'status-item status-info';
    bar.appendChild(this.coordDisplayEl); bar.appendChild(this.zoomDisplayEl); bar.appendChild(this.fileInfoEl);
    if (this.shareMode) {
      const ro = document.createElement('span');
      ro.className = 'status-item';
      ro.textContent = '只读模式';
      ro.style.marginLeft = 'auto';
      ro.style.color = 'white';
      ro.style.fontWeight = 'bold';
      bar.appendChild(ro);
    }
    return bar;
  }

  // ========== 渲染器初始化 ==========

  private initRenderer() {
    this.renderer = new Renderer(this.ctx, this.viewport, this.layerManager);
    this.renderer.displayOptions = this.displayOptions;
    this.resizeCanvas();
  }

  private applyTheme() {
    const gridColors = applyThemeToGridConfig(this.theme);
    this.displayOptions.gridConfig = { ...this.displayOptions.gridConfig, ...gridColors };
    this.displayOptions.backgroundColor = this.theme.canvasBackground;
    this.displayOptions.dcodeLabelColor = this.theme.dcodeLabel;
    this.requestRender();
  }

  private setTheme(theme: ThemeColors) {
    this.theme = { ...theme };
    saveTheme(this.theme);
    this.applyTheme();
    this.updateThemeColorPickers();
  }

  private updateThemeColorPickers() {
    const panel = this.layerPanelEl;
    if (!panel) return;
    panel.querySelectorAll<HTMLInputElement>('input[data-theme]').forEach(input => {
      const key = input.dataset.theme as keyof ThemeColors;
      if (key in this.theme) input.value = (this.theme as any)[key];
    });
    const sel = panel.querySelector('.theme-select') as HTMLSelectElement;
    if (sel) sel.value = PRESET_THEMES.find(t => t.name === this.theme.name) ? this.theme.name : 'Custom';
  }

  private updateItemTooltip(mx: number, my: number) {
    if (this.itemTooltip) { this.itemTooltip.remove(); this.itemTooltip = null; }
    if (!this.hoveredItem) return;
    this.itemTooltip = createItemTooltip(this.hoveredItem, this.unitMode);
    this.itemTooltip.style.position = 'fixed';
    this.itemTooltip.style.left = (mx + 16) + 'px';
    this.itemTooltip.style.top = (my + 16) + 'px';
    this.itemTooltip.style.zIndex = '1000';
    document.body.appendChild(this.itemTooltip);
  }

  // ========== 事件 ==========

  private bindEvents() {
    window.addEventListener('resize', () => { this.resizeCanvas(); this.requestRender(); });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.viewport.zoom(e.deltaY > 0 ? 1 / 1.2 : 1.2, this.msp({ x: e.clientX - rect.left, y: e.clientY - rect.top }));
      this.requestRender();
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.zoomAreaActive && e.button === 0) {
        const rect = this.canvas.getBoundingClientRect();
        this.zoomAreaStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.zoomAreaEnd = null;
        e.preventDefault();
        return;
      }
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        this.isPanning = true;
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.cursorScreenPos = sp;

      // 测量模式下更新捕捉
      if (this.measureActive) {
        this.currentSnap = this.findSnapPoint(this.msp(sp));
      }

      // 悬停 tooltip（非测量模式）
      if (!this.measureActive && !this.isPanning) {
        const hit = hitTest(this.msp(sp), this.layerManager, this.viewport);
        if (hit !== this.hoveredItem) {
          this.hoveredItem = hit;
          this.updateItemTooltip(e.clientX, e.clientY);
          this.requestRender();
        } else if (hit) {
          this.updateItemTooltip(e.clientX, e.clientY);
        }
      }

      this.updateCoordDisplay(this.msp(sp));

      if (this.isPanning) {
        let dx = e.clientX - this.lastMousePos.x;
        if (this.displayOptions.mirror) dx = -dx;
        this.viewport.pan(dx, e.clientY - this.lastMousePos.y);
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        this.requestRender();
      } else if (this.zoomAreaActive && this.zoomAreaStart) {
        this.zoomAreaEnd = sp;
        this.requestRender();
      } else if (this.fullCursor || this.measureActive) {
        this.requestRender();
      }
    });

    // 左键点击
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (this.measureActive) {
        const wp = this.currentSnap?.world ?? this.viewport.screenToWorld(this.msp(sp));
        this.measureInProgress.push(wp);
        this.measureStart = wp;

        const mode = this.measureMode;
        const pts = this.measureInProgress;

        if (mode === MeasureMode.PointToPoint) {
          if (pts.length === 2) {
            const dist = computeDistance(pts[0], pts[1]);
            this.measureMgr.add({ mode, points: [...pts], result: `距离: ${formatNm(dist, this.unitMode)}`, resultValue: dist });
            this.measureInProgress = [];
            this.measureStart = null;
          }
        } else if (mode === MeasureMode.Angle) {
          if (pts.length === 3) {
            const angle = computeAngleDeg(pts[0], pts[1], pts[2]);
            this.measureMgr.add({ mode, points: [...pts], result: `角度: ${angle.toFixed(1)}°`, resultValue: angle });
            this.measureInProgress = [];
            this.measureStart = null;
          }
        } else if (mode === MeasureMode.Radius) {
          if (pts.length === 1) {
            const hit = hitTest(this.msp(sp), this.layerManager, this.viewport);
            let radius = 0;
            if (hit && (hit.item.shapeType === ShapeType.Arc || hit.item.shapeType === ShapeType.Circle || hit.item.shapeType === ShapeType.SpotCircle)) {
              const dx = hit.item.start.x - hit.item.arcCenter.x;
              const dy = hit.item.start.y - hit.item.arcCenter.y;
              radius = Math.sqrt(dx * dx + dy * dy) || hit.item.size.x / 2;
            }
            this.measureMgr.add({ mode, points: [...pts], result: `半径: ${formatNm(radius, this.unitMode)}`, resultValue: radius });
            this.measureInProgress = [];
            this.measureStart = null;
          }
        } else if (mode === MeasureMode.Area) {
          // 面积模式：在 renderInProgress 中实时显示，双击结束
          // （双击处理在 dblclick 事件中）
        }

        this.measureEnd = null;
        this.requestRender();
        return;
      }

      // 选择工具：命中测试
      const hit = hitTest(this.msp(sp), this.layerManager, this.viewport);
      this.selectedItem = hit;
      this.requestRender();
    });

    // 双击：面积模式完成测量，或显示元素详情
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (this.measureActive && this.measureMode === MeasureMode.Area && this.measureInProgress.length >= 3) {
        const area = computePolygonArea(this.measureInProgress);
        const areaMm2 = area / (IU_PER_MM * IU_PER_MM);
        this.measureMgr.add({
          mode: MeasureMode.Area,
          points: [...this.measureInProgress],
          result: `面积: ${areaMm2.toFixed(4)} mm²`,
          resultValue: area,
        });
        this.measureInProgress = [];
        this.measureStart = null;
        this.requestRender();
        return;
      }

      if (this.measureActive) return;
      const hit = hitTest(this.msp(sp), this.layerManager, this.viewport);
      if (hit) {
        const dialog = createItemDetailDialog(hit, this.unitMode);
        document.body.appendChild(dialog);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isPanning) { this.isPanning = false; this.canvas.style.cursor = 'default'; }
      if (this.zoomAreaActive && this.zoomAreaStart && this.zoomAreaEnd) {
        const s = this.zoomAreaStart, en = this.zoomAreaEnd;
        const dx = Math.abs(en.x - s.x), dy = Math.abs(en.y - s.y);
        if (dx > 5 && dy > 5) {
          const x1 = Math.min(s.x, en.x), y1 = Math.min(s.y, en.y);
          const x2 = Math.max(s.x, en.x), y2 = Math.max(s.y, en.y);
          const w1 = this.viewport.screenToWorld(this.msp({ x: x1, y: y1 }));
          const w2 = this.viewport.screenToWorld(this.msp({ x: x2, y: y2 }));
          this.viewport.fitBoundingBox(pt(w1.x, w2.y), pt(w2.x, w1.y), 0.05);
          this.requestRender();
        }
        this.zoomAreaActive = false;
        this.zoomAreaStart = null;
        this.zoomAreaEnd = null;
        this.canvas.style.cursor = 'default';
        this.requestRender();
      }
    });

    // 右键上下文菜单
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      const key = e.key;
      if (key === 'Escape') {
        if (this.zoomAreaActive) {
          this.zoomAreaActive = false;
          this.zoomAreaStart = null;
          this.zoomAreaEnd = null;
          this.canvas.style.cursor = 'default';
          this.requestRender();
        } else if (this.measureActive) {
          if (this.measureInProgress.length > 0) {
            this.measureInProgress = [];
          } else {
            this.measureActive = false;
            this.measureStart = null;
            this.measureEnd = null;
            this.currentSnap = null;
            const btn = this.leftToolbarBtns.get('measure');
            if (btn) btn.classList.remove('active');
            const selBtn = this.leftToolbarBtns.get('select');
            if (selBtn) selBtn.classList.add('active');
          }
          this.requestRender();
        }
        return;
      }
      if (key === 'Home' || key === 'f') this.zoomFit();
      else if (key === '+' || key === '=') { this.viewport.zoom(1.5); this.requestRender(); }
      else if (key === '-') { this.viewport.zoom(1 / 1.5); this.requestRender(); }
      else if (key === 'g') { this.displayOptions.showGrid = !this.displayOptions.showGrid; this.syncLeftToolbar(); this.requestRender(); }
      else if (key === 'l') { this.displayOptions.linesFill = !this.displayOptions.linesFill; this.syncLeftToolbar(); this.requestRender(); }
      else if (key === 'p') { this.displayOptions.polygonsFill = !this.displayOptions.polygonsFill; this.syncLeftToolbar(); this.requestRender(); }
      else if (key === 'd') { this.displayOptions.showDcodes = !this.displayOptions.showDcodes; this.syncLeftToolbar(); this.requestRender(); }
      else if (key === 'S' && e.ctrlKey && e.shiftKey) { e.preventDefault(); this.toggleSimulation(!this.simulationActive); }
      else if (key === 'PageDown') { this.switchActiveLayer(1); }
      else if (key === 'PageUp') { this.switchActiveLayer(-1); }
    });

    if (!this.shareMode) {
      this.canvas.addEventListener('dragover', (e) => { e.preventDefault(); this.canvas.parentElement!.classList.add('drag-over'); });
      this.canvas.addEventListener('dragleave', () => { this.canvas.parentElement!.classList.remove('drag-over'); });
      this.canvas.addEventListener('drop', (e) => {
        e.preventDefault(); this.canvas.parentElement!.classList.remove('drag-over');
        if (e.dataTransfer?.files) this.loadFiles(Array.from(e.dataTransfer.files));
      });
    }
  }

  /** Mirror-aware screen point: flip X when canvas is mirrored */
  private msp(sp: Point): Point {
    if (this.displayOptions.mirror) return { x: this.viewport.canvasWidth - sp.x, y: sp.y };
    return sp;
  }

  private switchActiveLayer(dir: number) {
    const loaded: number[] = [];
    for (let i = 0; i < 32; i++) { if (this.layerManager.getLayer(i)) loaded.push(i); }
    if (loaded.length === 0) return;
    const cur = this.displayOptions.activeLayer;
    let idx = loaded.indexOf(cur);
    idx = (idx + dir + loaded.length) % loaded.length;
    this.displayOptions.activeLayer = loaded[idx];
    this.activeLayerSelect.value = String(loaded[idx]);
    this.updateLayerPanel(); this.updateFileInfo(); this.requestRender();
  }

  // ========== 捕捉引擎 ==========

  // 从单个元素提取捕捉点（经过变换后的世界坐标）
  private getItemSnapPoints(item: GerberItem, layer: GerberImage): SnapResult[] {
    const tp = (p: Point): Point => transformPointWorld(item, layer, p);
    const pts: SnapResult[] = [];
    const s = tp(item.start), e = tp(item.end);

    if (item.flashed) {
      pts.push({ world: s, type: SnapType.Center });
      return pts;
    }

    switch (item.shapeType) {
      case ShapeType.Segment:
        pts.push({ world: s, type: SnapType.Endpoint });
        pts.push({ world: e, type: SnapType.Endpoint });
        pts.push({ world: pt((s.x + e.x) / 2, (s.y + e.y) / 2), type: SnapType.Midpoint });
        break;

      case ShapeType.Arc: {
        const ac = tp(item.arcCenter);
        pts.push({ world: s, type: SnapType.Endpoint });
        pts.push({ world: e, type: SnapType.Endpoint });
        pts.push({ world: ac, type: SnapType.Center });
        const cx = item.arcCenter.x, cy = item.arcCenter.y;
        const r = Math.max(Math.abs(item.size.x), Math.abs(item.size.y)) / 2;
        if (r > 0) {
          const aStart = Math.atan2(item.start.y - cy, item.start.x - cx);
          const aEnd = Math.atan2(item.end.y - cy, item.end.x - cx);
          let da = aEnd - aStart;
          if (item.interpolation === 2) {
            if (da <= 0) da += Math.PI * 2;
          } else {
            if (da >= 0) da -= Math.PI * 2;
          }
          const aMid = aStart + da / 2;
          pts.push({ world: tp(pt(cx + r * Math.cos(aMid), cy + r * Math.sin(aMid))), type: SnapType.Midpoint });
        }
        break;
      }

      case ShapeType.Circle:
        pts.push({ world: tp(item.arcCenter), type: SnapType.Center });
        break;

      case ShapeType.Polygon:
        if (item.polygonPoints.length > 0) {
          for (let i = 0; i < item.polygonPoints.length; i++) {
            const tpi = tp(item.polygonPoints[i]);
            const next = tp(item.polygonPoints[(i + 1) % item.polygonPoints.length]);
            pts.push({ world: tpi, type: SnapType.Endpoint });
            pts.push({ world: pt((tpi.x + next.x) / 2, (tpi.y + next.y) / 2), type: SnapType.Midpoint });
          }
        }
        break;

      default:
        pts.push({ world: s, type: SnapType.Center });
        break;
    }
    return pts;
  }

  // 绘制元素高亮轮廓
  private drawItemHighlight(ctx: CanvasRenderingContext2D, hit: HitResult, color: string, lineW: number) {
    const { item, layer } = hit;
    const vp = this.viewport;
    const mirror = this.displayOptions.mirror;
    const w = vp.canvasWidth;
    const tp = (p: Point): Point => {
      const s = vp.worldToScreen(transformPointWorld(item, layer, p));
      return mirror ? { x: w - s.x, y: s.y } : s;
    };

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([4, 3]);

    switch (item.shapeType) {
      case ShapeType.Segment: {
        const lw = vp.worldToScreenDist(item.size.x);
        ctx.lineWidth = Math.max(lw, lineW);
        ctx.beginPath();
        ctx.moveTo(tp(item.start).x, tp(item.start).y);
        ctx.lineTo(tp(item.end).x, tp(item.end).y);
        ctx.stroke();
        break;
      }
      case ShapeType.Arc: {
        const center = tp(item.arcCenter);
        const s = tp(item.start);
        const e = tp(item.end);
        const r = Math.sqrt((s.x - center.x) ** 2 + (s.y - center.y) ** 2);
        const lw = vp.worldToScreenDist(item.size.x);
        ctx.lineWidth = Math.max(lw, lineW);
        if (r > 0.5) {
          const sa = Math.atan2(s.y - center.y, s.x - center.x);
          const ea = Math.atan2(e.y - center.y, e.x - center.x);
          const ccw = item.interpolation === Interpolation.ArcCCW;
          ctx.beginPath();
          ctx.arc(center.x, center.y, r, sa, ea, ccw);
          ctx.stroke();
        }
        break;
      }
      case ShapeType.Circle:
      case ShapeType.SpotCircle: {
        const c = tp(item.start);
        const r = vp.worldToScreenDist(item.size.x) / 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case ShapeType.SpotRect: {
        const c = tp(item.start);
        const hw = vp.worldToScreenDist(item.size.x) / 2;
        const hh = vp.worldToScreenDist(item.size.y) / 2;
        ctx.strokeRect(c.x - hw, c.y - hh, hw * 2, hh * 2);
        break;
      }
      case ShapeType.Polygon: {
        if (item.polygonPoints.length >= 3) {
          const pts = item.polygonPoints.map(tp);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath(); ctx.stroke();
        }
        break;
      }
      default: {
        const c = tp(item.start);
        const hw = vp.worldToScreenDist(item.size.x) / 2;
        const hh = vp.worldToScreenDist(item.size.y) / 2;
        ctx.strokeRect(c.x - hw, c.y - hh, hw * 2, hh * 2);
        break;
      }
    }
    ctx.restore();
  }

  // 在屏幕空间中查找最近捕捉点
  private findSnapPoint(screenPos: Point): SnapResult | null {
    const worldPos = this.viewport.screenToWorld(screenPos);
    const worldThreshold = SNAP_THRESHOLD_PX * this.viewport.scale;
    let bestDist = worldThreshold;
    let bestSnap: SnapResult | null = null;

    for (let li = 0; li < 32; li++) {
      const layer = this.layerManager.getLayer(li);
      if (!layer || !layer.visible) continue;
      for (const item of layer.items) {
        const snapPts = this.getItemSnapPoints(item, layer);
        for (const sp of snapPts) {
          const dx = sp.world.x - worldPos.x;
          const dy = sp.world.y - worldPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) {
            bestDist = dist;
            bestSnap = sp;
          }
        }
      }
    }
    return bestSnap;
  }

  private updateCoordDisplay(sp: { x: number; y: number }) {
    const w = this.viewport.screenToWorld(sp);
    let xs: string, ys: string;
    const conv = (v: number) => {
      switch (this.unitMode) {
        case 'inch': return (v / 2.54e7).toFixed(5);
        case 'mil': return (v / 25400).toFixed(2);
        default: return (v / IU_PER_MM).toFixed(4);
      }
    };
    xs = conv(w.x); ys = conv(w.y);
    const u = this.unitMode === 'inch' ? 'in' : this.unitMode === 'mil' ? 'mil' : 'mm';

    if (this.polarCoords && this.measureStart) {
      const dx = w.x - this.measureStart.x;
      const dy = w.y - this.measureStart.y;
      const r = conv(Math.sqrt(dx * dx + dy * dy));
      const theta = (Math.atan2(-dy, dx) * 180 / Math.PI).toFixed(1);
      this.coordDisplayEl.textContent = `r: ${r} ${u}  θ: ${theta}°`;
    } else {
      this.coordDisplayEl.textContent = `X: ${xs}  Y: ${ys} ${u}`;
    }
  }

  private resizeCanvas() {
    const container = this.canvas.parentElement!;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.viewport.dpr = dpr;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewport.canvasWidth = rect.width;
    this.viewport.canvasHeight = rect.height;
  }

  private requestRender() {
    requestAnimationFrame(() => {
      this.renderer.render();
      this.updateZoomDisplay();
      this.renderOverlays();
    });
  }

  private renderOverlays() {
    const ctx = this.ctx;
    const w = this.viewport.canvasWidth, h = this.viewport.canvasHeight;
    const sp = this.cursorScreenPos;
    const rect = this.canvas.getBoundingClientRect();
    const inCanvas = sp.x >= 0 && sp.x <= w && sp.y >= 0 && sp.y <= h;

    // 选中元素高亮
    if (this.selectedItem) {
      this.drawItemHighlight(ctx, this.selectedItem, this.theme.selectionHighlight, 2.5);
    }
    if (this.hoveredItem && this.hoveredItem !== this.selectedItem) {
      this.drawItemHighlight(ctx, this.hoveredItem, this.theme.selectionHighlight, 1.5);
    }

    // 全屏十字光标
    if (this.fullCursor && inCanvas) {
      ctx.save();
      ctx.strokeStyle = '#ffffff40';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, h);
      ctx.moveTo(0, sp.y); ctx.lineTo(w, sp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 框选缩放矩形
    if (this.zoomAreaActive && this.zoomAreaStart && this.zoomAreaEnd) {
      const s = this.zoomAreaStart, en = this.zoomAreaEnd;
      const rx = Math.min(s.x, en.x), ry = Math.min(s.y, en.y);
      const rw = Math.abs(en.x - s.x), rh = Math.abs(en.y - s.y);
      ctx.save();
      ctx.strokeStyle = 'var(--accent)';
      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = '#0078d420';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 测量尺 — 使用 measurement 模块渲染持久化测量
    if (this.measureActive) {
      let cursorWorld: Point | null = null;
      if (this.currentSnap) cursorWorld = this.currentSnap.world;
      else if (inCanvas) cursorWorld = this.viewport.screenToWorld(this.msp(sp));

      renderMeasurements(ctx, this.viewport, this.measureMgr, this.unitMode,
        this.measureMode, this.measureInProgress, cursorWorld);
    }

    // 捕捉指示器（测量模式下显示）
    if (this.measureActive && this.currentSnap && inCanvas) {
      const snapScreen = this.viewport.worldToScreen(this.currentSnap.world);
      const sx = snapScreen.x, sy = snapScreen.y;
      const sz = 6; // 标记半径

      ctx.save();
      ctx.lineWidth = 1.5;

      if (this.currentSnap.type === SnapType.Endpoint) {
        // 端点：绿色方形
        ctx.strokeStyle = '#00ff00';
        ctx.strokeRect(sx - sz, sy - sz, sz * 2, sz * 2);
      } else if (this.currentSnap.type === SnapType.Midpoint) {
        // 中点：黄色菱形
        ctx.strokeStyle = '#ffff00';
        ctx.beginPath();
        ctx.moveTo(sx, sy - sz);
        ctx.lineTo(sx + sz, sy);
        ctx.lineTo(sx, sy + sz);
        ctx.lineTo(sx - sz, sy);
        ctx.closePath();
        ctx.stroke();
      } else if (this.currentSnap.type === SnapType.Center) {
        // 中心：青色圆 + 十字
        ctx.strokeStyle = '#00ffff';
        ctx.beginPath();
        ctx.arc(sx, sy, sz, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - sz - 2, sy);
        ctx.lineTo(sx + sz + 2, sy);
        ctx.moveTo(sx, sy - sz - 2);
        ctx.lineTo(sx, sy + sz + 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private updateZoomDisplay() {
    const mm = this.viewport.getZoomMmPerPx();
    this.zoomDisplayEl.textContent = mm >= 1 ? `缩放: ${mm.toFixed(2)} mm/px`
      : mm >= 0.01 ? `缩放: ${(mm * 1000).toFixed(1)} µm/px`
      : `缩放: ${(mm * 1e6).toFixed(1)} nm/px`;
  }

  private updateFileInfo() {
    const idx = this.displayOptions.activeLayer;
    if (idx < 0) {
      this.fileInfoEl.textContent = 'GerberView';
      return;
    }
    const layer = this.layerManager.getLayer(idx);
    if (!layer) {
      this.fileInfoEl.textContent = 'GerberView';
      return;
    }
    const parts: string[] = [layer.fileName || `图层 ${idx}`];
    if (layer.fileFunction) parts.push(layer.fileFunction);
    const dCount = layer.items.filter(i => i.dCode >= 10).length;
    const fCount = layer.items.filter(i => i.flashed).length;
    const lCount = layer.items.filter(i => !i.flashed).length;
    parts.push(`${layer.items.length} 项 (线${lCount}/焊盘${fCount})`);
    if (layer.imagePolarity === 'NEG') parts.push('负极性(IP)');
    if (layer.filePolarity) parts.push(`文件极性: ${layer.filePolarity}`);
    this.fileInfoEl.textContent = parts.join(' | ');
  }

  // ========== 文件操作 ==========

  private openFiles(type: string) {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    // gerber 列表包含常见与非标准扩展名 (PCB 软件常用 .top/.bot/.tsm/.bsm/.brd 等)
    const gerberExts = '.gbr,.ger,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gko,.gm1,.gm2,.gm3,.top,.bot,.tsm,.bsm,.tslk,.bslk,.brd,.cmp,.sol,.stc,.sts,.plc,.pls';
    const drillExts = '.drl,.txt,.xln,.drd,.ncd';
    // 三个菜单均支持 ZIP：ZIP 内的文件用内容检测识别类型
    input.accept = type === 'excellon' ? drillExts + ',.zip'
      : type === 'gerber' ? gerberExts + ',.zip'
      : gerberExts + ',' + drillExts + ',.zip';
    input.addEventListener('change', () => { if (input.files?.length) this.loadFiles(Array.from(input.files)); });
    input.click();
  }

  private async loadFiles(files: File[]) {
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        await this.loadZipFile(file);
        continue;
      }
      await this.loadSingleFile(file);
    }
    this.updateLayerPanel(); this.updateActiveLayerSelect(); this.populateX2Selectors(); this.updateFileInfo(); this.zoomFit();
    // 加载后按板结构自动排序
    this.layerManager.sortByBoardStructure();
    this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
  }

  private async loadZipFile(file: File) {
    try {
      const zip = await JSZip.loadAsync(file);

      // 扩展名黑名单：明确不是 PCB 制造数据的文件（报告、说明等）
      const skipExts = ['.rep', '.pdf', '.png', '.jpg', '.jpeg', '.csv', '.drl.rpt', '.json', '.html', '.htm'];

      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const fileName = path.split('/').pop() || path;
        const ext = '.' + (fileName.split('.').pop() ?? '').toLowerCase();
        if (skipExts.includes(ext)) continue;

        const layerIndex = this.layerManager.getLoadedCount();
        if (layerIndex >= 32) break;

        // 用内容检测而非扩展名白名单：PCB 软件常用非标准扩展名
        // (如 .BOT/.TOP/.TSM/.TSLK/.BSM/.BRD/.NCD 等)，靠 detectGerberFile
        // /detectExcellonFile 判断文件实际类型，避免漏载。
        const text = await entry.async('string');
        const isExcellon = detectExcellonFile(text);
        const isGerber = !isExcellon && detectGerberFile(text);
        if (!isExcellon && !isGerber) continue;

        let image: GerberImage;
        if (isExcellon) {
          image = new ExcellonParser().parse(text, fileName, layerIndex);
        } else {
          image = new GerberParser().parse(text, fileName, layerIndex);
        }
        this.layerManager.addLayer(image);
        // 自动识别图层类型并着色
        const lt = this.detectLayerType(fileName, image.fileFunction);
        image.layerType = lt;
        if (LAYER_TYPE_COLORS[lt]) {
          image.color = LAYER_TYPE_COLORS[lt];
        }
        if (image.layerName === '' && lt !== LayerType.Unknown) {
          image.layerName = LAYER_TYPE_LABELS[lt];
        }
      }
    } catch (err) {
      console.error('ZIP 解压失败:', err);
    }
  }

  private async loadSingleFile(file: File) {
    const layerIndex = this.layerManager.getLoadedCount();
    if (layerIndex >= 32) return;

    const text = await file.text();
    let image: GerberImage;
    if (detectExcellonFile(text)) {
      image = new ExcellonParser().parse(text, file.name, layerIndex);
    } else {
      image = new GerberParser().parse(text, file.name, layerIndex);
    }
    this.layerManager.addLayer(image);
    // 自动识别图层类型并着色
    const lt = this.detectLayerType(file.name, image.fileFunction);
    image.layerType = lt;
    if (LAYER_TYPE_COLORS[lt]) {
      image.color = LAYER_TYPE_COLORS[lt];
    }
    if (image.layerName === '' && lt !== LayerType.Unknown) {
      image.layerName = LAYER_TYPE_LABELS[lt];
    }
  }

  private detectLayerType(fileName: string, fileFunction: string): LayerType {
    // 优先使用 TF.FileFunction 属性
    if (fileFunction) {
      const ff = fileFunction.toLowerCase();
      if (ff.startsWith('copper')) {
        if (ff.includes(',l1,') || ff.includes(',top')) return LayerType.TopCopper;
        if (ff.includes(',l2,') && (ff.includes(',bot') || ff.includes('bottom'))) return LayerType.BottomCopper;
        // 尝试从层号推断
        const m = ff.match(/,l(\d+),/);
        if (m) {
          const n = parseInt(m[1]);
          if (n === 1) return LayerType.TopCopper;
          return LayerType.InnerCopper;
        }
        if (ff.includes('bot')) return LayerType.BottomCopper;
        return LayerType.TopCopper;
      }
      if (ff.startsWith('soldermask')) {
        if (ff.includes('bot')) return LayerType.BottomSolderMask;
        return LayerType.TopSolderMask;
      }
      if (ff.startsWith('silkscreen')) {
        if (ff.includes('bot')) return LayerType.BottomSilkscreen;
        return LayerType.TopSilkscreen;
      }
      if (ff.startsWith('paste')) {
        if (ff.includes('bot')) return LayerType.BottomPaste;
        return LayerType.TopPaste;
      }
      if (ff.includes('profile') || ff.includes('outline') || ff.includes('edge')) {
        return LayerType.EdgeCuts;
      }
      if (ff.startsWith('drill') || ff.startsWith('plated') || ff.includes('non-plated')) {
        return LayerType.Drill;
      }
    }

    // 回退到文件名模式匹配
    const name = fileName.toLowerCase();
    const ext = name.split('.').pop() || '';

    // KiCad 标准扩展名
    if (ext === 'gtl' || ext === 'cu') return LayerType.TopCopper;
    if (ext === 'gbl') return LayerType.BottomCopper;
    if (ext === 'gts') return LayerType.TopSolderMask;
    if (ext === 'gbs') return LayerType.BottomSolderMask;
    if (ext === 'gto') return LayerType.TopSilkscreen;
    if (ext === 'gbo') return LayerType.BottomSilkscreen;
    if (ext === 'gtp') return LayerType.TopPaste;
    if (ext === 'gbp') return LayerType.BottomPaste;
    if (ext === 'gko' || ext === 'gm1' || ext === 'gbr轮廓') return LayerType.EdgeCuts;
    if (ext === 'xnc' || ext === 'drl' || ext === 'drl') return LayerType.Drill;
    // PADS / OrCAD / Allegro 等非标准扩展名 (常见于生产文件 ZIP 内)
    if (ext === 'top' || ext === 'cmp' || ext === 'plc' || ext === 'ly1') return LayerType.TopCopper;
    if (ext === 'bot' || ext === 'sol' || ext === 'pls' || ext === 'ly2') return LayerType.BottomCopper;
    if (ext === 'tsm' || ext === 'smt' || ext === 'ssm' || ext === 'sm') return LayerType.TopSolderMask;
    if (ext === 'bsm' || ext === 'smb') return LayerType.BottomSolderMask;
    if (ext === 'tslk' || ext === 'sst' || ext === 'ssc' || ext === 'sil') return LayerType.TopSilkscreen;
    if (ext === 'bslk' || ext === 'ssb') return LayerType.BottomSilkscreen;
    if (ext === 'brd' || ext === 'outline') return LayerType.EdgeCuts;
    if (ext === 'ncd' || ext === 'nc' || ext === 'tap') return LayerType.Drill;

    // 文件名关键词
    if (/(?:^|[-_.])f?cu(?:[-_.]|$)/i.test(name) || /top.*copper|copper.*top/i.test(name)) return LayerType.TopCopper;
    if (/(?:^|[-_.])b?cu(?:[-_.]|$)/i.test(name) || /bot.*copper|copper.*bot/i.test(name)) return LayerType.BottomCopper;
    if (/inner|internal|in\d/i.test(name) && /cu/i.test(name)) return LayerType.InnerCopper;
    if (/(?:^|[-_.])(?:f\.?s(?:m|s)|top.*sold(?:er)?mask|sold(?:er)?mask.*top)/i.test(name)) return LayerType.TopSolderMask;
    if (/(?:^|[-_.])(?:b\.?s(?:m|s)|bot.*sold(?:er)?mask|sold(?:er)?mask.*bot)/i.test(name)) return LayerType.BottomSolderMask;
    if (/(?:^|[-_.])(?:f\.?silks|top.*silk|silk.*top)/i.test(name)) return LayerType.TopSilkscreen;
    if (/(?:^|[-_.])(?:b\.?silks|bot.*silk|silk.*bot)/i.test(name)) return LayerType.BottomSilkscreen;
    if (/(?:^|[-_.])top.*paste|paste.*top/i.test(name)) return LayerType.TopPaste;
    if (/(?:^|[-_.])bot.*paste|paste.*bot/i.test(name)) return LayerType.BottomPaste;
    if (/(?:^|[-_.])(?:edge(?:\.?cut)?|outline|profile|board)/i.test(name)) return LayerType.EdgeCuts;
    if (/(?:^|[-_.])(?:npth|pth|drill|drl|drills?)/i.test(name)) return LayerType.Drill;

    // 常见 PCB 数据命名模式: PROJECTNAME-LAYERNAME.gbr
    const parts = name.replace(/\.[^.]+$/, '').split(/[-_]/);
    for (const p of parts) {
      if (/^f(?:cu|copper)$/i.test(p)) return LayerType.TopCopper;
      if (/^b(?:cu|copper)$/i.test(p)) return LayerType.BottomCopper;
      if (/^(?:in\d+|inner)$/i.test(p)) return LayerType.InnerCopper;
      if (/^f\.?s(?:m|s)?$/i.test(p)) return LayerType.TopSolderMask;
      if (/^b\.?s(?:m|s)?$/i.test(p)) return LayerType.BottomSolderMask;
      if (/^f\.?silks?$/i.test(p)) return LayerType.TopSilkscreen;
      if (/^b\.?silks?$/i.test(p)) return LayerType.BottomSilkscreen;
      if (/^f\.?paste$/i.test(p)) return LayerType.TopPaste;
      if (/^b\.?paste$/i.test(p)) return LayerType.BottomPaste;
      if (/^(?:edge|outline|profile)$/i.test(p)) return LayerType.EdgeCuts;
      if (/^(?:npth|pth|drill|drills?)$/i.test(p)) return LayerType.Drill;
    }

    return LayerType.Unknown;
  }

  // ========== 图层面板 ==========

  /** 创建单个图层行 */
  private createLayerRow(i: number, layer: GerberImage): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer-row' + (this.displayOptions.activeLayer === i ? ' active-layer' : '');
    row.draggable = true;
    row.dataset.layerIndex = String(i);
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/plain', String(i));
      row.style.opacity = '0.5';
    });
    row.addEventListener('dragend', () => { row.style.opacity = ''; row.classList.remove('drag-over-top', 'drag-over-bottom'); });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      row.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < midY) row.classList.add('drag-over-top');
      else row.classList.add('drag-over-bottom');
    });
    row.addEventListener('dragleave', () => { row.classList.remove('drag-over-top', 'drag-over-bottom'); });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over-top', 'drag-over-bottom');
      const fromIdx = parseInt(e.dataTransfer!.getData('text/plain'));
      if (isNaN(fromIdx) || fromIdx === i) return;
      // 跨分类拖拽时自动设置 displayCategory，让图层跟随目标分类
      const fromLayer = this.layerManager.getLayer(fromIdx);
      if (fromLayer) {
        const srcCat = fromLayer.displayCategory || LAYER_CATEGORIES.find(c => c.types.includes(fromLayer.layerType))?.label;
        const dstCat = layer.displayCategory || LAYER_CATEGORIES.find(c => c.types.includes(layer.layerType))?.label;
        if (dstCat && srcCat !== dstCat) fromLayer.displayCategory = dstCat;
      }
      const rect = row.getBoundingClientRect();
      const insertBefore = e.clientY < (rect.top + rect.height / 2);
      this.moveLayerTo(fromIdx, i, insertBefore);
      this.updateLayerPanel();
      this.updateActiveLayerSelect();
      this.requestRender();
    });

    const arrow = document.createElement('span');
    arrow.className = 'active-arrow' + (this.displayOptions.activeLayer === i ? '' : ' hidden');
    arrow.textContent = '▶';

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'layer-checkbox'; cb.checked = layer.visible;
    cb.addEventListener('change', (e) => { e.stopPropagation(); layer.visible = cb.checked; this.requestRender(); });

    const swatch = document.createElement('div');
    swatch.className = 'layer-color-swatch';
    swatch.style.backgroundColor = layer.color;
    swatch.addEventListener('click', (e) => { e.stopPropagation(); this.showLayerColorDialog(layer, swatch); });

    const name = document.createElement('span');
    name.className = 'layer-name-text';
    const displayName = layer.layerName || `图层 ${i}`;
    const fileName = layer.fileName || '';
    name.textContent = displayName !== fileName ? `${displayName}(${fileName})` : displayName;
    name.title = fileName || displayName;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'layer-type-select';
    for (const lt of Object.values(LayerType)) {
      const opt = document.createElement('option');
      opt.value = lt; opt.textContent = LAYER_TYPE_LABELS[lt];
      if (layer.layerType === lt) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener('change', () => {
      const newType = typeSelect.value as LayerType;
      layer.layerType = newType;
      layer.displayCategory = null; // 手动改类型后回到自然分类
      if (LAYER_TYPE_COLORS[newType]) layer.color = LAYER_TYPE_COLORS[newType];
      if (newType !== LayerType.Unknown && LAYER_TYPE_LABELS[newType]) layer.layerName = LAYER_TYPE_LABELS[newType];
      this.updateLayerPanel();
      this.requestRender();
    });

    const del = document.createElement('button');
    del.className = 'layer-del'; del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation(); this.layerManager.removeLayer(i);
      this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
    });

    const opacityWrap = document.createElement('div');
    opacityWrap.className = 'layer-opacity-wrap';
    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range'; opacitySlider.min = '0'; opacitySlider.max = '100';
    opacitySlider.value = String(Math.round(layer.opacity * 100));
    opacitySlider.className = 'layer-opacity-slider';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'number'; opacityInput.min = '0'; opacityInput.max = '100';
    opacityInput.value = String(Math.round(layer.opacity * 100));
    opacityInput.className = 'layer-opacity-input';
    opacityInput.title = '透明度 %';

    const syncOpacity = (val: number) => {
      val = Math.max(0, Math.min(100, val));
      layer.opacity = val / 100;
      opacitySlider.value = String(val);
      opacityInput.value = String(val);
      this.requestRender();
    };
    opacitySlider.addEventListener('input', (e) => { e.stopPropagation(); syncOpacity(parseInt(opacitySlider.value)); });
    opacityInput.addEventListener('input', (e) => { e.stopPropagation(); const v = parseInt(opacityInput.value); if (!isNaN(v)) syncOpacity(v); });
    opacitySlider.addEventListener('click', (e) => e.stopPropagation());
    opacityInput.addEventListener('click', (e) => e.stopPropagation());

    opacityWrap.appendChild(opacitySlider);
    opacityWrap.appendChild(opacityInput);

    row.appendChild(arrow); row.appendChild(cb); row.appendChild(swatch); row.appendChild(name); row.appendChild(typeSelect);
    row.appendChild(opacityWrap);
    row.appendChild(del);

    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'SELECT') return;
      this.displayOptions.activeLayer = i;
      this.activeLayerSelect.value = String(i);
      this.updateLayerPanel(); this.updateFileInfo(); this.requestRender();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.showLayerContextMenu(e.clientX, e.clientY, i, layer, swatch);
    });
    row.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.showLayerContextMenu(row.getBoundingClientRect().right, row.getBoundingClientRect().top, i, layer, swatch);
    });
    return row;
  }

  private updateLayerPanel() {
    this.layerListEl.innerHTML = '';

    // 收集已加载图层
    const loadedLayers: { index: number; layer: GerberImage }[] = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      const layer = this.layerManager.getLayer(i);
      if (layer) loadedLayers.push({ index: i, layer });
    }
    if (loadedLayers.length === 0) return;

    const categories = LAYER_CATEGORIES.map(c => ({ label: c.label, types: new Set(c.types) }));

    // 更新"全部"复选框状态
    const updateAllCheck = (allCb: HTMLInputElement) => {
      allCb.checked = loadedLayers.every(({ layer }) => layer.visible);
      allCb.indeterminate = !allCb.checked && loadedLayers.some(({ layer }) => layer.visible);
    };

    // ── "全部图层" 行 ──
    const allRow = document.createElement('div');
    allRow.className = 'layer-all-toggle';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox'; allCb.className = 'category-checkbox';
    allCb.checked = loadedLayers.every(({ layer }) => layer.visible);
    allCb.indeterminate = !allCb.checked && loadedLayers.some(({ layer }) => layer.visible);
    allCb.addEventListener('change', (e) => {
      e.stopPropagation();
      const v = allCb.checked;
      for (const { layer } of loadedLayers) layer.visible = v;
      this.layerListEl.querySelectorAll<HTMLInputElement>('.category-checkbox').forEach(c => { c.checked = v; c.indeterminate = false; });
      this.layerListEl.querySelectorAll<HTMLInputElement>('.layer-checkbox').forEach(c => { c.checked = v; });
      this.requestRender();
    });
    const allLabel = document.createElement('span');
    allLabel.className = 'category-label'; allLabel.textContent = '全部图层';
    const allCount = document.createElement('span');
    allCount.className = 'category-count'; allCount.textContent = `(${loadedLayers.length})`;
    allRow.appendChild(allCb); allRow.appendChild(allLabel); allRow.appendChild(allCount);
    this.layerListEl.appendChild(allRow);

    // ── 分类树 ──
    for (const cat of categories) {
      const catLayers = loadedLayers.filter(({ layer }) => {
        if (layer.displayCategory) return layer.displayCategory === cat.label;
        return cat.types.has(layer.layerType);
      });
      if (catLayers.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'layer-category-group';

      // 分类头部
      const header = document.createElement('div');
      header.className = 'layer-category-header';

      const toggle = document.createElement('span');
      toggle.className = 'category-toggle'; toggle.textContent = '▼';

      const catCb = document.createElement('input');
      catCb.type = 'checkbox'; catCb.className = 'category-checkbox';
      catCb.checked = catLayers.every(({ layer }) => layer.visible);
      catCb.indeterminate = !catCb.checked && catLayers.some(({ layer }) => layer.visible);

      const catLabel = document.createElement('span');
      catLabel.className = 'category-label'; catLabel.textContent = cat.label;

      const catCount = document.createElement('span');
      catCount.className = 'category-count'; catCount.textContent = `(${catLayers.length})`;

      header.appendChild(toggle); header.appendChild(catCb); header.appendChild(catLabel); header.appendChild(catCount);

      const children = document.createElement('div');
      children.className = 'layer-category-children';

      // 允许拖拽图层到分类头部以移动到该分类
      header.addEventListener('dragover', (e) => {
        e.preventDefault();
        header.classList.add('drag-over-category');
      });
      header.addEventListener('dragleave', () => { header.classList.remove('drag-over-category'); });
      header.addEventListener('drop', (e) => {
        e.preventDefault();
        header.classList.remove('drag-over-category');
        const fromIdx = parseInt(e.dataTransfer!.getData('text/plain'));
        if (isNaN(fromIdx)) return;
        const layer = this.layerManager.getLayer(fromIdx);
        if (!layer) return;
        // 如果拖到自身所在的分类，不处理
        const srcCat = layer.displayCategory || categories.find(c => c.types.has(layer.layerType))?.label;
        if (srcCat === cat.label) return;
        layer.displayCategory = cat.label;
        this.updateLayerPanel();
        this.requestRender();
      });

      // 折叠/展开
      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        const collapsed = children.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '▶' : '▼';
      });

      // 分类复选框：批量切换子图层可见性
      const updateCatCheck = () => {
        catCb.checked = catLayers.every(({ layer }) => layer.visible);
        catCb.indeterminate = !catCb.checked && catLayers.some(({ layer }) => layer.visible);
      };
      catCb.addEventListener('change', (e) => {
        e.stopPropagation();
        const v = catCb.checked;
        for (const { layer } of catLayers) layer.visible = v;
        children.querySelectorAll<HTMLInputElement>('.layer-checkbox').forEach(c => { c.checked = v; });
        updateAllCheck(allCb);
        this.requestRender();
      });

      // 添加图层行
      for (const { index, layer } of catLayers) {
        const row = this.createLayerRow(index, layer);
        // 图层勾选变化时同步更新父级复选框
        const cb = row.querySelector('.layer-checkbox') as HTMLInputElement;
        cb.addEventListener('change', () => { updateCatCheck(); updateAllCheck(allCb); });
        children.appendChild(row);
      }

      group.appendChild(header); group.appendChild(children);
      this.layerListEl.appendChild(group);
    }
  }

  private moveLayerTo(fromIdx: number, toIdx: number, insertBefore: boolean) {
    // 收集所有已加载图层（保持顺序）
    const loaded: (GerberImage | null)[] = [];
    const loadedIndices: number[] = [];
    for (let k = 0; k < 32; k++) {
      if (this.layerManager.getLayer(k)) {
        loaded.push(this.layerManager.getLayer(k));
        loadedIndices.push(k);
      }
    }
    const fromPos = loadedIndices.indexOf(fromIdx);
    const toPos = loadedIndices.indexOf(toIdx);
    if (fromPos === -1 || toPos === -1) return;

    // 取出被拖动的图层
    const moved = loaded.splice(fromPos, 1)[0]!;
    // 重新计算目标位置（splice后偏移了）
    const adjustedTo = fromPos < toPos ? toPos - 1 : toPos;
    const insertPos = insertBefore ? adjustedTo : adjustedTo + 1;
    loaded.splice(insertPos, 0, moved);

    // 重建 layers 数组
    for (let k = 0; k < 32; k++) this.layerManager.layers[k] = null;
    for (let k = 0; k < loaded.length; k++) {
      if (loaded[k]) {
        loaded[k]!.layerIndex = k;
        this.layerManager.layers[k] = loaded[k];
      }
    }
  }

  private updateActiveLayerSelect() {
    this.activeLayerSelect.innerHTML = '<option value="-1">无</option>';
    for (let i = 0; i < 32; i++) {
      const layer = this.layerManager.getLayer(i);
      if (!layer) continue;
      const opt = document.createElement('option');
      opt.value = String(i); opt.textContent = layer.layerName || layer.fileName || `图层 ${i}`;
      this.activeLayerSelect.appendChild(opt);
    }
    this.activeLayerSelect.value = String(this.displayOptions.activeLayer);
  }

  private populateX2Selectors() {
    const allNets = new Set<string>();
    const allComps = new Set<string>();
    const allAttrs = new Set<string>();
    for (let i = 0; i < 32; i++) {
      const layer = this.layerManager.getLayer(i);
      if (!layer) continue;
      layer.netNames.forEach(n => allNets.add(n));
      layer.componentRefs.forEach(c => allComps.add(c));
      layer.aperFunctions.forEach(a => allAttrs.add(a));
    }

    const populate = (sel: HTMLSelectElement, items: Set<string>) => {
      const prev = sel.value;
      sel.innerHTML = '<option value="">-</option>';
      for (const item of [...items].sort()) {
        const opt = document.createElement('option'); opt.value = item; opt.textContent = item;
        sel.appendChild(opt);
      }
      sel.value = prev;
    };
    populate(this._netSel, allNets);
    populate(this._compSel, allComps);
    populate(this._attrSel, allAttrs);
  }

  // ========== 视图 ==========

  private zoomFit() {
    const bb = this.layerManager.computeTotalBoundingBox();
    if (bb) this.viewport.fitBoundingBox(bb.min, bb.max);
    this.requestRender();
  }

  private zoomToSelection() {
    this.zoomAreaActive = true;
    this.zoomAreaStart = null;
    this.zoomAreaEnd = null;
    this.canvas.style.cursor = 'crosshair';
  }

  private clearAll() {
    this.layerManager.clearAll();
    this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
  }

  private setAllLayersVisible(v: boolean) {
    for (let i = 0; i < 32; i++) { const l = this.layerManager.getLayer(i); if (l) l.visible = v; }
    this.updateLayerPanel(); this.requestRender();
  }

  private sortLayers() {
    const layers = this.layerManager.layers.filter(l => l !== null) as GerberImage[];
    if (layers.length === 0) return;
    const order: Record<string, number> = {
      '.gko': 0, '.gm1': 1, '.gtl': 2, '.gto': 3, '.gts': 4, '.gbo': 5,
      '.gbl': 6, '.gbs': 7, '.drl': 8, '.txt': 9,
    };
    layers.sort((a, b) => {
      const ea = (a.fileName.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const eb = (b.fileName.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      return (order[ea] ?? 99) - (order[eb] ?? 99);
    });
    this.layerManager.clearAll();
    for (const layer of layers) this.layerManager.addLayer(layer);
    this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
  }

  // ========== 右键上下文菜单 ==========

  private showContextMenu(x: number, y: number) {
    // 移除已有菜单
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const items: { label: string; action?: () => void; separator?: boolean; checked?: boolean }[] = [
      { label: '适应窗口 (Home)', action: () => this.zoomFit() },
      { label: '放大', action: () => { this.viewport.zoom(1.5); this.requestRender(); } },
      { label: '缩小', action: () => { this.viewport.zoom(1 / 1.5); this.requestRender(); } },
      { separator: true, label: '' },
      { label: '显示网格', action: () => { this.displayOptions.showGrid = !this.displayOptions.showGrid; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.showGrid },
      { label: '高对比度模式', action: () => { this.displayOptions.highContrastMode = !this.displayOptions.highContrastMode; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.highContrastMode },
      { separator: true, label: '' },
      { label: '焊盘填充', action: () => { this.displayOptions.flashesFill = !this.displayOptions.flashesFill; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.flashesFill },
      { label: '线条填充', action: () => { this.displayOptions.linesFill = !this.displayOptions.linesFill; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.linesFill },
      { label: '多边形填充', action: () => { this.displayOptions.polygonsFill = !this.displayOptions.polygonsFill; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.polygonsFill },
      { separator: true, label: '' },
      { label: '差异模式', action: () => { this.displayOptions.xorMode = !this.displayOptions.xorMode; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.xorMode },
      { label: '镜像视图', action: () => { this.displayOptions.mirror = !this.displayOptions.mirror; this.syncLeftToolbar(); this.requestRender(); }, checked: this.displayOptions.mirror },
      { separator: true, label: '' },
      { label: '仿真视图', action: () => { this.toggleSimulation(!this.simulationActive); }, checked: this.simulationActive },
      { label: '仿真翻转', action: () => { this.toggleSimFlip(); } },
      { separator: true, label: '' },
      { label: '导出 PNG...', action: () => this.exportPNG() },
      { label: '导出 SVG...', action: () => this.exportSVG() },
      { label: '导出 DXF...', action: () => this.exportDXF() },
    ];

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div'); sep.className = 'ctx-sep';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'ctx-item' + (item.checked ? ' checked' : '');
        el.textContent = item.label;
        el.addEventListener('click', () => { menu.remove(); item.action?.(); });
        menu.appendChild(el);
      }
    }

    document.body.appendChild(menu);

    // 调整位置避免超出窗口
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    // 点击任意处关闭
    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', closeHandler); }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
  }

  private async exportPNG() {
    if (this.layerManager.getLoadedCount() === 0) {
      alert('请先加载 Gerber 文件再导出 PNG。');
      return;
    }
    showExportPngDialog(this.layerManager, async ({ dpi, selectedLayers }) => {
      try {
        const blob = await exportLayersAsZip(this.layerManager, selectedLayers, dpi, this.displayOptions);
        downloadZip(blob);
      } catch (err) {
        console.error('导出 PNG 失败:', err);
        alert('导出失败: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  }

  private exportSVG() {
    if (this.layerManager.getLoadedCount() === 0) {
      alert('请先加载 Gerber 文件再导出 SVG。');
      return;
    }
    showExportSvgDialog(this.layerManager, (selectedLayers) => {
      const svg = exportToSVG(this.layerManager, this.theme.canvasBackground, selectedLayers);
      if (svg) downloadSVG(svg);
    });
  }

  private exportDXF() {
    showExportDxfDialog(this.layerManager, (config) => {
      const dxf = exportToDXF(this.layerManager, config);
      if (dxf) downloadDXF(dxf);
    });
  }

  async loadEmbeddedData() {
    const lm = await loadShareData();
    if (!lm) return;
    this.layerManager = lm;
    this.renderer = new Renderer(this.ctx, this.viewport, this.layerManager);
    this.renderer.displayOptions = this.displayOptions;
    this.resizeCanvas();
    this.updateLayerPanel();
    this.updateActiveLayerSelect();
    this.populateX2Selectors();
    this.updateFileInfo();
    this.zoomFit();
  }

  private toggleSimulation(active: boolean) {
    this.simulationActive = active;
    this.simulationFlip = false;
    if (active) {
      this.savedFillState = {
        lines: this.displayOptions.linesFill,
        flashes: this.displayOptions.flashesFill,
        polygons: this.displayOptions.polygonsFill,
      };
      this.displayOptions.linesFill = true;
      this.displayOptions.flashesFill = true;
      this.displayOptions.polygonsFill = true;
      this.displayOptions.simulationMode = true;
      // 默认显示顶层视图：隐藏底层图层
      this.setSimulationSide(false);
    } else {
      this.displayOptions.linesFill = this.savedFillState.lines;
      this.displayOptions.flashesFill = this.savedFillState.flashes;
      this.displayOptions.polygonsFill = this.savedFillState.polygons;
      this.displayOptions.simulationMode = false;
      this.displayOptions.mirror = false;
    }
    this.syncLeftToolbar();
    this.updateLayerPanel();
    this.requestRender();
  }

  private toggleSimFlip() {
    if (!this.simulationActive) return;
    this.simulationFlip = !this.simulationFlip;
    this.displayOptions.mirror = this.simulationFlip;
    this.setSimulationSide(this.simulationFlip);
    this.syncLeftToolbar();
    this.updateLayerPanel();
    this.requestRender();
  }

  private setSimulationSide(isBottom: boolean) {
    const bottomTypes = new Set(['bottomCopper', 'bottomSolderMask', 'bottomSilkscreen', 'bottomPaste']);
    const topTypes = new Set(['topCopper', 'topSolderMask', 'topSilkscreen', 'topPaste']);
    const hideTypes = isBottom ? topTypes : bottomTypes;
    for (const layer of this.layerManager.layers) {
      if (!layer) continue;
      if (hideTypes.has(layer.layerType)) {
        layer.visible = false;
      } else {
        layer.visible = true;
      }
    }
  }

  private async exportShareHTML() {
    if (this.layerManager.getLoadedCount() === 0) {
      alert('请先加载 Gerber 文件再导出分享 HTML。');
      return;
    }
    showShareDialog(this.layerManager, async (selectedLayers) => {
      try {
        const blob = await generateShareHTML(this.layerManager, selectedLayers);
        downloadShareHTML(blob);
      } catch (err) {
        console.error('导出分享 HTML 失败:', err);
        alert('导出失败: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  }

  private showDfmReport() {
    const report = runDfmAnalysis(this.layerManager);
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.minWidth = '380px';

    let html = `<div class="dialog-title">DFM 分析报告</div><div class="dialog-body">`;
    html += `<div class="dialog-section-title">概览</div>`;
    html += `<table class="item-detail-table">`;
    html += `<tr><td>可见图层数</td><td>${report.totalLayers}</td></tr>`;
    html += `<tr><td>分析项目数</td><td>${report.totalItems}</td></tr>`;
    html += `</table>`;

    html += `<div class="dialog-section-title">最小尺寸分析</div>`;
    html += `<table class="item-detail-table">`;
    html += `<tr><td>最小线宽</td><td>${formatDfmValue(report.minWidth, this.unitMode)}</td></tr>`;
    html += `<tr><td>最小线距</td><td>${formatDfmValue(report.minSpacing, this.unitMode)}</td></tr>`;
    html += `<tr><td>最小孔径</td><td>${formatDfmValue(report.minDrillSize, this.unitMode)}</td></tr>`;
    html += `<tr><td>最小环宽</td><td>${formatDfmValue(report.minAnnularRing, this.unitMode)}</td></tr>`;
    html += `</table>`;

    html += `</div>`;
    html += `<div class="dialog-buttons"><button class="dialog-btn dialog-btn-primary" id="dfm-close">关闭</button></div>`;
    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    overlay.querySelector('#dfm-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  private showAboutDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '420px';
    dialog.innerHTML = `
      <div class="dialog-title">关于 GerberView</div>
      <div style="padding:4px 0 12px;font-size:13px;line-height:1.8;color:var(--text-primary);">
        <div style="font-size:16px;font-weight:bold;margin-bottom:8px;">GerberView Web${this.shareMode ? ' <span style="color:var(--accent);">[只读分享]</span>' : ''}</div>
        <div>基于 Web 技术的 Gerber 文件查看器</div>
        <div style="margin-top:8px;color:var(--text-secondary);font-size:12px;">
          <div>支持 Gerber RS-274X (X2) 和 Excellon 钻孔文件格式</div>
          <div>支持多图层叠加、极性合成、XOR 差分模式</div>
          <div>支持测量、DFM 分析、导出 PNG/SVG/DXF</div>
          <div>支持宏光圈 (Aperture Macro)、Step-Repeat、层变换</div>
        </div>
        <div style="margin-top:12px;color:var(--text-dim);font-size:11px;">
          从 KiCad GerbView 源码转写的 Web 版本<br>
          使用 TypeScript + Canvas2D 实现<br>
          <a href="https://github.com/wangjiati/GerberView" target="_blank" style="color:var(--accent);text-decoration:none;">https://github.com/wangjiati/GerberView</a>
        </div>
      </div>
      <div class="dialog-btn-row">
        <button class="dialog-btn primary" id="about-close">确定</button>
      </div>`;
    overlay.appendChild(dialog);
    document.querySelector('.gerberview-app')!.appendChild(overlay);
    overlay.querySelector('#about-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  private showShortcutsDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '400px';
    const shortcuts = [
      ['鼠标滚轮', '缩放视图'],
      ['中键拖拽 / 右键拖拽', '平移画布'],
      ['F', '适应窗口 (Zoom Fit)'],
      ['G', '切换网格显示'],
      ['M', '切换测量工具'],
      ['Esc', '取消当前操作 / 返回选择工具'],
      ['L', '显示/隐藏图层面板'],
      ['Delete', '删除选中图层'],
      ['Ctrl+O', '打开文件'],
      ['Ctrl+S', '导出 PNG'],
      ['+/-', '放大/缩小'],
      ['方向键', '平移画布'],
    ];
    dialog.innerHTML = `
      <div class="dialog-title">快捷键参考</div>
      <div style="padding:4px 0 12px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${shortcuts.map(([key, desc]) =>
            `<tr style="border-bottom:1px solid var(--border-color);">
              <td style="padding:5px 8px;color:var(--accent);white-space:nowrap;font-family:monospace;">${key}</td>
              <td style="padding:5px 8px;color:var(--text-primary);">${desc}</td>
            </tr>`).join('')}
        </table>
      </div>
      <div class="dialog-btn-row">
        <button class="dialog-btn primary" id="shortcuts-close">关闭</button>
      </div>`;
    overlay.appendChild(dialog);
    document.querySelector('.gerberview-app')!.appendChild(overlay);
    overlay.querySelector('#shortcuts-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // ========== 侧边栏拖拽调整宽度 ==========
  private initLayerPanelResize(resizer: HTMLElement) {
    let startX = 0;
    let startWidth = 0;
    const MIN_W = 150, MAX_W = 500;

    const onMouseMove = (e: MouseEvent) => {
      const dx = startX - e.clientX;
      const newW = Math.min(MAX_W, Math.max(MIN_W, startWidth + dx));
      this.layerPanelWidth = newW;
      (this.layerPanelEl as HTMLElement).style.width = newW + 'px';
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.resizeCanvas();
      this.requestRender();
    };
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.layerPanelWidth;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }

  // ========== 图层颜色对话框 ==========

  private showLayerColorDialog(layer: GerberImage, swatch: HTMLElement) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';

    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = `图层颜色 — ${layer.layerName || layer.fileName}`;
    dialog.appendChild(title);

    const originalColor = layer.color;

    // 颜色选择行
    const colorRow = document.createElement('div');
    colorRow.className = 'dialog-row';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = '颜色';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = layer.color;
    colorInput.className = 'dialog-input';
    colorInput.style.width = '60px';
    colorInput.style.height = '30px';
    colorInput.style.padding = '2px';
    colorInput.style.cursor = 'pointer';
    // 预览色块
    const preview = document.createElement('div');
    preview.style.cssText = `width:60px;height:30px;border-radius:4px;border:1px solid #666;background:${layer.color};margin-left:10px;`;
    // 十六进制值
    const hexLabel = document.createElement('span');
    hexLabel.className = 'dialog-unit';
    hexLabel.textContent = layer.color.toUpperCase();
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInput);
    colorRow.appendChild(preview);
    colorRow.appendChild(hexLabel);
    dialog.appendChild(colorRow);

    colorInput.addEventListener('input', () => {
      layer.color = colorInput.value;
      swatch.style.backgroundColor = colorInput.value;
      preview.style.background = colorInput.value;
      hexLabel.textContent = colorInput.value.toUpperCase();
      this.requestRender();
    });

    const btnRow = document.createElement('div');
    btnRow.className = 'dialog-btn-row';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'dialog-btn primary'; applyBtn.textContent = '确认';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn'; cancelBtn.textContent = '取消';
    btnRow.appendChild(applyBtn); btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    document.querySelector('.gerberview-app')!.appendChild(overlay);

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', () => {
      layer.color = originalColor;
      swatch.style.backgroundColor = originalColor;
      this.requestRender();
      close();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        layer.color = originalColor;
        swatch.style.backgroundColor = originalColor;
        this.requestRender();
        close();
      }
    });
    applyBtn.addEventListener('click', close);
  }

  // ========== 图层变换对话框 ==========

  private showLayerTransformDialog(layerIdx: number) {
    const layer = this.layerManager.getLayer(layerIdx);
    if (!layer) return;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';

    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = `图层变换 — ${layer.layerName || layer.fileName}`;
    dialog.appendChild(title);

    const conv = (v: number) => (v / IU_PER_MM).toFixed(4);
    const fields: { label: string; id: string; value: string; unit: string }[] = [
      { label: 'X 偏移', id: 'offX', value: conv(layer.imageOffset.x), unit: 'mm' },
      { label: 'Y 偏移', id: 'offY', value: conv(layer.imageOffset.y), unit: 'mm' },
      { label: '旋转', id: 'rot', value: layer.imageRotation.toFixed(1), unit: '°' },
      { label: '缩放 X', id: 'scaleX', value: layer.scale.x.toFixed(4), unit: '' },
      { label: '缩放 Y', id: 'scaleY', value: layer.scale.y.toFixed(4), unit: '' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'dialog-row';
      const lbl = document.createElement('label');
      lbl.textContent = f.label;
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'dialog-input';
      input.value = f.value; input.id = f.id;
      const unitSpan = document.createElement('span');
      unitSpan.className = 'dialog-unit'; unitSpan.textContent = f.unit;
      row.appendChild(lbl); row.appendChild(input); row.appendChild(unitSpan);
      dialog.appendChild(row);
      inputs[f.id] = input;
    }

    // 镜像复选框
    const checkRow = document.createElement('div');
    checkRow.className = 'dialog-check-row';
    const mkCheck = (label: string, id: string, checked: boolean): HTMLInputElement => {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = id; cb.checked = checked;
      const lbl = document.createElement('label');
      lbl.textContent = label; lbl.htmlFor = id;
      checkRow.appendChild(cb); checkRow.appendChild(lbl);
      return cb;
    };
    const mirrorACb = mkCheck('镜像 X 轴', 'mirrorA', layer.mirrorA);
    const mirrorBCb = mkCheck('镜像 Y 轴', 'mirrorB', layer.mirrorB);
    const swapCb = mkCheck('交换 XY 轴', 'swapAxis', layer.swapAxis);
    dialog.appendChild(checkRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'dialog-btn-row';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'dialog-btn primary'; applyBtn.textContent = '应用';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn'; cancelBtn.textContent = '取消';
    btnRow.appendChild(applyBtn); btnRow.appendChild(cancelBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    document.querySelector('.gerberview-app')!.appendChild(overlay);

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    applyBtn.addEventListener('click', () => {
      const p = (id: string) => parseFloat(inputs[id].value) || 0;
      layer.imageOffset = pt(p('offX') * IU_PER_MM, p('offY') * IU_PER_MM);
      layer.imageRotation = p('rot');
      layer.scale = pt(p('scaleX'), p('scaleY'));
      layer.mirrorA = mirrorACb.checked;
      layer.mirrorB = mirrorBCb.checked;
      layer.swapAxis = swapCb.checked;
      // 更新所有该图层 item 的变换参数
      for (const item of layer.items) {
        item.layerOffset = { ...layer.imageOffset };
        item.drawScale = { ...layer.scale };
        item.mirrorA = layer.mirrorA;
        item.mirrorB = layer.mirrorB;
        item.swapAxis = layer.swapAxis;
        item.layerRotation = layer.imageRotation;
      }
      layer.computeBoundingBox();
      close();
      this.requestRender();
    });
  }

  private showLayerContextMenu(x: number, y: number, layerIdx: number, layer: GerberImage, swatch: HTMLElement) {
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const loadedIndices: number[] = [];
    for (let k = 0; k < 32; k++) { if (this.layerManager.getLayer(k)) loadedIndices.push(k); }
    const posInList = loadedIndices.indexOf(layerIdx);

    const items: { label: string; action?: () => void; separator?: boolean; checked?: boolean }[] = [
      { label: '设为活动图层', action: () => {
        this.displayOptions.activeLayer = layerIdx;
        this.activeLayerSelect.value = String(layerIdx);
        this.updateLayerPanel(); this.updateFileInfo(); this.requestRender();
      }},
      { separator: true, label: '' },
      { label: layer.visible ? '隐藏图层' : '显示图层', action: () => {
        layer.visible = !layer.visible; this.updateLayerPanel(); this.requestRender();
      }},
      { label: '更改颜色...', action: () => { (swatch as HTMLElement).click(); }},
      { label: '图层类型', separator: true },
    ];

    // 图层类型子菜单项
    const allTypes = Object.values(LayerType);
    for (const lt of allTypes) {
      const currentType = layer.layerType;
      items.push({
        label: `  ${LAYER_TYPE_LABELS[lt]}`,
        action: () => {
          layer.layerType = lt;
          if (LAYER_TYPE_COLORS[lt]) {
            layer.color = LAYER_TYPE_COLORS[lt];
          }
          if (lt !== LayerType.Unknown && LAYER_TYPE_LABELS[lt]) {
            layer.layerName = LAYER_TYPE_LABELS[lt];
          }
          this.updateLayerPanel(); this.requestRender();
        },
        checked: currentType === lt,
      });
    }

    items.push(
      { separator: true, label: '' },
      { label: '图层变换...', action: () => { this.showLayerTransformDialog(layerIdx); }},
      { separator: true, label: '' },
      { label: '上移', action: () => {
        if (posInList > 0) {
          this.layerManager.swapLayers(layerIdx, loadedIndices[posInList - 1]);
          this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
        }
      }},
      { label: '下移', action: () => {
        if (posInList < loadedIndices.length - 1) {
          this.layerManager.swapLayers(layerIdx, loadedIndices[posInList + 1]);
          this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
        }
      }},
      { label: '按板结构排序', action: () => {
        this.layerManager.sortByBoardStructure();
        this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
      }},
      { separator: true, label: '' },
      { label: '删除图层', action: () => {
        this.layerManager.removeLayer(layerIdx);
        this.updateLayerPanel(); this.updateActiveLayerSelect(); this.requestRender();
      }},
    );

    for (const item of items) {
      if (item.separator && !item.action) {
        const sep = document.createElement('div'); sep.className = 'ctx-sep';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'ctx-item' + (item.checked ? ' checked' : '');
        el.textContent = item.label;
        if (item.action) {
          el.addEventListener('click', () => { menu.remove(); item.action!(); });
        }
        menu.appendChild(el);
      }
    }

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', closeHandler); }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
  }

  // ========== 测试 API (供 Playwright 调用) ==========

  async loadGerberText(text: string, fileName: string) {
    const layerIndex = this.layerManager.getLoadedCount();
    if (layerIndex >= 32) return;
    let image: GerberImage;
    if (detectExcellonFile(text)) {
      image = new ExcellonParser().parse(text, fileName, layerIndex);
    } else {
      image = new GerberParser().parse(text, fileName, layerIndex);
    }
    this.layerManager.addLayer(image);
    this.updateLayerPanel();
    this.updateActiveLayerSelect();
    this.populateX2Selectors();
    this.updateFileInfo();
    this.zoomFit();
  }

  clearAllLayers() {
    this.clearAll();
  }

  getCanvasDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }
}

function sep(vertical = false): HTMLElement {
  const s = document.createElement('div');
  s.className = vertical ? 'lt-sep' : 'tb-sep';
  return s;
}
