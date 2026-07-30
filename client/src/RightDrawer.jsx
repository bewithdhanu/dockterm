import { useEffect, useState } from 'react';
import { SnippetsPanel } from './SnippetsPanel.jsx';
import { ThemesPanel } from './ThemesPanel.jsx';
import { CommandHistoryPanel } from './CommandHistoryPanel.jsx';

const TAB_KEY = 'dockterm.right-drawer-tab';

function readTab() {
  const v = localStorage.getItem(TAB_KEY);
  if (v === 'snippets' || v === 'history' || v === 'themes') return v;
  return 'snippets';
}

function SnippetsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8.7 17.3 4.4 13l4.3-4.3 1.4 1.4L7.2 13l2.9 2.9-1.4 1.4zm6.6 0-1.4-1.4 2.9-2.9-2.9-2.9 1.4-1.4 4.3 4.3-4.3 4.3z"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13 3a9 9 0 1 0 8.94 8H20a7 7 0 1 1-2.05-4.95L15 9h6V3l-2.12 2.12A8.96 8.96 0 0 0 13 3zm-1 5v5l4.2 2.5.8-1.3-3.5-2.1V8H12z"
      />
    </svg>
  );
}

function ThemesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a9 9 0 0 0 0 18c.7 0 1.2-.5 1.2-1.2 0-.3-.1-.6-.3-.8-.2-.2-.3-.5-.3-.8 0-.7.5-1.2 1.2-1.2H16a5 5 0 0 0 0-10h-.1A9 9 0 0 0 12 3zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
      />
    </svg>
  );
}

/**
 * Termius-style right drawer: icon tabs for Snippets / History / Themes.
 * On the hosts screen, pass `snippetsOnly` to hide History & Themes.
 */
export function RightDrawer({
  onRun,
  onClose,
  snippetsOnly = false,
  initialTab,
}) {
  const [tab, setTab] = useState(() =>
    snippetsOnly ? 'snippets' : initialTab || readTab()
  );

  useEffect(() => {
    if (snippetsOnly) setTab('snippets');
    else if (initialTab) setTab(initialTab);
  }, [snippetsOnly, initialTab]);

  const selectTab = (id) => {
    setTab(id);
    if (!snippetsOnly) localStorage.setItem(TAB_KEY, id);
  };

  return (
    <aside
      className={`right-drawer detail-panel ${snippetsOnly ? 'snippets-only' : ''}`}
      aria-label="Sidebar"
    >
      {!snippetsOnly ? (
        <div className="right-drawer-top">
          <div className="right-drawer-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'snippets'}
              className={`right-drawer-tab ${tab === 'snippets' ? 'active' : ''}`}
              title="Snippets"
              onClick={() => selectTab('snippets')}
            >
              <SnippetsIcon />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={`right-drawer-tab ${tab === 'history' ? 'active' : ''}`}
              title="Command History"
              onClick={() => selectTab('history')}
            >
              <HistoryIcon />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'themes'}
              className={`right-drawer-tab ${tab === 'themes' ? 'active' : ''}`}
              title="Themes"
              onClick={() => selectTab('themes')}
            >
              <ThemesIcon />
            </button>
          </div>
          <button
            type="button"
            className="detail-panel-collapse"
            onClick={onClose}
            title="Hide sidebar"
          >
            ›
          </button>
        </div>
      ) : null}

      <div className="right-drawer-body">
        {tab === 'snippets' || snippetsOnly ? (
          <SnippetsPanel
            embedded
            onRun={onRun}
            onClose={snippetsOnly ? onClose : undefined}
          />
        ) : tab === 'history' ? (
          <CommandHistoryPanel onRun={onRun} />
        ) : (
          <ThemesPanel />
        )}
      </div>
    </aside>
  );
}
