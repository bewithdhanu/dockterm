import { getResolvedAppAppearance } from './appTheme.js';

/** @deprecated Legacy global key — ignored; defaults follow app appearance. */
const THEME_KEY = 'dockterm.term-theme';
const CONNECTION_THEME_KEY = 'dockterm.term-theme-by-connection';
export const TERM_THEME_EVENT = 'dockterm-term-theme';

/** Local (non-SSH) shells share one remembered terminal theme. */
export const LOCAL_CONNECTION_KEY = '__local__';
export const DARK_DEFAULT_TERM_THEME_ID = 'dockterm';
export const LIGHT_DEFAULT_TERM_THEME_ID = 'light';

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

export function connectionKeyFromPane(sshAlias) {
  const a = String(sshAlias || '').trim();
  return a || LOCAL_CONNECTION_KEY;
}

export function connectionLabel(connectionKey) {
  if (!connectionKey || connectionKey === LOCAL_CONNECTION_KEY) return 'Local';
  return connectionKey;
}

/** @returns {Record<string, string>} */
function readConnectionThemeMap() {
  try {
    const raw = localStorage.getItem(CONNECTION_THEME_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof key === 'string' &&
        typeof value === 'string' &&
        TERMINAL_THEMES.some((t) => t.id === value)
      ) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeConnectionThemeMap(map) {
  try {
    localStorage.setItem(CONNECTION_THEME_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Override theme id for a connection, or null if following app. */
export function getConnectionTermThemeId(connectionKey) {
  const key = connectionKey || LOCAL_CONNECTION_KEY;
  return readConnectionThemeMap()[key] || null;
}

export function getDefaultTermThemeId(
  appearance = getResolvedAppAppearance()
) {
  return appearance === 'light'
    ? LIGHT_DEFAULT_TERM_THEME_ID
    : DARK_DEFAULT_TERM_THEME_ID;
}

export function getEffectiveTermThemeId(connectionKey) {
  const override = getConnectionTermThemeId(connectionKey);
  if (override) return override;
  return getDefaultTermThemeId();
}

/** Catalog lookup; defaults to dark DockTerm palette. */
export function getTermTheme(id = DARK_DEFAULT_TERM_THEME_ID) {
  return (
    TERMINAL_THEMES.find((t) => t.id === id) || TERMINAL_THEMES[0]
  ).theme;
}

export function getEffectiveTermTheme(connectionKey) {
  return getTermTheme(getEffectiveTermThemeId(connectionKey));
}

/** @deprecated Use getEffectiveTermThemeId / getDefaultTermThemeId. */
export function getTermThemeId() {
  try {
    const id = localStorage.getItem(THEME_KEY);
    if (id && TERMINAL_THEMES.some((t) => t.id === id)) return id;
  } catch {
    /* ignore */
  }
  return getDefaultTermThemeId();
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
  window.dispatchEvent(
    new CustomEvent(TERM_THEME_EVENT, {
      detail: {
        globalFont: true,
        fontFamily: TERM_FONT_FAMILY,
        fontSize: next,
      },
    })
  );
  return next;
}

function appearanceDetail(overrides = {}) {
  const hasKey = Object.prototype.hasOwnProperty.call(
    overrides,
    'connectionKey'
  );
  const connectionKey = hasKey
    ? overrides.connectionKey
    : LOCAL_CONNECTION_KEY;
  const id =
    overrides.id != null
      ? overrides.id
      : connectionKey
        ? getEffectiveTermThemeId(connectionKey)
        : getDefaultTermThemeId();
  return {
    connectionKey,
    id,
    theme: overrides.theme || getTermTheme(id),
    followApp: connectionKey
      ? !getConnectionTermThemeId(connectionKey)
      : true,
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

/**
 * Set or clear a per-connection terminal theme.
 * @param {string} connectionKey
 * @param {string | null} id Theme id, or null to follow app light/dark default
 */
export function setConnectionTermThemeId(connectionKey, id) {
  const key = connectionKey || LOCAL_CONNECTION_KEY;
  const map = readConnectionThemeMap();
  if (id == null || id === '' || id === 'follow-app') {
    delete map[key];
  } else if (TERMINAL_THEMES.some((t) => t.id === id)) {
    map[key] = id;
  } else {
    delete map[key];
  }
  writeConnectionThemeMap(map);
  const effectiveId = getEffectiveTermThemeId(key);
  const theme = getTermTheme(effectiveId);
  dispatchAppearance({
    connectionKey: key,
    id: effectiveId,
    theme,
    followApp: !getConnectionTermThemeId(key),
  });
  return effectiveId;
}

/** @deprecated Prefer setConnectionTermThemeId for a specific connection. */
export function setTermThemeId(id) {
  return setConnectionTermThemeId(LOCAL_CONNECTION_KEY, id);
}

/** Notify panes that follow app defaults after app appearance changes. */
export function notifyAppAppearanceAffectsTerminals() {
  window.dispatchEvent(
    new CustomEvent(TERM_THEME_EVENT, {
      detail: {
        appAppearanceChanged: true,
        fontFamily: TERM_FONT_FAMILY,
        fontSize: getTermFontSize(),
      },
    })
  );
}

/** Push terminal palette into CSS vars (focused pane / footer). */
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

export function applyTermFontCssVar(fontFamily = TERM_FONT_FAMILY) {
  try {
    document.documentElement.style.setProperty('--font-mono', fontFamily);
  } catch {
    /* ignore */
  }
}

export function applyTermBgCssVar(connectionKey = LOCAL_CONNECTION_KEY) {
  applyTermThemeCssVars(getEffectiveTermTheme(connectionKey));
  applyTermFontCssVar();
}
