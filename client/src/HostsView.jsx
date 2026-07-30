import { useMemo, useRef, useState } from 'react';
import { LuPencil, LuSearch } from 'react-icons/lu';
import { HostOsBadge } from './HostOsBadge.jsx';
import { SortDropdown } from './SortDropdown.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';
import { nextCopyAlias } from './useSshHosts.js';
import { MarqueeBox, useMarqueeSelect } from './useMarqueeSelect.jsx';

function hostMeta(host) {
  const user = host.user ? `${host.user}@` : '';
  const port = host.port && host.port !== '22' ? `:${host.port}` : '';
  return `${user}${host.hostName || ''}${port}`;
}

export function HostsView({
  hostsApi,
  hostStatuses,
  hostOsByAlias,
  onConnect,
  onOpenTerminal,
  onOpenConfig,
  onOpenNewHost,
  onOpenEditHost,
  onOpenDuplicateHost,
  selectedAlias,
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
  const gridWrapRef = useRef(null);
  const { selectedIds, selectOnly, toggle, box } = useMarqueeSelect({
    containerRef: gridWrapRef,
  });

  const list = useMemo(() => filterSort(query), [filterSort, query]);

  const hostStatus = (alias) => {
    if (!hostStatuses) return null;
    if (hostStatuses instanceof Map) return hostStatuses.get(alias) || null;
    return hostStatuses[alias] || null;
  };

  const hostOs = (alias) => hostOsByAlias?.[alias] || null;

  const connect = (host) => {
    markRecent(host.alias);
    onConnect?.(host);
  };

  const tryConnectQuery = () => {
    const q = query.trim();
    if (!q) return;
    const exact = hosts.find(
      (h) => h.alias.toLowerCase() === q.toLowerCase()
    );
    if (exact) {
      connect(exact);
      return;
    }
    if (list[0]) {
      connect(list[0]);
      return;
    }
    alert('No matching host. Add it with New Host, or pick a card.');
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
      onOpenDuplicateHost?.({
        ...host,
        alias: nextCopyAlias(host.alias, hosts),
      }, host.alias);
    }
    if (actionId === 'delete') deleteHost(host);
  };

  return (
    <div className="hosts-view">
      <div className="hosts-search-row">
        <div className="hosts-search">
          <LuSearch
            className="hosts-search-icon"
            size={16}
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Find a host or ssh user@hostname…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tryConnectQuery();
            }}
          />
          <button
            type="button"
            className="hosts-connect-btn"
            onClick={tryConnectQuery}
          >
            Connect
          </button>
        </div>
      </div>

      <div className="hosts-toolbar">
        <div className="hosts-toolbar-left">
          <button
            type="button"
            className="hosts-tool-btn primary"
            onClick={() => onOpenNewHost?.()}
          >
            New Host
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
        <div className="hosts-toolbar-right">
          <SortDropdown
            value={sort}
            onChange={onSortChange}
            label="Sort hosts"
          />
        </div>
      </div>

      <div className="hosts-grid-wrap" ref={gridWrapRef}>
        {loading && <div className="hosts-empty">Loading hosts…</div>}
        {!loading && error && (
          <div className="hosts-empty error">{error}</div>
        )}
        {!loading && !error && list.length === 0 && (
          <div className="hosts-empty">
            {hosts.length === 0
              ? 'No hosts in ~/.ssh/config — click New Host'
              : 'No matches'}
          </div>
        )}
        {!loading && !error && (
          <div className="hosts-grid">
            {list.map((host) => {
              const status = hostStatus(host.alias);
              const os = hostOs(host.alias);
              const selected =
                selectedAlias === host.alias || selectedIds.has(host.alias);
              return (
                <div
                  key={host.alias}
                  role="button"
                  tabIndex={0}
                  data-select-id={host.alias}
                  className={`host-card ${status ? `status-${status}` : ''} ${
                    selected ? 'selected marquee-selected' : ''
                  }`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      toggle(host.alias);
                      return;
                    }
                    selectOnly(host.alias);
                    connect(host);
                  }}
                  onContextMenu={(e) => openHostMenu(e, host)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      connect(host);
                    }
                  }}
                >
                  <div className="host-card-main">
                    <HostOsBadge
                      osId={os?.id}
                      status={status}
                      title={os?.pretty || os?.label || 'SSH'}
                    />
                    <div className="host-card-body">
                      <div className="host-card-name" title={host.alias}>
                        {host.alias}
                      </div>
                      <div className="host-card-meta" title={hostMeta(host)}>
                        {hostMeta(host)}
                      </div>
                      {!host.editable ? (
                        <div className="host-card-lock">
                          Include / multi-host
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="host-card-actions">
                    <button
                      type="button"
                      className="host-card-menu"
                      title="Edit"
                      aria-label={`Edit ${host.alias}`}
                      onClick={(e) => openHostEdit(e, host)}
                      onContextMenu={(e) => openHostMenu(e, host)}
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
    </div>
  );
}
