import { useEffect, useState } from 'react';
import {
  TERMINAL_THEMES,
  TERM_FONT_SIZE_MIN,
  TERM_FONT_SIZE_MAX,
  TERM_THEME_EVENT,
  LOCAL_CONNECTION_KEY,
  getConnectionTermThemeId,
  getEffectiveTermThemeId,
  getTermFontSize,
  setConnectionTermThemeId,
  setTermFontSize,
  connectionLabel as defaultConnectionLabel,
} from './terminalThemes.js';
import { APP_THEME_EVENT } from './appTheme.js';

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

export function ThemesPanel({
  connectionKey = LOCAL_CONNECTION_KEY,
  connectionLabel: labelProp,
}) {
  const label =
    labelProp || defaultConnectionLabel(connectionKey);
  const [followApp, setFollowApp] = useState(
    () => !getConnectionTermThemeId(connectionKey)
  );
  const [themeId, setThemeId] = useState(() =>
    getEffectiveTermThemeId(connectionKey)
  );
  const [fontSize, setFontSize] = useState(() => getTermFontSize());

  useEffect(() => {
    setFollowApp(!getConnectionTermThemeId(connectionKey));
    setThemeId(getEffectiveTermThemeId(connectionKey));
  }, [connectionKey]);

  useEffect(() => {
    const sync = () => {
      setFollowApp(!getConnectionTermThemeId(connectionKey));
      setThemeId(getEffectiveTermThemeId(connectionKey));
      setFontSize(getTermFontSize());
    };
    const onTerm = (e) => {
      if (e?.detail?.fontSize) setFontSize(e.detail.fontSize);
      const key = e?.detail?.connectionKey;
      if (
        e?.detail?.appAppearanceChanged ||
        e?.detail?.globalFont ||
        key == null ||
        key === connectionKey
      ) {
        sync();
      }
    };
    window.addEventListener(TERM_THEME_EVENT, onTerm);
    window.addEventListener(APP_THEME_EVENT, sync);
    return () => {
      window.removeEventListener(TERM_THEME_EVENT, onTerm);
      window.removeEventListener(APP_THEME_EVENT, sync);
    };
  }, [connectionKey]);

  return (
    <div className="themes-panel">
      <div className="themes-panel-header">
        <div className="detail-panel-title">Themes</div>
        <div className="detail-panel-sub">
          Terminal theme for {label}
        </div>
      </div>

      <div className="themes-list">
        <button
          type="button"
          className={`theme-row ${followApp ? 'selected' : ''}`}
          onClick={() => setConnectionTermThemeId(connectionKey, null)}
        >
          <div className="theme-swatch theme-swatch-follow" aria-hidden="true">
            <span className="theme-swatch-text">Auto</span>
          </div>
          <span className="theme-row-name">Follow app theme</span>
          {followApp ? (
            <span className="theme-row-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
        </button>
        {TERMINAL_THEMES.map((item) => {
          const selected = !followApp && item.id === themeId;
          return (
            <button
              key={item.id}
              type="button"
              className={`theme-row ${selected ? 'selected' : ''}`}
              onClick={() => setConnectionTermThemeId(connectionKey, item.id)}
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
