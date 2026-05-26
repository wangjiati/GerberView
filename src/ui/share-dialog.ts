import { LayerManager, GerberImage } from '../model/gerber-image';
import { LAYER_CATEGORIES, MAX_LAYERS } from '../model/enums';

export function showShareDialog(
  layerManager: LayerManager,
  onShare: (selectedLayers: number[]) => void,
): void {
  const loadedLayers: { index: number; layer: GerberImage }[] = [];
  for (let i = 0; i < MAX_LAYERS; i++) {
    const layer = layerManager.getLayer(i);
    if (layer) loadedLayers.push({ index: i, layer });
  }
  if (loadedLayers.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.style.minWidth = '420px';

  // ── 标题 ──
  const title = document.createElement('div');
  title.className = 'dialog-title';
  title.textContent = '分享为只读模式';
  dialog.appendChild(title);

  // ── 图层选择 ──
  const layerSection = document.createElement('div');
  layerSection.className = 'dialog-section-title';
  layerSection.textContent = '选择要分享的图层';
  dialog.appendChild(layerSection);

  const treeWrap = document.createElement('div');
  treeWrap.className = 'export-layer-tree';

  const layerCheckboxes = new Map<number, HTMLInputElement>();

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

  const updateAllCheck = () => {
    allCb.checked = loadedLayers.every(({ index }) => layerCheckboxes.get(index)?.checked);
    allCb.indeterminate = !allCb.checked && loadedLayers.some(({ index }) => layerCheckboxes.get(index)?.checked);
  };

  // ── 分类树 ──
  for (const cat of LAYER_CATEGORIES) {
    const catTypes = new Set(cat.types);
    const catLayers = loadedLayers.filter(({ layer }) => catTypes.has(layer.layerType));
    if (catLayers.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'export-layer-group';

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
      updateAllCheck();
    });

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
        updateAllCheck();
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

  const shareBtn = document.createElement('button');
  shareBtn.className = 'dialog-btn dialog-btn-primary'; shareBtn.textContent = '生成分享文件';
  shareBtn.addEventListener('click', () => {
    const selectedLayers: number[] = [];
    layerCheckboxes.forEach((cb, idx) => { if (cb.checked) selectedLayers.push(idx); });
    if (selectedLayers.length === 0) return;
    onShare(selectedLayers);
    overlay.remove();
  });

  btnRow.appendChild(cancelBtn); btnRow.appendChild(shareBtn);
  dialog.appendChild(btnRow);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
