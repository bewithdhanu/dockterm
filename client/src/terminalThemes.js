const THEME_KEY = 'dockterm.term-theme';
export const TERM_THEME_EVENT = 'dockterm-term-theme';

/** @typedef {{
 *  id: string,
 *  label: string,
 *  theme: Record<string, string>
 * }} TermThemeDef
 */

/** System monospace stack for the terminal. */
export const TERM_FONT_FAMILY =
  '"SF Mono", Menlo, Monaco, ui-monospace, monospace';

const FONT_SIZE_KEY = 'dockterm.term-font-size';
export const TERM_FONT_SIZE_MIN = 11;
export const TERM_FONT_SIZE_MAX = 24;
export const DEFAULT_TERM_FONT_SIZE = 14;

/** @type {TermThemeDef[]} */
export const TERMINAL_THEMES = [
  {
    id: 'dockterm',
    label: 'DockTerm',
    theme: {
      background: '#1a1c23',
      foreground: '#e8eaef',
      cursor: '#3b82f6',
      cursorAccent: '#1a1c23',
      selectionBackground: 'rgba(59, 130, 246, 0.35)',
      selectionForeground: '#e8eaef',
      black: '#12141a',
      red: '#f87171',
      green: '#6a9955',
      yellow: '#eab308',
      blue: '#3b82f6',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e8eaef',
      brightBlack: '#6b7280',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#60a5fa',
      brightMagenta: '#e9d5ff',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    theme: {
      background: '#0f1117',
      foreground: '#d7dbe7',
      cursor: '#818cf8',
      cursorAccent: '#0f1117',
      selectionBackground: 'rgba(129, 140, 248, 0.35)',
      black: '#090b10',
      red: '#fb7185',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#818cf8',
      magenta: '#e879f9',
      cyan: '#2dd4bf',
      white: '#d7dbe7',
      brightBlack: '#64748b',
      brightRed: '#fda4af',
      brightGreen: '#6ee7b7',
      brightYellow: '#fcd34d',
      brightBlue: '#a5b4fc',
      brightMagenta: '#f0abfc',
      brightCyan: '#5eead4',
      brightWhite: '#f8fafc',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    theme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#88c0d0',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    theme: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#282c34',
      selectionBackground: '#3e4451',
      black: '#21252b',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'solarized',
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#268bd2',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'classic',
    label: 'Classic Black',
    theme: {
      background: '#0d0d0d',
      foreground: '#d0d0d0',
      cursor: '#aeafad',
      cursorAccent: '#0d0d0d',
      selectionBackground: '#264f78',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5',
    },
  },
  {
    id: 'light',
    label: 'Light',
    theme: {
      background: '#f7f8fa',
      foreground: '#1f2328',
      cursor: '#0969da',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(9, 105, 218, 0.28)',
      selectionForeground: '#1f2328',
      black: '#24292f',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#656d76',
      brightRed: '#a40e26',
      brightGreen: '#116329',
      brightYellow: '#7d4e00',
      brightBlue: '#0550ae',
      brightMagenta: '#6639ba',
      brightCyan: '#136f75',
      brightWhite: '#0d1117',
    },
  },
];

export function getTermThemeId() {
  try {
    const id = localStorage.getItem(THEME_KEY);
    if (id && TERMINAL_THEMES.some((t) => t.id === id)) return id;
  } catch {
    /* ignore */
  }
  return 'dockterm';
}

export function getTermTheme(id = getTermThemeId()) {
  return (
    TERMINAL_THEMES.find((t) => t.id === id) || TERMINAL_THEMES[0]
  ).theme;
}

export function getTermFontSize() {
  try {
    const n = Number(localStorage.getItem(FONT_SIZE_KEY));
    if (
      Number.isFinite(n) &&
      n >= TERM_FONT_SIZE_MIN &&
      n <= TERM_FONT_SIZE_MAX
    ) {
      return Math.round(n);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_TERM_FONT_SIZE;
}

export function setTermFontSize(size) {
  const n = Math.round(Number(size));
  const next =
    Number.isFinite(n) && n >= TERM_FONT_SIZE_MIN && n <= TERM_FONT_SIZE_MAX
      ? n
      : DEFAULT_TERM_FONT_SIZE;
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(next));
  } catch {
    /* ignore */
  }
  dispatchAppearance({ fontSize: next });
  return next;
}

function appearanceDetail(overrides = {}) {
  return {
    id: getTermThemeId(),
    theme: getTermTheme(),
    fontFamily: TERM_FONT_FAMILY,
    fontSize: getTermFontSize(),
    ...overrides,
  };
}

function dispatchAppearance(detail) {
  window.dispatchEvent(
    new CustomEvent(TERM_THEME_EVENT, { detail: appearanceDetail(detail) })
  );
}

export function setTermThemeId(id) {
  const next = TERMINAL_THEMES.some((t) => t.id === id) ? id : 'dockterm';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  const theme = getTermTheme(next);
  applyTermThemeCssVars(theme);
  dispatchAppearance({ id: next, theme });
  return next;
}

/** Push terminal palette into CSS vars (terminal + footer). */
export function applyTermThemeCssVars(theme = getTermTheme()) {
  try {
    const root = document.documentElement.style;
    const bg = theme.background || '#1a1c23';
    const fg = theme.foreground || '#e8eaef';
    const muted = theme.brightBlack || '#6b7280';
    const accent = theme.blue || theme.cursor || '#3b82f6';
    const panel = theme.black || bg;
    root.setProperty('--term-bg', bg);
    root.setProperty('--term-fg', fg);
    root.setProperty('--term-muted', muted);
    root.setProperty('--term-panel', panel);
    root.setProperty('--term-border', muted);
    root.setProperty('--term-accent', accent);
    root.setProperty('--term-cursor', theme.cursor || accent);
    root.setProperty('--term-green', theme.green || '#6a9955');
    root.setProperty('--term-cyan', theme.cyan || '#22d3ee');
    root.setProperty('--term-red', theme.red || '#f87171');
    root.setProperty('--term-yellow', theme.yellow || '#eab308');
    root.setProperty(
      '--term-selection',
      theme.selectionBackground || 'rgba(59, 130, 246, 0.35)'
    );
  } catch {
    /* ignore */
  }
}

/** DockTerm chrome defaults (hosts / non-session views). */
export const APP_CHROME_DEFAULTS = {
  '--bg': '#1a1c23',
  '--bg-elevated': '#20232c',
  '--panel': '#242832',
  '--panel-2': '#2a2e38',
  '--border': '#323644',
  '--text': '#e8eaef',
  '--muted': '#b4bac8',
  '--accent': '#3b82f6',
  '--accent-soft': 'rgba(59, 130, 246, 0.18)',
  '--tab': '#2a2e38',
  '--tab-active': '#323644',
  '--scrollbar-thumb': '#3a3f4d',
  '--scrollbar-thumb-hover': '#525868',
};

function mixHex(a, b, t) {
  const parse = (hex) => {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return null;
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const A = parse(a);
  const B = parse(b);
  if (!A || !B) return a;
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(59, 130, 246, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexLuminance(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Map terminal palette onto app chrome CSS vars. */
export function applyAppChromeFromTermTheme(theme = getTermTheme()) {
  try {
    const root = document.documentElement.style;
    const bg = theme.background || APP_CHROME_DEFAULTS['--bg'];
    const fg = theme.foreground || APP_CHROME_DEFAULTS['--text'];
    const light = hexLuminance(bg) > 0.55;
    const baseMuted = theme.brightBlack || APP_CHROME_DEFAULTS['--muted'];
    // Dark themes: brightBlack is often too dim. Light themes: keep muted darker.
    const muted = light
      ? mixHex(baseMuted, fg, 0.2) || mixHex(fg, bg, 0.38)
      : mixHex(baseMuted, fg, 0.42) ||
        mixHex(bg, fg, 0.58) ||
        APP_CHROME_DEFAULTS['--muted'];
    const accent = theme.blue || theme.cursor || APP_CHROME_DEFAULTS['--accent'];
    // Panels sit clearly above the terminal/editor background.
    const panel = mixHex(bg, fg, light ? 0.05 : 0.09) || theme.black || bg;
    const panel2 = mixHex(bg, fg, light ? 0.09 : 0.14) || panel;
    const elevated = mixHex(bg, fg, light ? 0.03 : 0.06) || bg;
    const border = mixHex(bg, fg, light ? 0.14 : 0.18) || muted;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    root.setProperty('--bg', bg);
    root.setProperty('--bg-elevated', elevated);
    root.setProperty('--panel', panel);
    root.setProperty('--panel-2', panel2);
    root.setProperty('--border', border);
    root.setProperty('--text', fg);
    root.setProperty('--muted', muted);
    root.setProperty('--accent', accent);
    root.setProperty('--accent-soft', hexToRgba(accent, light ? 0.14 : 0.18));
    root.setProperty('--tab', panel2);
    root.setProperty('--tab-active', border);
    root.setProperty('--scrollbar-thumb', mixHex(bg, fg, light ? 0.22 : 0.25));
    root.setProperty(
      '--scrollbar-thumb-hover',
      mixHex(bg, fg, light ? 0.32 : 0.36)
    );
  } catch {
    /* ignore */
  }
}

export function applyAppChromeDefaults() {
  try {
    const root = document.documentElement.style;
    document.documentElement.style.colorScheme = 'dark';
    for (const [key, value] of Object.entries(APP_CHROME_DEFAULTS)) {
      root.setProperty(key, value);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Hosts / nav screens stay on DockTerm chrome.
 * Session (local terminal or SSH) applies the selected terminal theme app-wide.
 */
export function syncAppChromeForView(mainView) {
  if (mainView === 'session') {
    applyAppChromeFromTermTheme(getTermTheme());
  } else {
    applyAppChromeDefaults();
  }
}

export function applyTermFontCssVar(fontFamily = TERM_FONT_FAMILY) {
  try {
    document.documentElement.style.setProperty('--font-mono', fontFamily);
  } catch {
    /* ignore */
  }
}

export function applyTermBgCssVar() {
  applyTermThemeCssVars();
  applyTermFontCssVar();
}
