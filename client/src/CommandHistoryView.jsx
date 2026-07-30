import { useEffect, useMemo, useState } from 'react';
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5.5 2A1.5 1.5 0 0 0 4 3.5v8A1.5 1.5 0 0 0 5.5 13H11a1 1 0 0 0 1-1V3.5A1.5 1.5 0 0 0 10.5 2h-5zM5 3.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V11H5.5a.5.5 0 0 1-.5-.5v-7z"
      />
      <path
        fill="currentColor"
        d="M2 5.5A1.5 1.5 0 0 1 3.5 4H4v1h-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5H9v1H3.5A1.5 1.5 0 0 1 2 12.5v-7z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 4.6-4.6L12.2 5.5 6.5 11.2z"
      />
    </svg>
  );
}

async function copyText(text) {
  const value = String(text || '');
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
 * Full hosts-page Command History view (left-nav section).
 */
export function CommandHistoryView({ onRun, onOpenTerminal, onOpenConfig }) {
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
          <svg
            className="hosts-search-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
            />
          </svg>
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
              return (
                <div
                  key={entry.id}
                  className="host-card snippet-card cmd-history-card"
                >
                  <button
                    type="button"
                    className="cmd-history-card-run"
                    title="Click to run again"
                    onClick={() => onRun?.({ command: entry.command })}
                  >
                    <div className="host-card-main">
                      <div className="snippet-card-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path
                            fill="currentColor"
                            d="M13 3a9 9 0 1 0 8.94 8H20a7 7 0 1 1-2.05-4.95L15 9h6V3l-2.12 2.12A8.96 8.96 0 0 0 13 3zm-1 5v5l4.2 2.5.8-1.3-3.5-2.1V8H12z"
                          />
                        </svg>
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
                    {copied ? <CheckIcon /> : <CopyIcon />}
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
