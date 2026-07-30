import { useEffect, useState } from 'react';
import {
  TERMINAL_THEMES,
  TERM_FONT_SIZE_MIN,
  TERM_FONT_SIZE_MAX,
  TERM_THEME_EVENT,
  getTermThemeId,
  getTermFontSize,
  setTermThemeId,
  setTermFontSize,
} from './terminalThemes.js';

function ThemePreview({ theme }) {
  return (
    <div
      className="theme-swatch"
      style={{ background: theme.background, color: theme.foreground }}
      aria-hidden="true"
    >
      <span className="theme-swatch-bars">
        <i style={{ background: theme.red }} />
        <i style={{ background: theme.green }} />
        <i style={{ background: theme.yellow }} />
        <i style={{ background: theme.blue }} />
        <i style={{ background: theme.magenta }} />
        <i style={{ background: theme.cyan }} />
      </span>
      <span className="theme-swatch-text">Aa</span>
    </div>
  );
}

export function ThemesPanel() {
  const [themeId, setThemeId] = useState(() => getTermThemeId());
  const [fontSize, setFontSize] = useState(() => getTermFontSize());

  useEffect(() => {
    const onTheme = (e) => {
      if (e?.detail?.id) setThemeId(e.detail.id);
      if (e?.detail?.fontSize) setFontSize(e.detail.fontSize);
    };
    window.addEventListener(TERM_THEME_EVENT, onTheme);
    return () => window.removeEventListener(TERM_THEME_EVENT, onTheme);
  }, []);

  return (
    <div className="themes-panel">
      <div className="themes-panel-header">
        <div className="detail-panel-title">Themes</div>
        <div className="detail-panel-sub">Terminal appearance</div>
      </div>

      <div className="themes-list">
        {TERMINAL_THEMES.map((item) => {
          const selected = item.id === themeId;
          return (
            <button
              key={item.id}
              type="button"
              className={`theme-row ${selected ? 'selected' : ''}`}
              onClick={() => setTermThemeId(item.id)}
            >
              <ThemePreview theme={item.theme} />
              <span className="theme-row-name">{item.label}</span>
              {selected ? (
                <span className="theme-row-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <label className="themes-font-size-field">
        <span className="themes-font-label">
          Font size{' '}
          <span className="themes-font-size-value">{fontSize}px</span>
        </span>
        <input
          className="themes-font-seek"
          type="range"
          min={TERM_FONT_SIZE_MIN}
          max={TERM_FONT_SIZE_MAX}
          step={1}
          value={fontSize}
          onChange={(e) => setTermFontSize(Number(e.target.value))}
          aria-label="Terminal font size"
        />
      </label>
    </div>
  );
}
