import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LuCheck, LuChevronDown, LuChevronLeft, LuChevronRight } from 'react-icons/lu';

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addDays(dayStart, n) {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return startOfLocalDay(d);
}

function sameDay(a, b) {
  if (a == null || b == null) return false;
  return startOfLocalDay(new Date(a)) === startOfLocalDay(new Date(b));
}

function formatDayLabel(at) {
  if (at == null) return 'All dates';
  const d = new Date(at);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const n = d.getDate();
  const v = n % 100;
  let ord = `${n}th`;
  if (v < 11 || v > 13) {
    if (n % 10 === 1) ord = `${n}st`;
    else if (n % 10 === 2) ord = `${n}nd`;
    else if (n % 10 === 3) ord = `${n}rd`;
  }
  return `${month} ${ord}`;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Searchable host filter combobox.
 * @param {{ value: string, onChange: (v: string) => void, hosts: string[] }} props
 */
export function SearchableHostFilter({ value = 'all', onChange, hosts = [] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = hosts.filter((h) =>
      needle ? h.toLowerCase().includes(needle) : true
    );
    const items = [{ value: 'all', label: 'All hosts' }];
    for (const h of list) items.push({ value: h, label: h });
    return items;
  }, [hosts, q]);

  const label = value === 'all' ? 'All hosts' : value;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  return (
    <div
      className={`hist-filter hist-host-filter ${open ? 'open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="hist-filter-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Filter by host"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hist-filter-value" title={label}>
          {label}
        </span>
        <LuChevronDown className="hist-filter-chevron" size={14} aria-hidden />
      </button>
      {open ? (
        <div className="hist-filter-menu hist-host-menu" role="presentation">
          <input
            ref={inputRef}
            className="hist-host-search"
            type="search"
            placeholder="Search hosts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && options[0]) {
                e.preventDefault();
                onChange?.(options[0].value);
                setOpen(false);
              }
            }}
          />
          <ul id={listId} className="hist-filter-list" role="listbox">
            {options.length === 0 ? (
              <li className="hist-filter-empty">No hosts</li>
            ) : (
              options.map((opt) => {
                const active = opt.value === value;
                return (
                  <li key={opt.value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`hist-filter-option ${active ? 'selected' : ''}`}
                      onClick={() => {
                        onChange?.(opt.value);
                        setOpen(false);
                      }}
                    >
                      <span className="hist-filter-option-label">{opt.label}</span>
                      {active ? <LuCheck size={14} aria-hidden /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Calendar day picker limited to the last 30 days (including today).
 * value: null = all dates, otherwise local day-start ms.
 */
export function HistoryDayCalendar({ value = null, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const today = startOfLocalDay();
  const minDay = addDays(today, -29); // last 30 days inclusive
  const [viewMonth, setViewMonth] = useState(() => {
    const base = value != null ? new Date(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const base = value != null ? new Date(value) : new Date();
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open, value]);

  const monthLabel = viewMonth.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const days = useMemo(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push(startOfLocalDay(new Date(y, m, d)));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewMonth]);

  const canPrev = (() => {
    const prev = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    const prevLast = startOfLocalDay(
      new Date(prev.getFullYear(), prev.getMonth() + 1, 0)
    );
    return prevLast >= minDay;
  })();

  const canNext = (() => {
    const next = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
    return startOfLocalDay(next) <= today;
  })();

  return (
    <div
      className={`hist-filter hist-date-filter ${open ? 'open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="hist-filter-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Filter by date"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hist-filter-value">{formatDayLabel(value)}</span>
        <LuChevronDown className="hist-filter-chevron" size={14} aria-hidden />
      </button>
      {open ? (
        <div className="hist-filter-menu hist-calendar" role="dialog">
          <div className="hist-cal-head">
            <button
              type="button"
              className="hist-cal-nav"
              disabled={!canPrev}
              aria-label="Previous month"
              onClick={() =>
                setViewMonth(
                  (cur) => new Date(cur.getFullYear(), cur.getMonth() - 1, 1)
                )
              }
            >
              <LuChevronLeft size={16} />
            </button>
            <div className="hist-cal-month">{monthLabel}</div>
            <button
              type="button"
              className="hist-cal-nav"
              disabled={!canNext}
              aria-label="Next month"
              onClick={() =>
                setViewMonth(
                  (cur) => new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
                )
              }
            >
              <LuChevronRight size={16} />
            </button>
          </div>
          <div className="hist-cal-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="hist-cal-grid">
            {days.map((day, i) => {
              if (day == null) {
                return <span key={`e-${i}`} className="hist-cal-day empty" />;
              }
              const disabled = day < minDay || day > today;
              const selected = sameDay(day, value);
              const isToday = sameDay(day, today);
              return (
                <button
                  key={day}
                  type="button"
                  className={`hist-cal-day${selected ? ' selected' : ''}${
                    isToday ? ' today' : ''
                  }`}
                  disabled={disabled}
                  onClick={() => {
                    onChange?.(day);
                    setOpen(false);
                  }}
                >
                  {new Date(day).getDate()}
                </button>
              );
            })}
          </div>
          <div className="hist-cal-footer">
            <button
              type="button"
              className="hist-cal-clear"
              onClick={() => {
                onChange?.(null);
                setOpen(false);
              }}
            >
              All dates
            </button>
            <button
              type="button"
              className="hist-cal-clear"
              onClick={() => {
                onChange?.(today);
                setOpen(false);
              }}
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
