import { useEffect, useMemo, useState } from 'react';
import { LuCheck, LuCopy, LuHistory, LuSearch } from 'react-icons/lu';
import {
  HistoryDayCalendar,
  SearchableHostFilter,
} from './HistoryFilters.jsx';
import { HistoryEntryMeta } from './HistoryEntryMeta.jsx';
import {
  COMMAND_HISTORY_EVENT,
  clearCommandHistory,
  loadCommandHistory,
} from './commandHistory.js';

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatWhen(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = ordinal(d.getDate());
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${month} ${day}, ${time}`;
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function copyText(text) {
  const value = String(text || '');
  const api = typeof window !== 'undefined' ? window.dockterm : null;
  if (api?.clipboardWrite) {
    try {
      await api.clipboardWrite(value);
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Right-side detail pane for a history entry (hosts → History).
 */
export function HistoryDetailPanel({ entry, onClose, onRun }) {
  const [copied, setCopied] = useState(false);

  if (!entry) return null;

  const when = formatWhen(entry.at);
  const where = String(entry.where || 'Local').trim() || 'Local';
  const cwd = entry.cwd ? String(entry.cwd) : '';

  const copyCommand = async () => {
    const ok = await copyText(entry.command);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <aside
      className="right-drawer detail-panel snippets-only"
      aria-label="Command history details"
    >
      <div className="right-drawer-body snippet-detail-body">
        <div className="snippet-side-form">
          <div className="detail-panel-header embedded side-form-header">
            <div>
              <div className="detail-panel-title">Command</div>
              <div className="detail-panel-sub">
                {[where, when].filter(Boolean).join(' · ') || 'History'}
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

          <div className="host-form snippet-form snippet-side-form-body history-detail-body">
            <label>
              <span>Command</span>
              <textarea
                value={entry.command || ''}
                readOnly
                rows={10}
                spellCheck={false}
              />
            </label>

            <div className="history-detail-meta">
              <div className="detail-section">
                <div className="detail-label">Host</div>
                <div className="history-detail-value">{where}</div>
              </div>
              {when ? (
                <div className="detail-section">
                  <div className="detail-label">When</div>
                  <div className="history-detail-value">{when}</div>
                </div>
              ) : null}
              {cwd ? (
                <div className="detail-section">
                  <div className="detail-label">Path</div>
                  <div
                    className="history-detail-value history-detail-path"
                    title={cwd}
                  >
                    {cwd}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="side-form-actions history-detail-actions">
              <button
                type="button"
                className="btn primary side-form-save"
                onClick={() => onRun?.({ command: entry.command })}
              >
                Run
              </button>
              <button
                type="button"
                className="btn side-form-save"
                onClick={copyCommand}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * Full hosts-page Command History view (left-nav section).
 */
export function CommandHistoryView({
  selectedId = null,
  onSelect,
  onOpenTerminal,
  onOpenConfig,
}) {
  const [entries, setEntries] = useState(() => loadCommandHistory());
  const [query, setQuery] = useState('');
  const [hostFilter, setHostFilter] = useState('all');
  /** @type {[number | null, Function]} */
  const [selectedDay, setSelectedDay] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    const onUpdate = (e) => {
      const next = e?.detail?.entries;
      setEntries(Array.isArray(next) ? next : loadCommandHistory());
    };
    window.addEventListener(COMMAND_HISTORY_EVENT, onUpdate);
    return () => window.removeEventListener(COMMAND_HISTORY_EVENT, onUpdate);
  }, []);

  const hosts = useMemo(() => {
    const names = new Set();
    for (const e of entries) {
      const w = String(e.where || '').trim();
      if (w) names.add(w);
    }
    return [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [entries]);

  useEffect(() => {
    if (hostFilter === 'all') return;
    if (!hosts.includes(hostFilter)) setHostFilter('all');
  }, [hostFilter, hosts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...entries].reverse().filter((e) => {
      if (hostFilter !== 'all' && e.where !== hostFilter) return false;
      if (selectedDay != null) {
        if (startOfLocalDay(new Date(e.at)) !== selectedDay) return false;
      }
      if (!q) return true;
      const hay = `${e.command}\n${e.where || ''}\n${e.cwd || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, hostFilter, selectedDay]);

  return (
    <div className="hosts-view cmd-history-view">
      <div className="hosts-search-row">
        <div className="hosts-search">
          <LuSearch
            className="hosts-search-icon"
            size={16}
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Find a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="hosts-toolbar">
        <div className="hosts-toolbar-left">
          <button
            type="button"
            className="hosts-tool-btn"
            disabled={entries.length === 0}
            onClick={() => {
              if (!confirm('Clear command history?')) return;
              setEntries(clearCommandHistory());
              onSelect?.(null);
            }}
          >
            Clear
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
        <div className="hosts-toolbar-right cmd-history-filters">
          <SearchableHostFilter
            value={hostFilter}
            onChange={setHostFilter}
            hosts={hosts}
          />
          <HistoryDayCalendar
            value={selectedDay}
            onChange={setSelectedDay}
          />
        </div>
      </div>

      <div className="hosts-grid-wrap">
        {filtered.length === 0 ? (
          <div className="hosts-empty">
            {entries.length === 0
              ? 'No commands yet — run something in a terminal'
              : 'No matches'}
          </div>
        ) : (
          <div className="hosts-grid cmd-history-grid">
            {filtered.map((entry) => {
              const copied = copiedId === entry.id;
              const selected = selectedId === entry.id;
              return (
                <div
                  key={entry.id}
                  className={`host-card snippet-card cmd-history-card${
                    selected ? ' selected' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="cmd-history-card-run"
                    title="View details"
                    aria-pressed={selected}
                    onClick={() => onSelect?.(entry)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect?.(entry);
                      }
                    }}
                  >
                    <div className="host-card-main">
                      <div className="snippet-card-icon" aria-hidden="true">
                        <LuHistory size={18} />
                      </div>
                      <div className="host-card-body">
                        <div
                          className="host-card-name cmd-history-cmd-text"
                          title={entry.command}
                        >
                          {entry.command}
                        </div>
                        <HistoryEntryMeta
                          where={entry.where}
                          at={entry.at}
                          cwd={entry.cwd}
                          formatWhen={formatWhen}
                        />
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`cmd-history-copy${copied ? ' copied' : ''}`}
                    title={copied ? 'Copied' : 'Copy command'}
                    aria-label={copied ? 'Copied' : 'Copy command'}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const ok = await copyText(entry.command);
                      if (!ok) return;
                      setCopiedId(entry.id);
                      setTimeout(() => {
                        setCopiedId((cur) => (cur === entry.id ? null : cur));
                      }, 1200);
                    }}
                  >
                    {copied ? <LuCheck size={14} /> : <LuCopy size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
