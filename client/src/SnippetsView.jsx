import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuPencil, LuSearch } from 'react-icons/lu';
import { TabContextMenu } from './TabContextMenu.jsx';
import { MarqueeBox, useMarqueeSelect } from './useMarqueeSelect.jsx';

function previewCommand(command) {
  const lines = String(command || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1));
  if (!lines.length) return '';
  if (lines.length === 1) return lines[0];
  return `${lines[0]} · ${lines.length} lines`;
}

export function nextCopySnippetName(name, snippets) {
  const taken = new Set(snippets.map((s) => s.name.toLowerCase()));
  const base = `${name} copy`;
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`.toLowerCase())) i += 1;
  return `${base} ${i}`;
}

export function notifySnippetsChanged() {
  try {
    window.dispatchEvent(new Event('dockterm-snippets-changed'));
  } catch {
    /* ignore */
  }
}

/**
 * Right-side create / edit panel for a snippet.
 * Shows Edit / Duplicate / Delete for existing snippets.
 */
export function SnippetDetailPanel({
  mode,
  initial,
  onClose,
  onSaved,
  onDuplicate,
  onDelete,
}) {
  const [name, setName] = useState(initial?.name || '');
  const [command, setCommand] = useState(initial?.command || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);

  useEffect(() => {
    setName(initial?.name || '');
    setCommand(initial?.command || '');
    setError(null);
  }, [initial?.id, initial?.name, initial?.command, mode]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        command: command.replace(/\r\n/g, '\n'),
      };
      const res =
        mode === 'edit'
          ? await fetch(`/api/snippets/${encodeURIComponent(initial.id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          : await fetch('/api/snippets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved?.(data.snippets || [], data.snippet || null);
      notifySnippetsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const openMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect =
      e.currentTarget instanceof Element
        ? e.currentTarget.getBoundingClientRect()
        : null;
    setCtxMenu({
      x: rect ? rect.right - 8 : e.clientX,
      y: rect ? rect.bottom + 4 : e.clientY,
    });
  };

  const onCtxAction = (id) => {
    setCtxMenu(null);
    if (id === 'edit') {
      /* already editing */
      return;
    }
    if (id === 'duplicate') {
      onDuplicate?.(
        mode === 'edit'
          ? { ...initial, name, command }
          : { name, command }
      );
      return;
    }
    if (id === 'delete' && mode === 'edit' && initial) {
      onDelete?.(initial);
    }
  };

  return (
    <>
      <aside className="right-drawer detail-panel snippets-only" aria-label="Snippet details">
        <div className="right-drawer-body snippet-detail-body">
          <div className="snippet-side-form">
            <div className="detail-panel-header embedded side-form-header">
              <div>
                <div className="detail-panel-title">
                  {mode === 'edit' ? 'Snippet' : 'New snippet'}
                </div>
                <div className="detail-panel-sub">
                  {mode === 'edit' ? initial?.name || 'Details' : 'New snippet'}
                </div>
              </div>
              <div className="detail-panel-header-actions">
                <button
                  type="button"
                  className="host-card-menu snippet-detail-menu"
                  title="More"
                  aria-label="Snippet options"
                  onClick={openMenu}
                >
                  ⋯
                </button>
                <button
                  type="button"
                  className="side-form-close"
                  onClick={onClose}
                  title="Close"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <form
              className="host-form snippet-form snippet-side-form-body"
              onSubmit={submit}
            >
              {error && <div className="form-error">{error}</div>}
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Disk usage"
                  required
                  autoFocus
                />
              </label>
              <label>
                <span>Command(s)</span>
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={'df -h\nfree -m\n'}
                  rows={12}
                  required
                  spellCheck={false}
                />
              </label>
              <p className="modal-hint">
                Multi-line commands paste and run on the active terminal.
              </p>
              <div className="side-form-actions">
                <button
                  type="submit"
                  className="btn primary side-form-save"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </aside>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { id: 'edit', label: 'Edit' },
            {
              id: 'duplicate',
              label: 'Duplicate',
              disabled: !(name.trim() || initial?.name),
            },
            { separator: true },
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              disabled: mode !== 'edit',
            },
          ]}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

/**
 * Main snippets screen — card grid like HostsView.
 */
export function SnippetsView({
  selectedId,
  onOpenNew,
  onOpenEdit,
  onOpenDuplicate,
  onDeleted,
  onOpenTerminal,
  onOpenConfig,
}) {
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const gridWrapRef = useRef(null);
  const { selectedIds, selectOnly, toggle, box } = useMarqueeSelect({
    containerRef: gridWrapRef,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/snippets');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSnippets(Array.isArray(data.snippets) ? data.snippets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener('dockterm-snippets-changed', onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      window.removeEventListener('dockterm-snippets-changed', onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q)
    );
  }, [snippets, query]);

  const deleteSnippet = async (snippet) => {
    if (!confirm(`Delete snippet “${snippet.name}”?`)) return;
    try {
      const res = await fetch(`/api/snippets/${encodeURIComponent(snippet.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSnippets(data.snippets || []);
      notifySnippetsChanged();
      onDeleted?.(snippet.id);
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const openMenu = (e, snippet) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      snippet,
    });
  };

  const openEdit = (e, snippet) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenEdit?.(snippet);
  };

  const onCtxAction = (id) => {
    const snippet = ctxMenu?.snippet;
    setCtxMenu(null);
    if (!snippet) return;
    if (id === 'edit') onOpenEdit?.(snippet);
    if (id === 'duplicate') {
      onOpenDuplicate?.({
        ...snippet,
        name: nextCopySnippetName(snippet.name, snippets),
      });
    }
    if (id === 'delete') deleteSnippet(snippet);
  };

  return (
    <div className="hosts-view snippets-view">
      <div className="hosts-search-row">
        <div className="hosts-search">
          <LuSearch
            className="hosts-search-icon"
            size={16}
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Find a snippet…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="hosts-toolbar">
        <div className="hosts-toolbar-left">
          <button
            type="button"
            className="hosts-tool-btn primary"
            onClick={() => onOpenNew?.()}
          >
            New Snippet
          </button>
          <button
            type="button"
            className="hosts-tool-btn"
            onClick={() => onOpenTerminal?.()}
          >
            Terminal
          </button>
          <button
            type="button"
            className="hosts-tool-btn"
            onClick={() => onOpenConfig?.()}
          >
            Config
          </button>
        </div>
      </div>

      <div className="hosts-grid-wrap" ref={gridWrapRef}>
        {loading && <div className="hosts-empty">Loading snippets…</div>}
        {!loading && error && (
          <div className="hosts-empty error">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="hosts-empty">
            {snippets.length === 0
              ? 'No snippets yet — click New Snippet'
              : 'No matches'}
          </div>
        )}
        {!loading && !error && (
          <div className="hosts-grid">
            {filtered.map((snippet) => {
              const selected =
                selectedId === snippet.id || selectedIds.has(snippet.id);
              return (
              <div
                key={snippet.id}
                role="button"
                tabIndex={0}
                data-select-id={snippet.id}
                className={`host-card snippet-card ${
                  selected ? 'selected marquee-selected' : ''
                }`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    toggle(snippet.id);
                    return;
                  }
                  selectOnly(snippet.id);
                  onOpenEdit?.(snippet);
                }}
                onContextMenu={(e) => openMenu(e, snippet)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenEdit?.(snippet);
                  }
                }}
              >
                <div className="host-card-main">
                  <div className="snippet-card-icon" aria-hidden="true">
                    {'</>'}
                  </div>
                  <div className="host-card-body">
                    <div className="host-card-name" title={snippet.name}>
                      {snippet.name}
                    </div>
                    <div
                      className="host-card-meta snippet-card-meta"
                      title={previewCommand(snippet.command)}
                    >
                      {previewCommand(snippet.command)}
                    </div>
                  </div>
                </div>
                <div className="host-card-actions">
                  <button
                    type="button"
                    className="host-card-menu"
                    title="Edit"
                    aria-label={`Edit ${snippet.name}`}
                    onClick={(e) => openEdit(e, snippet)}
                    onContextMenu={(e) => openMenu(e, snippet)}
                  >
                    <LuPencil size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <MarqueeBox box={box} />

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { id: 'edit', label: 'Edit' },
            { id: 'duplicate', label: 'Duplicate' },
            { separator: true },
            { id: 'delete', label: 'Delete', danger: true },
          ]}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
