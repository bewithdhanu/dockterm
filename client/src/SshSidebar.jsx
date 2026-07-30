import { useCallback, useEffect, useMemo, useState } from 'react';
import { HostFormModal } from './SshModals.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';

const SORT_KEY = 'web-terminal.ssh-sort';
const RECENT_KEY = 'web-terminal.ssh-recent';
const MAX_RECENT = 100;

function readSort() {
  const v = localStorage.getItem(SORT_KEY);
  if (v === 'name-asc' || v === 'name-desc' || v === 'recent') return v;
  return 'name-asc';
}

function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function touchRecent(alias) {
  const map = readRecent();
  map[alias] = Date.now();
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const trimmed = Object.fromEntries(entries.slice(0, MAX_RECENT));
  localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  return trimmed;
}

function nextCopyAlias(alias, hosts) {
  const taken = new Set(hosts.map((h) => h.alias.toLowerCase()));
  const base = `${alias}-copy`;
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base}${i}`.toLowerCase())) i += 1;
  return `${base}${i}`;
}

export function SshSidebar({
  onConnect,
  onOpenConfig,
  collapsed,
  onToggle,
  hostStatuses,
}) {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [configPath, setConfigPath] = useState('~/.ssh/config');
  const [exists, setExists] = useState(true);
  const [sort, setSort] = useState(readSort);
  const [recent, setRecent] = useState(readRecent);
  const [modal, setModal] = useState(null); // 'add' | { type:'edit'|'duplicate', host }
  const [ctxMenu, setCtxMenu] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ssh-hosts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHosts(Array.isArray(data.hosts) ? data.hosts : []);
      if (data.configPath) setConfigPath(data.configPath);
      setExists(data.exists !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener('ssh-hosts-changed', onChanged);
    return () => window.removeEventListener('ssh-hosts-changed', onChanged);
  }, [load]);

  const onSortChange = (value) => {
    setSort(value);
    localStorage.setItem(SORT_KEY, value);
  };

  const handleConnect = (host) => {
    setRecent(touchRecent(host.alias));
    onConnect(host);
  };

  const onHostsSaved = (nextHosts) => {
    if (Array.isArray(nextHosts)) setHosts(nextHosts);
    else load();
  };

  const deleteHost = async (host) => {
    if (!host.editable) {
      alert(
        'This host comes from an Include file or a multi-host entry. Edit the full config instead.'
      );
      return;
    }
    if (!confirm(`Delete SSH host "${host.alias}" from ~/.ssh/config?`)) return;
    try {
      const res = await fetch(`/api/ssh-hosts/${encodeURIComponent(host.alias)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onHostsSaved(data.hosts);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const openHostMenu = (e, host) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, host });
  };

  const ctxItems = useMemo(() => {
    if (!ctxMenu?.host) return [];
    const host = ctxMenu.host;
    return [
      {
        id: 'edit',
        label: 'Edit',
        disabled: !host.editable,
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
      },
      { separator: true },
      {
        id: 'delete',
        label: 'Delete',
        danger: true,
        disabled: !host.editable,
      },
    ];
  }, [ctxMenu]);

  const onCtxAction = (actionId) => {
    const host = ctxMenu?.host;
    if (!host) return;
    if (actionId === 'edit') {
      if (!host.editable) {
        alert(
          'This host comes from an Include file or a multi-host entry. Use “Edit config” instead.'
        );
        return;
      }
      setModal({ type: 'edit', host });
      return;
    }
    if (actionId === 'duplicate') {
      setModal({
        type: 'duplicate',
        host: {
          ...host,
          alias: nextCopyAlias(host.alias, hosts),
        },
        sourceAlias: host.alias,
      });
      return;
    }
    if (actionId === 'delete') {
      deleteHost(host);
    }
  };

  const displayPath = useMemo(() => {
    if (!exists) return 'No ~/.ssh/config';
    return configPath.replace(/\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  }, [configPath, exists]);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = !q
      ? [...hosts]
      : hosts.filter(
          (h) =>
            h.alias.toLowerCase().includes(q) ||
            (h.hostName && h.hostName.toLowerCase().includes(q)) ||
            (h.user && h.user.toLowerCase().includes(q))
        );

    if (sort === 'name-asc') {
      list.sort((a, b) =>
        a.alias.localeCompare(b.alias, undefined, { sensitivity: 'base' })
      );
    } else if (sort === 'name-desc') {
      list.sort((a, b) =>
        b.alias.localeCompare(a.alias, undefined, { sensitivity: 'base' })
      );
    } else if (sort === 'recent') {
      list.sort((a, b) => {
        const ra = recent[a.alias] || 0;
        const rb = recent[b.alias] || 0;
        if (rb !== ra) return rb - ra;
        return a.alias.localeCompare(b.alias, undefined, { sensitivity: 'base' });
      });
    }

    return list;
  }, [hosts, query, sort, recent]);

  const hostStatus = useCallback(
    (alias) => {
      if (!hostStatuses) return null;
      if (hostStatuses instanceof Map) return hostStatuses.get(alias) || null;
      return hostStatuses[alias] || null;
    },
    [hostStatuses]
  );

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button
          type="button"
          className="sidebar-expand"
          onClick={onToggle}
          title="Show SSH hosts"
        >
          ›
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <span>SSH</span>
            <span className="sidebar-count">{hosts.length}</span>
          </div>
          <div className="sidebar-actions">
            <button type="button" onClick={() => setModal('add')} title="Add host">
              +
            </button>
            <button
              type="button"
              onClick={() => onOpenConfig?.()}
              title="Edit config file"
            >
              ✎
            </button>
            <button type="button" onClick={load} title="Reload ~/.ssh/config">
              ↻
            </button>
            <button type="button" onClick={onToggle} title="Hide sidebar">
              ‹
            </button>
          </div>
        </div>

        <div className="sidebar-toolbar">
          <input
            type="search"
            placeholder="Filter hosts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="sidebar-sort"
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            title="Sort hosts"
            aria-label="Sort hosts"
          >
            <option value="name-asc">Name ↑</option>
            <option value="name-desc">Name ↓</option>
            <option value="recent">Recent</option>
          </select>
        </div>

        <div className="sidebar-path" title={configPath}>
          {displayPath}
        </div>

        <div className="sidebar-list">
          {loading && <div className="sidebar-empty">Loading…</div>}
          {!loading && error && (
            <div className="sidebar-empty error">{error}</div>
          )}
          {!loading && !error && filteredSorted.length === 0 && (
            <div className="sidebar-empty">
              {hosts.length === 0 ? 'No hosts in SSH config' : 'No matches'}
            </div>
          )}
          {!loading &&
            filteredSorted.map((host) => {
              const status = hostStatus(host.alias);
              return (
              <button
                key={host.alias}
                type="button"
                className={`ssh-item ${status ? `status-${status}` : ''}`}
                onClick={() => handleConnect(host)}
                onContextMenu={(e) => openHostMenu(e, host)}
                title={`ssh ${host.alias} · right-click for more`}
              >
                <span className="ssh-alias">
                  {host.alias}
                  {status === 'connecting' ? (
                    <span
                      className="ssh-status-dot connecting"
                      title="Connecting…"
                    />
                  ) : null}
                  {status === 'connected' ? (
                    <span
                      className="ssh-status-dot connected"
                      title="Connected"
                    />
                  ) : null}
                  {!host.editable ? (
                    <span className="ssh-lock" title="From Include / multi-host">
                      ⧉
                    </span>
                  ) : null}
                </span>
                <span className="ssh-meta">
                  {host.user ? `${host.user}@` : ''}
                  {host.hostName}
                  {host.port && host.port !== '22' ? `:${host.port}` : ''}
                </span>
              </button>
            );
            })}
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
        <HostFormModal
          mode="add"
          onClose={() => setModal(null)}
          onSaved={onHostsSaved}
        />
      )}
      {modal?.type === 'edit' && (
        <HostFormModal
          mode="edit"
          initial={modal.host}
          onClose={() => setModal(null)}
          onSaved={onHostsSaved}
        />
      )}
      {modal?.type === 'duplicate' && (
        <HostFormModal
          mode="add"
          initial={modal.host}
          titleOverride={`Duplicate ${modal.sourceAlias || modal.host.alias}`}
          onClose={() => setModal(null)}
          onSaved={onHostsSaved}
        />
      )}
    </>
  );
}
