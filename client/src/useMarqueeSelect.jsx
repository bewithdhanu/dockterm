import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Marquee multi-select over cards inside a scrollable container.
 * Drag on blank space to select cards (not text).
 */
export function useMarqueeSelect({
  containerRef,
  itemSelector = '[data-select-id]',
  enabled = true,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [box, setBox] = useState(null);
  const dragRef = useRef(null);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectOnly = useCallback((id) => {
    setSelectedIds(new Set(id ? [id] : []));
  }, []);

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const root = containerRef.current;
    if (!root) return undefined;

    const onDown = (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (
        t.closest('button') ||
        t.closest('input') ||
        t.closest('textarea') ||
        t.closest('select') ||
        t.closest('a') ||
        t.closest('[data-no-marquee]')
      ) {
        return;
      }
      if (t.closest(itemSelector)) return;

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      dragRef.current = {
        startX,
        startY,
        base: additive ? new Set(selectedRef.current) : new Set(),
      };
      if (!additive) setSelectedIds(new Set());
      setBox({ left: startX, top: startY, width: 0, height: 0 });
    };

    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const left = Math.min(drag.startX, e.clientX);
      const top = Math.min(drag.startY, e.clientY);
      const width = Math.abs(e.clientX - drag.startX);
      const height = Math.abs(e.clientY - drag.startY);
      setBox({ left, top, width, height });

      const marquee = {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
      const hit = new Set(drag.base);
      root.querySelectorAll(itemSelector).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const id = node.dataset.selectId;
        if (!id) return;
        const r = node.getBoundingClientRect();
        const overlaps =
          r.left < marquee.right &&
          r.right > marquee.left &&
          r.top < marquee.bottom &&
          r.bottom > marquee.top;
        if (overlaps) hit.add(id);
      });
      setSelectedIds(hit);
    };

    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setBox(null);
    };

    root.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      root.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [containerRef, enabled, itemSelector]);

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    selectOnly,
    toggle,
    box,
  };
}

export function MarqueeBox({ box }) {
  if (!box || (box.width < 2 && box.height < 2)) return null;
  return (
    <div
      className="marquee-box"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    />
  );
}
