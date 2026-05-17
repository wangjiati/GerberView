export interface ThemeColors {
  name: string;
  canvasBackground: string;
  gridDot: string;
  gridDense: string;
  gridOrigin: string;
  gridCoarse: string;
  dcodeLabel: string;
  selectionHighlight: string;
  measureLine: string;
  snapEndpoint: string;
  snapMidpoint: string;
  snapCenter: string;
}

export const PRESET_THEMES: ThemeColors[] = [
  {
    name: 'Dark',
    canvasBackground: '#000000',
    gridDot: '#3a3a4a',
    gridDense: '#2a2a3a',
    gridOrigin: '#4a4a5a',
    gridCoarse: '#4a4a5a',
    dcodeLabel: '#ffff00',
    selectionHighlight: '#00ffff',
    measureLine: '#ffffff',
    snapEndpoint: '#00ff00',
    snapMidpoint: '#ffff00',
    snapCenter: '#00ffff',
  },
  {
    name: 'Light',
    canvasBackground: '#f0f0f0',
    gridDot: '#c0c0c0',
    gridDense: '#d0d0d0',
    gridOrigin: '#888888',
    gridCoarse: '#999999',
    dcodeLabel: '#880000',
    selectionHighlight: '#0000ff',
    measureLine: '#333333',
    snapEndpoint: '#00aa00',
    snapMidpoint: '#cc8800',
    snapCenter: '#0066cc',
  },
  {
    name: 'Blue',
    canvasBackground: '#0a0a2e',
    gridDot: '#2a2a5a',
    gridDense: '#1a1a3a',
    gridOrigin: '#4a4a7a',
    gridCoarse: '#4a4a6a',
    dcodeLabel: '#ffff00',
    selectionHighlight: '#00ffcc',
    measureLine: '#cccccc',
    snapEndpoint: '#00ff00',
    snapMidpoint: '#ffaa00',
    snapCenter: '#00ccff',
  },
];

const THEME_STORAGE_KEY = 'gerbview-theme';

export function loadTheme(): ThemeColors {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const base = PRESET_THEMES[0];
      return { ...base, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...PRESET_THEMES[0] };
}

export function saveTheme(theme: ThemeColors): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch { /* ignore */ }
}

export function applyThemeToGridConfig(theme: ThemeColors): Record<string, string> {
  return {
    color: theme.gridDot,
    denseColor: theme.gridDense,
    originColor: theme.gridOrigin,
    coarseColor: theme.gridCoarse,
  };
}
