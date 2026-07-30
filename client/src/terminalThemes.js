const THEME_KEY = 'dockterm.term-theme';
const FONT_KEY = 'dockterm.term-font';
const FONT_SIZE_KEY = 'dockterm.term-font-size';
export const TERM_THEME_EVENT = 'dockterm-term-theme';

/** @typedef {{
 *  id: string,
 *  label: string,
 *  theme: Record<string, string>
 * }} TermThemeDef
 */

/** @typedef {{
 *  id: string,
 *  label: string,
 *  value: string
 * }} TermFontDef
 */

export const TERM_FONTS = [
  {
    id: 'default',
    label: 'Meslo / SF Mono',
    value:
      '"MesloLGS NF", "SF Mono", Menlo, Monaco, "Cascadia Mono", monospace',
  },
  {
    id: 'sf-mono',
    label: 'SF Mono',
    value: '"SF Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'menlo',
    label: 'Menlo',
    value: 'Menlo, Monaco, monospace',
  },
  {
    id: 'ibm-plex',
    label: 'IBM Plex Mono',
    value: '"IBM Plex Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    value: '"JetBrains Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'fira',
    label: 'Fira Code',
    value: '"Fira Code", Menlo, Monaco, monospace',
  },
  {
    id: 'source-code',
    label: 'Source Code Pro',
    value: '"Source Code Pro", Menlo, Monaco, monospace',
  },
  {
    id: 'cascadia',
    label: 'Cascadia Mono',
    value: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  },
  {
    id: 'system',
    label: 'System Mono',
    value:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
];

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

export function getTermFontId() {
  try {
    const id = localStorage.getItem(FONT_KEY);
    if (id && TERM_FONTS.some((f) => f.id === id)) return id;
  } catch {
    /* ignore */
  }
  return 'default';
}

export function getTermFontFamily(id = getTermFontId()) {
  return (TERM_FONTS.find((f) => f.id === id) || TERM_FONTS[0]).value;
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

function appearanceDetail(overrides = {}) {
  return {
    id: getTermThemeId(),
    theme: getTermTheme(),
    fontId: getTermFontId(),
    fontFamily: getTermFontFamily(),
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

export function setTermFontId(id) {
  const next = TERM_FONTS.some((f) => f.id === id) ? id : 'default';
  try {
    localStorage.setItem(FONT_KEY, next);
  } catch {
    /* ignore */
  }
  dispatchAppearance({
    fontId: next,
    fontFamily: getTermFontFamily(next),
  });
  return next;
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

export function applyTermBgCssVar() {
  applyTermThemeCssVars();
}
