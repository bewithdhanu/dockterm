import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalPane } from './TerminalPane.jsx';
import { TerminalFooter } from './TerminalFooter.jsx';

const MAX_PANES = 3;
const MIN_RATIO = 0.12;

function equalSizes(n) {
  return Array.from({ length: n }, () => 1 / n);
}

/**
 * Renders 1–3 terminal panes in a row (horizontal) or column (vertical),
 * with drag handles to resize.
 */
export function TerminalSplitView({
  tab,
  active,
  focusedPaneId,
  onFocusPane,
  onClosePane,
  send,
  connected,
  registerHandlers,
  registerStatsHandlers,
  registerSerializer,
  onPaneTitle,
  onPaneCwd,
}) {
  const panes = tab.panes || [];
  const direction = tab.direction || 'row';
  const showClose = panes.length > 1;
  const gridRef = useRef(null);
  const [sizes, setSizes] = useState(() => equalSizes(panes.length || 1));
  const dragRef = useRef(null);

  useEffect(() => {
    setSizes((prev) => {
      if (prev.length === panes.length) return prev;
      return equalSizes(panes.length || 1);
    });
  }, [panes.length]);

  const onPointerDown = useCallback(
    (index, e) => {
      e.preventDefault();
      e.stopPropagation();
      const grid = gridRef.current;
      if (!grid) return;

      const rect = grid.getBoundingClientRect();
      const total = direction === 'row' ? rect.width : rect.height;
      if (total <= 0) return;

      dragRef.current = {
        index,
        startPos: direction === 'row' ? e.clientX : e.clientY,
        startSizes: [...sizes],
        total,
      };

      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add(
        direction === 'row' ? 'split-dragging-col' : 'split-dragging-row'
      );
    },
    [direction, sizes]
  );

  const onPointerMove = useCallback(
    (e) => {
      const drag = dragRef.current;
      if (!drag) return;

      const pos = direction === 'row' ? e.clientX : e.clientY;
      const deltaRatio = (pos - drag.startPos) / drag.total;
      const i = drag.index;
      const next = [...drag.startSizes];
      const a = drag.startSizes[i];
      const b = drag.startSizes[i + 1];
      const pair = a + b;
      let newA = a + deltaRatio;
      newA = Math.max(MIN_RATIO, Math.min(pair - MIN_RATIO, newA));
      next[i] = newA;
      next[i + 1] = pair - newA;
      setSizes(next);
    },
    [direction]
  );

  const endDrag = useCallback((e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    document.body.classList.remove('split-dragging-col', 'split-dragging-row');
  }, []);

  const resetPair = useCallback((index) => {
    setSizes((prev) => {
      const next = [...prev];
      const pair = (next[index] || 0) + (next[index + 1] || 0);
      next[index] = pair / 2;
      next[index + 1] = pair / 2;
      return next;
    });
  }, []);

  const nodes = [];
  panes.forEach((pane, index) => {
    const focused = focusedPaneId === pane.id;
    nodes.push(
      <div
        key={pane.id}
        className={`split-pane ${focused ? 'focused' : ''}`}
        style={{ flexGrow: sizes[index] ?? 1, flexBasis: 0, flexShrink: 1 }}
        onMouseDown={() => onFocusPane(pane.id)}
      >
        {showClose && (
          <button
            type="button"
            className="split-pane-close"
            title="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              onClosePane?.(pane.id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            ×
          </button>
        )}
        <div className="split-pane-stack">
          <div className="split-pane-term">
            <TerminalPane
              id={pane.id}
              active={active && focused}
              visible={active}
              send={send}
              registerHandlers={registerHandlers}
              registerSerializer={registerSerializer}
              initialScrollback={pane.scrollback}
              isSsh={Boolean(pane.ssh || pane.kind === 'ssh')}
              sshStatus={pane.sshStatus || null}
              sshHost={pane.ssh || null}
              onTitle={(title) => onPaneTitle?.(pane.id, title)}
              onCwd={(cwd) => onPaneCwd?.(pane.id, cwd)}
              onClose={() => onClosePane?.(pane.id)}
            />
          </div>
          <TerminalFooter
            id={pane.id}
            send={send}
            registerStatsHandlers={registerStatsHandlers}
            connected={connected}
            alive={pane.alive !== false}
            sshStatus={pane.sshStatus || null}
            sshHost={pane.ssh || null}
          />
        </div>
      </div>
    );

    if (index < panes.length - 1) {
      nodes.push(
        <div
          key={`resizer-${pane.id}`}
          className={`split-resizer split-resizer-${
            direction === 'row' ? 'col' : 'row'
          }`}
          role="separator"
          aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
          title="Drag to resize · double-click to reset"
          onPointerDown={(e) => onPointerDown(index, e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => resetPair(index)}
        />
      );
    }
  });

  return (
    <div
      ref={gridRef}
      className={`split-grid split-${direction}${
        panes.length > 1 ? ' split-multi' : ''
      }`}
    >
      {nodes}
    </div>
  );
}

export { MAX_PANES };
