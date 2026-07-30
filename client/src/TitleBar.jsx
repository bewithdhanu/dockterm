import { useEffect, useState } from 'react';

function getApi() {
  return typeof window !== 'undefined' ? window.dockterm : null;
}

export function useElectronShell() {
  const [api] = useState(() => getApi());
  return api?.isElectron ? api : null;
}

export function TitleBar() {
  const api = useElectronShell();
  const [maximized, setMaximized] = useState(false);

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

  if (!api) return null;

  const isMac = api.platform === 'darwin';

  return (
    <header
      className={`app-titlebar ${isMac ? 'is-mac' : 'is-win'}`}
      onDoubleClick={() => {
        api.maximize?.();
        api.isMaximized?.().then((v) => setMaximized(Boolean(v)));
      }}
    >
      <div className="app-titlebar-drag">
        <img className="app-titlebar-logo" src="/logo.png" alt="" draggable={false} />
        <span className="app-titlebar-name">DockTerm</span>
      </div>

      {!isMac && (
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
            title="Close"
            onClick={() => api.close()}
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
}
