const APP_THEME_KEY = 'dockterm.app-theme';
export const APP_THEME_EVENT = 'dockterm-app-theme';

/** @typedef {'light' | 'dark' | 'system'} AppThemePref */
/** @typedef {'light' | 'dark'} ResolvedAppearance */

/** Dark chrome — matches previous APP_CHROME_DEFAULTS. */
export const DARK_CHROME = {
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

/** Light chrome tokens for hosts, drawers, modals, session chrome. */
export const LIGHT_CHROME = {
  '--bg': '#f4f5f7',
  '--bg-elevated': '#ffffff',
  '--panel': '#ffffff',
  '--panel-2': '#eef0f3',
  '--border': '#d8dce3',
  '--text': '#1a1c23',
  '--muted': '#5c6578',
  '--accent': '#2563eb',
  '--accent-soft': 'rgba(37, 99, 235, 0.12)',
  '--tab': '#eef0f3',
  '--tab-active': '#e2e5eb',
  '--scrollbar-thumb': '#c5cad3',
  '--scrollbar-thumb-hover': '#9aa3b2',
};

/** @returns {AppThemePref} */
export function getAppThemePref() {
  try {
    const v = localStorage.getItem(APP_THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

/** @returns {ResolvedAppearance} */
export function getResolvedAppAppearance(pref = getAppThemePref()) {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    ) {
      return 'light';
    }
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function applyAppChrome(appearance = getResolvedAppAppearance()) {
  const tokens = appearance === 'light' ? LIGHT_CHROME : DARK_CHROME;
  try {
    const root = document.documentElement;
    root.dataset.theme = appearance;
    root.style.colorScheme = appearance;
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value);
    }
  } catch {
    /* ignore */
  }
}

function dispatchAppTheme(detail) {
  window.dispatchEvent(
    new CustomEvent(APP_THEME_EVENT, {
      detail: {
        pref: getAppThemePref(),
        appearance: getResolvedAppAppearance(),
        ...detail,
      },
    })
  );
}

/** @param {AppThemePref} pref */
export function setAppThemePref(pref) {
  const next =
    pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system';
  try {
    localStorage.setItem(APP_THEME_KEY, next);
  } catch {
    /* ignore */
  }
  const appearance = getResolvedAppAppearance(next);
  applyAppChrome(appearance);
  dispatchAppTheme({ pref: next, appearance });
  return next;
}

let mediaBound = false;

/** Call once at boot so `system` tracks OS changes. */
export function startAppThemeListener() {
  if (mediaBound || typeof window === 'undefined') return;
  mediaBound = true;
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getAppThemePref() !== 'system') return;
      const appearance = getResolvedAppAppearance('system');
      applyAppChrome(appearance);
      dispatchAppTheme({ pref: 'system', appearance });
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(onChange);
    }
  } catch {
    /* ignore */
  }
}
