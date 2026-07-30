import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Chrome-style floating tab context menu.
 * items: [{ id, label, disabled?, danger?, separator? }]
 */
export function TabContextMenu({ x, y, items, onAction, onClose }) {
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, items]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      className="ctx-menu"
      ref={menuRef}
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ctx-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                onAction(item.id);
                onClose();
              }
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span className="ctx-shortcut">{item.shortcut}</span>
            ) : null}
          </button>
        )
      )}
    </div>
  );
}
