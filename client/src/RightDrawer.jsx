import { useEffect, useState } from 'react';
import { LuCode, LuHistory, LuPalette } from 'react-icons/lu';
import { SnippetsPanel } from './SnippetsPanel.jsx';
import { ThemesPanel } from './ThemesPanel.jsx';
import { CommandHistoryPanel } from './CommandHistoryPanel.jsx';

const TAB_KEY = 'dockterm.right-drawer-tab';

function readTab() {
  const v = localStorage.getItem(TAB_KEY);
  if (v === 'snippets' || v === 'history' || v === 'themes') return v;
  return 'snippets';
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
              <LuCode size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={`right-drawer-tab ${tab === 'history' ? 'active' : ''}`}
              title="Command History"
              onClick={() => selectTab('history')}
            >
              <LuHistory size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'themes'}
              className={`right-drawer-tab ${tab === 'themes' ? 'active' : ''}`}
              title="Themes"
              onClick={() => selectTab('themes')}
            >
              <LuPalette size={18} aria-hidden="true" />
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
