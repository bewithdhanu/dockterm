import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from './SshModals.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';

function previewCommand(command) {
  const lines = String(command || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1));
  if (!lines.length) return '';
  if (lines.length === 1) return lines[0];
  return `${lines[0]} · ${lines.length} lines`;
}

function SnippetFormModal({ mode, initial, onClose, onSaved }) {
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === 'edit' ? `Edit ${initial?.name}` : 'Add snippet'}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="snippet-form"
            className="btn primary"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="snippet-form" className="host-form snippet-form" onSubmit={submit}>
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
            rows={10}
            required
            spellCheck={false}
          />
        </label>
        <p className="modal-hint">
          Multi-line commands are pasted and executed on the active terminal.
        </p>
      </form>
    </Modal>
  );
}

export function SnippetsPanel({ collapsed, onToggle, onRun }) {
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filePath, setFilePath] = useState('~/.ssh/shippets');
  const [modal, setModal] = useState(null); // 'add' | { type:'edit', snippet }
  const [ctxMenu, setCtxMenu] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/snippets');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSnippets(Array.isArray(data.snippets) ? data.snippets : []);
      if (data.path) setFilePath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
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

  const displayPath = filePath.replace(/^\/Users\/[^/]+/, '~');

  const deleteSnippet = async (snippet) => {
    if (!confirm(`Delete snippet “${snippet.name}”?`)) return;
    try {
      const res = await fetch(`/api/snippets/${encodeURIComponent(snippet.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSnippets(data.snippets || []);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
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

  const ctxItems = [
    { id: 'run', label: 'Run' },
    { id: 'edit', label: 'Edit…' },
    { id: 'delete', label: 'Delete', danger: true },
  ];

  const onCtxAction = (id) => {
    const snippet = ctxMenu?.snippet;
    setCtxMenu(null);
    if (!snippet) return;
    if (id === 'run') onRun?.(snippet);
    if (id === 'edit') setModal({ type: 'edit', snippet });
    if (id === 'delete') deleteSnippet(snippet);
  };

  if (collapsed) {
    return (
      <aside className="snippets-panel collapsed" aria-label="Snippets">
        <button
          type="button"
          className="sidebar-expand"
          onClick={onToggle}
          title="Show snippets"
        >
          ‹
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside className="snippets-panel" aria-label="Snippets">
        <div className="sidebar-header">
          <div className="sidebar-title">
            Snippets
            <span className="sidebar-count">{snippets.length}</span>
          </div>
          <div className="sidebar-actions">
            <button
              type="button"
              title="Add snippet"
              onClick={() => setModal('add')}
            >
              +
            </button>
            <button type="button" title="Hide snippets" onClick={onToggle}>
              ›
            </button>
          </div>
        </div>

        <div className="sidebar-toolbar snippets-toolbar">
          <input
            type="search"
            placeholder="Filter snippets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="sidebar-path" title={filePath}>
          {displayPath}
        </div>

        <div className="sidebar-list">
          {loading && <div className="sidebar-empty">Loading…</div>}
          {!loading && error && (
            <div className="sidebar-empty error">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="sidebar-empty">
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
                className="ssh-item snippet-item"
                onClick={() => onRun?.(snippet)}
                onContextMenu={(e) => openMenu(e, snippet)}
                title="Click to run · right-click for more"
              >
                <span className="ssh-alias">{snippet.name}</span>
                <span className="ssh-meta">{previewCommand(snippet.command)}</span>
              </button>
            ))}
        </div>
      </aside>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {modal === 'add' && (
        <SnippetFormModal
          mode="add"
          onClose={() => setModal(null)}
          onSaved={setSnippets}
        />
      )}
      {modal?.type === 'edit' && (
        <SnippetFormModal
          mode="edit"
          initial={modal.snippet}
          onClose={() => setModal(null)}
          onSaved={setSnippets}
        />
      )}
    </>
  );
}
