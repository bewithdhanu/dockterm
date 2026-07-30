import { useCallback, useEffect, useMemo, useState } from 'react';
import { TabContextMenu } from './TabContextMenu.jsx';
import { notifySnippetsChanged } from './SnippetsView.jsx';

function previewCommand(command) {
  const lines = String(command || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1));
  if (!lines.length) return '';
  if (lines.length === 1) return lines[0];
  return `${lines[0]} · ${lines.length} lines`;
}

function SnippetFormPanel({ mode, initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || '');
  const [command, setCommand] = useState(initial?.command || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
      onSaved(data.snippets || []);
      notifySnippetsChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="snippet-side-form">
      <div className="detail-panel-header embedded side-form-header">
        <div>
          <div className="detail-panel-title">
            {mode === 'edit' ? 'Edit snippet' : 'New snippet'}
          </div>
          <div className="detail-panel-sub">
            {mode === 'edit'
              ? initial?.name || 'Snippet'
              : 'New snippet'}
          </div>
        </div>
        <div className="detail-panel-header-actions">
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
  );
}

/** Compact snippets list for the session right drawer (run on click). */
export function SnippetsPanel({ onRun, onClose, embedded = false }) {
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);

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
    return () => window.removeEventListener('dockterm-snippets-changed', onChanged);
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
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const openMenu = (e, snippet) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, snippet });
  };

  const onCtxAction = (id) => {
    const snippet = ctxMenu?.snippet;
    setCtxMenu(null);
    if (!snippet) return;
    if (id === 'run') onRun?.(snippet);
    if (id === 'edit') setModal({ type: 'edit', snippet });
    if (id === 'delete') deleteSnippet(snippet);
  };

  if (modal === 'add' || modal?.type === 'edit') {
    const form = (
      <SnippetFormPanel
        mode={modal === 'add' ? 'add' : 'edit'}
        initial={modal === 'add' ? null : modal.snippet}
        onClose={() => setModal(null)}
        onSaved={setSnippets}
      />
    );
    return embedded ? (
      <div className="snippets-embedded">{form}</div>
    ) : (
      <aside className="detail-panel snippets-drawer" aria-label="Snippets">
        {form}
      </aside>
    );
  }

  const body = (
    <>
      <div className={`detail-panel-header ${embedded ? 'embedded' : ''}`}>
        <div>
          <div className="detail-panel-title">
            Snippets
            <span className="sidebar-count">{snippets.length}</span>
          </div>
        </div>
        <div className="detail-panel-header-actions">
          <button
            type="button"
            className="detail-icon-btn"
            title="Add snippet"
            onClick={() => setModal('add')}
          >
            +
          </button>
          {onClose ? (
            <button
              type="button"
              className="detail-panel-collapse"
              onClick={onClose}
              title="Close"
            >
              ›
            </button>
          ) : null}
        </div>
      </div>

      <div className="detail-section">
        <input
          className="detail-search"
          type="search"
          placeholder="Filter snippets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="snippets-drawer-list">
        {loading && <div className="hosts-empty">Loading…</div>}
        {!loading && error && (
          <div className="hosts-empty error">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="hosts-empty">
            {snippets.length === 0
              ? 'No snippets yet — click + to add'
              : 'No matches'}
          </div>
        )}
        {!loading &&
          filtered.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              className="snippet-row"
              onClick={() => onRun?.(snippet)}
              onContextMenu={(e) => openMenu(e, snippet)}
              title="Click to run · right-click for more"
            >
              <span className="snippet-row-name">{snippet.name}</span>
              <span className="snippet-row-meta">
                {previewCommand(snippet.command)}
              </span>
            </button>
          ))}
      </div>
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="snippets-embedded">{body}</div>
      ) : (
        <aside className="detail-panel snippets-drawer" aria-label="Snippets">
          {body}
        </aside>
      )}

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { id: 'run', label: 'Run' },
            { id: 'edit', label: 'Edit…' },
            { id: 'delete', label: 'Delete', danger: true },
          ]}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}
