import { useEffect, useState } from 'react';

function getApi() {
  return typeof window !== 'undefined' ? window.dockterm : null;
}

export function useElectronShell() {
  const [api] = useState(() => getApi());
  return api?.isElectron ? api : null;
}

/**
 * Frameless top chrome: brand + session tabs (children) + window controls.
 */
export function TitleBar({ children }) {
  const api = useElectronShell();
  const [maximized, setMaximized] = useState(false);
  const isMac = api?.platform === 'darwin';
  const isElectron = Boolean(api);

  useEffect(() => {
    if (!api?.isMaximized) return;
    let cancelled = false;
    api.isMaximized().then((v) => {
      if (!cancelled) setMaximized(Boolean(v));
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <header
      className={`top-chrome ${isElectron ? 'is-electron' : ''} ${
        isMac ? 'is-mac' : 'is-win'
      }`}
      onDoubleClick={() => {
        if (!api) return;
        api.maximize?.();
        api.isMaximized?.().then((v) => setMaximized(Boolean(v)));
      }}
    >
      <div className="top-chrome-brand">
        <img
          className="top-chrome-logo"
          src="/logo.png"
          alt=""
          draggable={false}
        />
        <span className="top-chrome-name">DockTerm</span>
      </div>

      <div className="top-chrome-tabs">{children}</div>

      {isElectron && !isMac && (
        <div className="app-titlebar-controls">
          <button
            type="button"
            className="app-titlebar-btn"
            title="Minimize"
            onClick={() => api.minimize()}
          >
            ─
          </button>
          <button
            type="button"
            className="app-titlebar-btn"
            title={maximized ? 'Restore' : 'Maximize'}
            onClick={() => {
              api.maximize();
              api.isMaximized?.().then((v) => setMaximized(Boolean(v)));
            }}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button
            type="button"
            className="app-titlebar-btn close"
            title="Hide"
            onClick={() => api.close()}
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
}
