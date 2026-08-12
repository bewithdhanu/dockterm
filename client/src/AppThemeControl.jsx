import { useEffect, useState } from 'react';
import {
  APP_THEME_EVENT,
  getAppThemePref,
  setAppThemePref,
} from './appTheme.js';
import { notifyAppAppearanceAffectsTerminals } from './terminalThemes.js';

const OPTIONS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

export function AppThemeControl() {
  const [pref, setPref] = useState(() => getAppThemePref());

  useEffect(() => {
    const onTheme = (e) => {
      if (e?.detail?.pref) setPref(e.detail.pref);
    };
    window.addEventListener(APP_THEME_EVENT, onTheme);
    return () => window.removeEventListener(APP_THEME_EVENT, onTheme);
  }, []);

  return (
    <div
      className="app-theme-control"
      role="group"
      aria-label="App appearance"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`app-theme-btn ${pref === opt.id ? 'active' : ''}`}
          aria-pressed={pref === opt.id}
          title={`${opt.label} appearance`}
          onClick={() => {
            setAppThemePref(opt.id);
            notifyAppAppearanceAffectsTerminals();
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
