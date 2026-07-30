import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuCopy } from 'react-icons/lu';
import {
  COMMAND_HISTORY_EVENT,
  clearCommandHistory,
  loadCommandHistory,
} from './commandHistory.js';
import { HistoryEntryMeta } from './HistoryEntryMeta.jsx';

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

export function CommandHistoryPanel({ onRun }) {
  const [entries, setEntries] = useState(() => loadCommandHistory());
  const [copiedId, setCopiedId] = useState(null);
  const listRef = useRef(null);
  const stickTopRef = useRef(true);
  const copiedTimerRef = useRef(null);

  // Newest first for display.
  const visible = [...entries].reverse();

  useEffect(() => {
    const onUpdate = (e) => {
      const next = e?.detail?.entries;
      setEntries(Array.isArray(next) ? next : loadCommandHistory());
    };
    window.addEventListener(COMMAND_HISTORY_EVENT, onUpdate);
    return () => window.removeEventListener(COMMAND_HISTORY_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickTopRef.current) return;
    el.scrollTop = 0;
  }, [entries]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickTopRef.current = el.scrollTop < 48;
  };

  const copyCommand = async (entry, e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(entry.command);
    if (!ok) return;
    setCopiedId(entry.id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1200);
  };

  return (
    <div className="cmd-history-panel">
      <div className="cmd-history-header">
        <div>
          <div className="detail-panel-title">Command History</div>
          <div className="detail-panel-sub">Last 30 days · all terminals</div>
        </div>
        {entries.length > 0 ? (
          <button
            type="button"
            className="cmd-history-clear"
            title="Clear history"
            onClick={() => {
              if (!confirm('Clear command history?')) return;
              setEntries(clearCommandHistory());
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <div className="cmd-history-empty">
          Commands you run in any terminal will show up here.
        </div>
      ) : (
        <div
          ref={listRef}
          className="cmd-history-list"
          onScroll={onScroll}
          role="list"
        >
          {visible.map((entry) => {
            const copied = copiedId === entry.id;
            return (
              <div
                key={entry.id}
                className="snippet-row cmd-history-row"
                role="listitem"
              >
                <button
                  type="button"
                  className="cmd-history-run"
                  title={onRun ? 'Click to run · hover to copy' : entry.command}
                  onClick={() => onRun?.({ command: entry.command })}
                >
                  <span
                    className="snippet-row-name cmd-history-cmd-text"
                    title={entry.command}
                  >
                    {entry.command}
                  </span>
                  <HistoryEntryMeta
                    where={entry.where}
                    at={entry.at}
                    cwd={entry.cwd}
                    formatWhen={formatWhen}
                  />
                </button>
                <button
                  type="button"
                  className={`cmd-history-copy${copied ? ' copied' : ''}`}
                  title={copied ? 'Copied' : 'Copy command'}
                  aria-label={copied ? 'Copied' : 'Copy command'}
                  onClick={(e) => copyCommand(entry, e)}
                >
                    {copied ? <LuCheck size={14} /> : <LuCopy size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
