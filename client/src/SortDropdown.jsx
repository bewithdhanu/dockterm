import { useEffect, useId, useRef, useState } from 'react';
import { LuCheck, LuChevronDown } from 'react-icons/lu';

export const HOST_SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'recent', label: 'Recent' },
];

/**
 * Custom sort dropdown (replaces native <select>).
 */
export function SortDropdown({
  value,
  onChange,
  options = HOST_SORT_OPTIONS,
  label = 'Sort',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const selected =
    options.find((o) => o.value === value) || options[0] || { label: 'Sort' };

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

  return (
    <div
      className={`sort-dropdown ${open ? 'open' : ''} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className="sort-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sort-dropdown-value">{selected.label}</span>
        <LuChevronDown
          className="sort-dropdown-chevron"
          size={14}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ul
          id={listId}
          className="sort-dropdown-menu"
          role="listbox"
          aria-label={label}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`sort-dropdown-option ${active ? 'selected' : ''}`}
                  onClick={() => {
                    onChange?.(opt.value);
                    setOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                  {active ? (
                    <LuCheck size={14} aria-hidden="true" />
                  ) : (
                    <span className="sort-dropdown-check-spacer" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
