import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Truncate from the front with a leading "…" when width is tight.
 * Keeps LTR alignment (no RTL slash/bidi quirks).
 */
function LeadingEllipsisText({ text, title }) {
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const [display, setDisplay] = useState(text || '');

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    const value = String(text || '');
    if (!wrap || !measure) return undefined;

    const fit = () => {
      const max = wrap.clientWidth;
      if (max <= 0 || !value) {
        setDisplay(value);
        return;
      }

      measure.textContent = value;
      if (measure.offsetWidth <= max) {
        setDisplay(value);
        return;
      }

      let lo = 0;
      let hi = value.length;
      let best = '…';
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const candidate = `…${value.slice(value.length - mid)}`;
        measure.textContent = candidate;
        if (measure.offsetWidth <= max) {
          best = candidate;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setDisplay(best);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span className="cmd-history-meta-path" title={title || text} ref={wrapRef}>
      <span className="cmd-history-meta-path-visible">{display}</span>
      <span className="cmd-history-meta-path-measure" ref={measureRef} aria-hidden="true" />
    </span>
  );
}

/** Shared meta line for command history cards/rows. */
export function HistoryEntryMeta({ where, at, cwd, formatWhen }) {
  const host = where || 'Local';
  const when = formatWhen?.(at) || '';
  const path = cwd ? String(cwd) : '';

  return (
    <div className="cmd-history-meta-line">
      <span className="cmd-history-meta-host">{host}</span>
      {when ? (
        <>
          <span className="cmd-history-meta-sep" aria-hidden="true">
            ·
          </span>
          <span className="cmd-history-meta-when">{when}</span>
        </>
      ) : null}
      {path ? (
        <>
          <span className="cmd-history-meta-sep" aria-hidden="true">
            ·
          </span>
          <LeadingEllipsisText text={path} title={path} />
        </>
      ) : null}
    </div>
  );
}
