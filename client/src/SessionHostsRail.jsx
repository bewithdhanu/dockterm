import { useMemo, useState } from 'react';
import { LuPencil } from 'react-icons/lu';
import { HostOsBadge } from './HostOsBadge.jsx';
import { SortDropdown } from './SortDropdown.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';
import { nextCopyAlias } from './useSshHosts.js';

function hostMeta(host) {
  const user = host.user ? `${host.user}@` : '';
  const port = host.port && host.port !== '22' ? `:${host.port}` : '';
  return `${user}${host.hostName || ''}${port}`;
}

/**
 * Compact host list for the terminal session left rail.
 */
export function SessionHostsRail({
  hostsApi,
  hostStatuses,
  hostOsByAlias,
  onConnect,
  onCollapse,
  onOpenEditHost,
  onOpenDuplicateHost,
}) {
  const {
    hosts,
    loading,
    error,
    sort,
    onSortChange,
    filterSort,
    deleteHost,
    markRecent,
  } = hostsApi;

  const [query, setQuery] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);

  const list = useMemo(() => filterSort(query), [filterSort, query]);

  const hostStatus = (alias) => {
    if (!hostStatuses) return null;
    if (hostStatuses instanceof Map) return hostStatuses.get(alias) || null;
    return hostStatuses[alias] || null;
  };

  const connect = (host) => {
    markRecent(host.alias);
    onConnect?.(host);
  };

  const openHostMenu = (e, host) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      host,
    });
  };

  const openHostEdit = (e, host) => {
    e.preventDefault();
    e.stopPropagation();
    if (!host.editable) {
      alert(
        'This host comes from an Include file or a multi-host entry. Use Config instead.'
      );
      return;
    }
    onOpenEditHost?.(host);
  };

  const onCtxAction = (actionId) => {
    const host = ctxMenu?.host;
    setCtxMenu(null);
    if (!host) return;
    if (actionId === 'edit') {
      if (!host.editable) {
        alert(
          'This host comes from an Include file or a multi-host entry. Use Config instead.'
        );
        return;
      }
      onOpenEditHost?.(host);
    }
    if (actionId === 'duplicate') {
      onOpenDuplicateHost?.(
        { ...host, alias: nextCopyAlias(host.alias, hosts) },
        host.alias
      );
    }
    if (actionId === 'delete') deleteHost(host);
  };

  return (
    <>
      <aside className="session-hosts-rail" aria-label="Hosts">
        <div className="session-hosts-header">
          <div className="detail-panel-title">
            Hosts
            <span className="sidebar-count">{hosts.length}</span>
          </div>
          <button
            type="button"
            className="detail-panel-collapse"
            onClick={onCollapse}
            title="Hide hosts"
          >
            ‹
          </button>
        </div>

        <div className="session-hosts-tools">
          <input
            className="detail-search"
            type="search"
            placeholder="Search hosts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SortDropdown
            className="session-hosts-sort"
            value={sort}
            onChange={onSortChange}
            label="Sort hosts"
          />
        </div>

        <div className="session-hosts-list">
          {loading && <div className="hosts-empty">Loading…</div>}
          {!loading && error && (
            <div className="hosts-empty error">{error}</div>
          )}
          {!loading && !error && list.length === 0 && (
            <div className="hosts-empty">No matches</div>
          )}
          {!loading &&
            !error &&
            list.map((host) => {
              const status = hostStatus(host.alias);
              const os = hostOsByAlias?.[host.alias];
              const meta = hostMeta(host);
              return (
                <div
                  key={host.alias}
                  className={`session-host-row ${status ? `status-${status}` : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => connect(host)}
                  onContextMenu={(e) => openHostMenu(e, host)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      connect(host);
                    }
                  }}
                >
                  <HostOsBadge
                    osId={os?.id}
                    status={status}
                    size={16}
                    title={os?.pretty || os?.label || 'SSH'}
                  />
                  <div className="session-host-text">
                    <div className="session-host-name" title={host.alias}>
                      {host.alias}
                    </div>
                    <div className="session-host-meta" title={meta}>
                      {meta}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="host-card-menu session-host-menu"
                    title="Edit"
                    aria-label={`Edit ${host.alias}`}
                    onClick={(e) => openHostEdit(e, host)}
                    onContextMenu={(e) => openHostMenu(e, host)}
                  >
                    <LuPencil size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
        </div>
      </aside>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { id: 'edit', label: 'Edit', disabled: !ctxMenu.host?.editable },
            { id: 'duplicate', label: 'Duplicate' },
            { separator: true },
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              disabled: !ctxMenu.host?.editable,
            },
          ]}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}
