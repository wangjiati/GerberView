import { LayerManager, GerberImage } from '../model/gerber-image';
import { LAYER_TYPE_LABELS, LAYER_CATEGORIES, MAX_LAYERS } from '../model/enums';

export interface DxfExportConfig {
  mode: 'raw' | 'outline' | 'merged';
  selectedLayers: number[];
}

export function showExportDxfDialog(
  layerManager: LayerManager,
  onExport: (config: DxfExportConfig) => void,
): void {
  // 收集已加载图层
  const loadedLayers: { index: number; layer: GerberImage }[] = [];
  for (let i = 0; i < MAX_LAYERS; i++) {
    const layer = layerManager.getLayer(i);
    if (layer) loadedLayers.push({ index: i, layer });
  }
  if (loadedLayers.length === 0) return;

  // overlay
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.style.minWidth = '420px';

  // ── 标题 ──
  const title = document.createElement('div');
  title.className = 'dialog-title';
  title.textContent = '导出 DXF';
  dialog.appendChild(title);

  // ── 导出模式 ──
  const modeSection = document.createElement('div');
  modeSection.className = 'dialog-section-title';
  modeSection.textContent = '导出模式';
  dialog.appendChild(modeSection);

  const modeBody = document.createElement('div');
  modeBody.className = 'dialog-body';

  const modes: { value: DxfExportConfig['mode']; label: string; desc: string }[] = [
    { value: 'raw', label: '原始模式', desc: '导出所有原始几何元素（线段、弧、圆等）' },
    { value: 'outline', label: '轮廓模式', desc: '仅导出轮廓形状，跳过填充用的密排线段' },
    { value: 'merged', label: '合并填充', desc: '合并同层重叠元素为统一填充区域（HATCH）' },
  ];

  let currentMode: DxfExportConfig['mode'] = 'merged';
  const modeRadios: HTMLInputElement[] = [];

  for (const m of modes) {
    const row = document.createElement('div');
    row.className = 'export-mode-option';
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'dxf-mode'; radio.value = m.value;
    radio.checked = m.value === 'merged';
    radio.style.marginTop = '2px';
    radio.style.flexShrink = '0';
    radio.style.accentColor = 'var(--accent)';
    modeRadios.push(radio);

    const info = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.textContent = m.label;
    lbl.style.fontWeight = '600';
    lbl.style.fontSize = '12px';
    lbl.style.color = 'var(--text-primary)';
    const desc = document.createElement('div');
    desc.textContent = m.desc;
    desc.className = 'export-mode-desc';
    info.appendChild(lbl);
    info.appendChild(desc);

    radio.addEventListener('change', () => { currentMode = m.value; });
    row.appendChild(radio);
    row.appendChild(info);
    modeBody.appendChild(row);
  }
  dialog.appendChild(modeBody);

  // ── 图层选择 ──
  const layerSection = document.createElement('div');
  layerSection.className = 'dialog-section-title';
  layerSection.textContent = '选择图层';
  dialog.appendChild(layerSection);

  const treeWrap = document.createElement('div');
  treeWrap.className = 'export-layer-tree';

  // 存储每个图层的 checkbox 引用
  const layerCheckboxes = new Map<number, HTMLInputElement>();

  // 更新全部/分类复选框状态的辅助
  const updateAllCheck = (allCb: HTMLInputElement, catCheckboxes: HTMLInputElement[]) => {
    const allChecked = loadedLayers.every(({ layer }) => layer.visible);
    allCb.checked = allChecked;
    allCb.indeterminate = !allChecked && loadedLayers.some(({ layer }) => layer.visible);
  };

  // ── "全部图层" 行 ──
  const allRow = document.createElement('div');
  allRow.className = 'export-layer-all';
  const allCb = document.createElement('input');
  allCb.type = 'checkbox'; allCb.className = 'category-checkbox';
  allCb.checked = loadedLayers.every(({ layer }) => layer.visible);
  allCb.indeterminate = !allCb.checked && loadedLayers.some(({ layer }) => layer.visible);
  const allLabel = document.createElement('span');
  allLabel.className = 'category-label'; allLabel.textContent = '全部图层';
  allLabel.style.fontWeight = '600';
  const allCount = document.createElement('span');
  allCount.className = 'category-count'; allCount.textContent = `(${loadedLayers.length})`;
  allRow.appendChild(allCb); allRow.appendChild(allLabel); allRow.appendChild(allCount);
  treeWrap.appendChild(allRow);

  const catCheckboxes: HTMLInputElement[] = [];

  // ── 分类树 ──
  for (const cat of LAYER_CATEGORIES) {
    const catTypes = new Set(cat.types);
    const catLayers = loadedLayers.filter(({ layer }) => catTypes.has(layer.layerType));
    if (catLayers.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'export-layer-group';

    // header
    const header = document.createElement('div');
    header.className = 'export-layer-header';

    const toggle = document.createElement('span');
    toggle.className = 'category-toggle'; toggle.textContent = '▼';

    const catCb = document.createElement('input');
    catCb.type = 'checkbox'; catCb.className = 'category-checkbox';
    catCb.checked = catLayers.every(({ layer }) => layer.visible);
    catCb.indeterminate = !catCb.checked && catLayers.some(({ layer }) => layer.visible);
    catCheckboxes.push(catCb);

    const catLabel = document.createElement('span');
    catLabel.className = 'category-label'; catLabel.textContent = cat.label;

    const catCount = document.createElement('span');
    catCount.className = 'category-count'; catCount.textContent = `(${catLayers.length})`;

    header.appendChild(toggle); header.appendChild(catCb); header.appendChild(catLabel); header.appendChild(catCount);

    const children = document.createElement('div');
    children.className = 'export-layer-children';

    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const collapsed = children.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▶' : '▼';
    });

    const updateCatCheck = () => {
      catCb.checked = catLayers.every(({ index }) => layerCheckboxes.get(index)?.checked);
      catCb.indeterminate = !catCb.checked && catLayers.some(({ index }) => layerCheckboxes.get(index)?.checked);
    };

    catCb.addEventListener('change', (e) => {
      e.stopPropagation();
      const v = catCb.checked;
      for (const { index } of catLayers) {
        const cb = layerCheckboxes.get(index);
        if (cb) cb.checked = v;
      }
      allCb.checked = loadedLayers.every(({ index }) => layerCheckboxes.get(index)?.checked);
      allCb.indeterminate = !allCb.checked && loadedLayers.some(({ index }) => layerCheckboxes.get(index)?.checked);
    });

    // 添加图层行
    for (const { index, layer } of catLayers) {
      const item = document.createElement('div');
      item.className = 'export-layer-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'category-checkbox';
      cb.checked = layer.visible;
      layerCheckboxes.set(index, cb);

      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        updateCatCheck();
        allCb.checked = loadedLayers.every(({ index }) => layerCheckboxes.get(index)?.checked);
        allCb.indeterminate = !allCb.checked && loadedLayers.some(({ index }) => layerCheckboxes.get(index)?.checked);
      });

      const lbl = document.createElement('span');
      lbl.style.flex = '1';
      const displayName = layer.layerName || layer.fileName || `图层 ${index}`;
      lbl.textContent = displayName;
      lbl.title = layer.fileName || displayName;

      item.appendChild(cb); item.appendChild(lbl);
      children.appendChild(item);
    }

    group.appendChild(header); group.appendChild(children);
    treeWrap.appendChild(group);
  }

  // 全部图层勾选
  allCb.addEventListener('change', (e) => {
    e.stopPropagation();
    const v = allCb.checked;
    layerCheckboxes.forEach(cb => { cb.checked = v; });
    catCheckboxes.forEach(cb => { cb.checked = v; cb.indeterminate = false; });
    allCb.indeterminate = false;
  });

  dialog.appendChild(treeWrap);

  // ── 按钮 ──
  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'dialog-btn'; cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const exportBtn = document.createElement('button');
  exportBtn.className = 'dialog-btn dialog-btn-primary'; exportBtn.textContent = '导出 DXF';
  exportBtn.addEventListener('click', () => {
    const selectedLayers: number[] = [];
    layerCheckboxes.forEach((cb, idx) => { if (cb.checked) selectedLayers.push(idx); });
    if (selectedLayers.length === 0) return;
    onExport({ mode: currentMode, selectedLayers });
    overlay.remove();
  });

  btnRow.appendChild(cancelBtn); btnRow.appendChild(exportBtn);
  dialog.appendChild(btnRow);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
