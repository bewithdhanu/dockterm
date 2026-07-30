import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TitleBar } from './TitleBar.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';
import { SshSidebar } from './SshSidebar.jsx';
import { SnippetsPanel } from './SnippetsPanel.jsx';
import { ConfigEditorPane } from './ConfigEditorPane.jsx';
import { MAX_PANES, TerminalSplitView } from './TerminalSplitView.jsx';
import { loadSession, saveSession } from './sessionPersist.js';
import { endsWithShellPrompt } from './shellPrompt.js';

const SSH_CONFIG_TAB_ID = 'editor:ssh-config';
const SNIPPETS_COLLAPSED_KEY = 'web-terminal.snippets-collapsed';

function readSnippetsCollapsed() {
  return localStorage.getItem(SNIPPETS_COLLAPSED_KEY) === '1';
}

function nextTitle(tabs) {
  const terminalCount = tabs.filter((t) => t.kind === 'terminal').length;
  return `Terminal ${terminalCount + 1}`;
}

function groupId() {
  return `group-${crypto.randomUUID()}`;
}

function newClientKey() {
  return `ck-${crypto.randomUUID()}`;
}

export default function App() {
  const wsRef = useRef(null);
  const bootstrapped = useRef(false);
  const resumeLockRef = useRef(false);
  /** Pending pane recreates from bootstrap/resume; blocks stacked reconnects. */
  const restorePendingRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const handlersRef = useRef(new Map());
  const statsHandlersRef = useRef(new Map());
  const serializersRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  /** @type {React.MutableRefObject<Map<string, any>>} */
  const pendingByKeyRef = useRef(new Map());
  const closedStackRef = useRef([]);
  /** Rolling SSH output used to detect first shell prompt (connecting → connected). */
  const sshPromptBufRef = useRef(new Map());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const closePaneRef = useRef(null);
  const sidebarCollapsedRef = useRef(false);

  const [ctxMenu, setCtxMenu] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const [snippetsCollapsed, setSnippetsCollapsed] = useState(readSnippetsCollapsed);
  const [dragTabId, setDragTabId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, zone: 'right'|'bottom' }

  const registerHandlers = useCallback((id, handlers) => {
    handlersRef.current.set(id, handlers);
    const pending = pendingRef.current.get(id);
    if (pending?.length) {
      for (const chunk of pending) handlers.onOutput?.(chunk);
      pendingRef.current.delete(id);
    }
    return () => {
      handlersRef.current.delete(id);
    };
  }, []);

  const registerStatsHandlers = useCallback((id, handlers) => {
    statsHandlersRef.current.set(id, handlers);
    return () => {
      statsHandlersRef.current.delete(id);
    };
  }, []);

  const registerSerializer = useCallback((id, fn) => {
    serializersRef.current.set(id, fn);
    return () => {
      serializersRef.current.delete(id);
    };
  }, []);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const requestCreate = useCallback(
    (meta, payload) => {
      const clientKey = newClientKey();
      pendingByKeyRef.current.set(clientKey, meta || {});
      send({ ...payload, clientKey });
      return clientKey;
    },
    [send]
  );

  const persistSession = useCallback(() => {
    const currentTabs = tabsRef.current;
    if (!currentTabs.length) return;
    const snapshot = {
      version: 1,
      savedAt: Date.now(),
      activeId: activeIdRef.current,
      sidebarCollapsed: sidebarCollapsedRef.current,
      tabs: currentTabs.map((t) => {
        if (t.kind === 'editor') {
          return { id: t.id, title: t.title, kind: 'editor' };
        }
        const focusIdx = Math.max(
          0,
          t.panes.findIndex((p) => p.id === t.focusedPaneId)
        );
        return {
          id: t.id,
          title: t.title,
          kind: 'terminal',
          direction: t.direction || 'row',
          focusedPaneIndex: focusIdx,
          panes: (t.panes || [])
            .filter(Boolean)
            .map((p) => ({
              ssh: p.ssh || null,
              cwd: p.cwd || null,
              kind: p.kind || (p.ssh ? 'ssh' : 'shell'),
              scrollback: serializersRef.current.get(p.id)?.() || '',
            })),
        };
      }),
    };
    saveSession(snapshot);
  }, []);

  const closePty = useCallback(
    (ptyId) => {
      send({ type: 'close', id: ptyId });
      pendingRef.current.delete(ptyId);
    },
    [send]
  );

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = import.meta.env.DEV
      ? `${proto}://${location.hostname}:3001/ws`
      : `${proto}://${location.host}/ws`;

    let closed = false;
    let retryTimer;

    const bootstrapFromSnapshot = (ws, snap) => {
      if (typeof snap.sidebarCollapsed === 'boolean') {
        setSidebarCollapsed(snap.sidebarCollapsed);
      }

      let createCount = 0;
      const seeded = [];
      for (const t of snap.tabs || []) {
        if (t.kind === 'editor') {
          seeded.push({
            id: t.id || SSH_CONFIG_TAB_ID,
            title: t.title || '~/.ssh/config',
            kind: 'editor',
          });
          continue;
        }

        const tabId = t.id || groupId();
        const paneMetas = Array.isArray(t.panes) ? t.panes : [];
        seeded.push({
          id: tabId,
          title: t.title || 'Terminal',
          kind: 'terminal',
          direction: t.direction === 'column' ? 'column' : 'row',
          panes: [],
          focusedPaneId: null,
          _restoreExpected: Math.max(1, paneMetas.length),
          _restoreFocusIndex: t.focusedPaneIndex ?? 0,
          _restoreSlots: Array(Math.max(1, paneMetas.length)).fill(null),
        });

        if (!paneMetas.length) {
          createCount += 1;
          const clientKey = newClientKey();
          pendingByKeyRef.current.set(clientKey, {
            restore: {
              tabId,
              paneIndex: 0,
              scrollback: '',
              ssh: null,
              cwd: null,
            },
            title: t.title,
          });
          ws.send(
            JSON.stringify({
              type: 'create',
              clientKey,
              cols: 80,
              rows: 24,
              title: t.title,
            })
          );
          continue;
        }

        paneMetas.forEach((p, paneIndex) => {
          createCount += 1;
          const clientKey = newClientKey();
          pendingByKeyRef.current.set(clientKey, {
            restore: {
              tabId,
              paneIndex,
              scrollback: p.scrollback || '',
              ssh: p.ssh || null,
              cwd: p.cwd || null,
            },
            title: t.title,
            ssh: p.ssh || undefined,
            cwd: p.cwd || undefined,
          });
          ws.send(
            JSON.stringify({
              type: 'create',
              clientKey,
              cols: p.cols || 80,
              rows: p.rows || 24,
              title: t.title,
              ssh: p.ssh || undefined,
              cwd: p.cwd || undefined,
              remoteCwd: p.ssh ? p.cwd || undefined : undefined,
            })
          );
        });
      }

      if (!seeded.length) {
        const clientKey = newClientKey();
        pendingByKeyRef.current.set(clientKey, { title: 'Terminal 1' });
        ws.send(
          JSON.stringify({
            type: 'create',
            clientKey,
            cols: 80,
            rows: 24,
            title: 'Terminal 1',
          })
        );
        return;
      }

      restorePendingRef.current = createCount;
      resumeLockRef.current = createCount > 0;
      if (createCount > 0) {
        setTimeout(() => {
          if (resumeLockRef.current) {
            resumeLockRef.current = false;
            restorePendingRef.current = 0;
          }
        }, 15000);
      }

      setTabs(seeded);
      const active =
        seeded.find((t) => t.id === snap.activeId)?.id || seeded[0]?.id || null;
      setActiveId(active);
    };

    const resumeAfterReconnect = (ws) => {
      const current = tabsRef.current;
      const hasTerminals = current.some(
        (t) => t.kind === 'terminal' && (t.panes?.length || 0) > 0
      );
      if (!hasTerminals) return;
      if (restorePendingRef.current > 0 || resumeLockRef.current) return;

      resumeLockRef.current = true;
      let createCount = 0;

      const next = current.map((t) => {
        if (t.kind !== 'terminal' || !t.panes?.length) return t;
        return {
          ...t,
          panes: [],
          focusedPaneId: null,
          _restoreExpected: t.panes.length,
          _restoreFocusIndex: Math.max(
            0,
            t.panes.findIndex((p) => p.id === t.focusedPaneId)
          ),
          _restoreSlots: Array(t.panes.length).fill(null),
          _resumePanes: t.panes.map((p) => ({
            ssh: p.ssh || null,
            cwd: p.cwd || null,
            kind: p.kind,
            scrollback: serializersRef.current.get(p.id)?.() || '',
          })),
        };
      });
      setTabs(next);

      for (const t of next) {
        if (t.kind !== 'terminal' || !t._resumePanes) continue;
        t._resumePanes.forEach((p, paneIndex) => {
          createCount += 1;
          const clientKey = newClientKey();
          pendingByKeyRef.current.set(clientKey, {
            restore: {
              tabId: t.id,
              paneIndex,
              scrollback: p.scrollback || '',
              ssh: p.ssh || null,
              cwd: p.cwd || null,
            },
            title: t.title,
            ssh: p.ssh || undefined,
            cwd: p.cwd || undefined,
          });
          ws.send(
            JSON.stringify({
              type: 'create',
              clientKey,
              cols: 80,
              rows: 24,
              title: t.title,
              ssh: p.ssh || undefined,
              cwd: p.cwd || undefined,
              remoteCwd: p.ssh ? p.cwd || undefined : undefined,
            })
          );
        });
      }

      restorePendingRef.current = createCount;
      // Safety unlock if creates never complete.
      setTimeout(() => {
        if (resumeLockRef.current) {
          resumeLockRef.current = false;
          restorePendingRef.current = 0;
        }
      }, 15000);
    };

    const connect = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        setConnected(true);
        if (!bootstrapped.current) {
          bootstrapped.current = true;
          const snap = loadSession();
          if (snap?.tabs?.length) bootstrapFromSnapshot(ws, snap);
          else {
            const clientKey = newClientKey();
            pendingByKeyRef.current.set(clientKey, { title: 'Terminal 1' });
            ws.send(
              JSON.stringify({
                type: 'create',
                clientKey,
                cols: 80,
                rows: 24,
                title: 'Terminal 1',
              })
            );
          }
        } else {
          // Recreate PTYs after server dropped them; skip if restore already in flight.
          resumeAfterReconnect(ws);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closed) retryTimer = setTimeout(connect, 1200);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        if (msg.type === 'created') {
          pendingRef.current.set(msg.id, []);
          const pending =
            (msg.clientKey && pendingByKeyRef.current.get(msg.clientKey)) ||
            null;
          if (msg.clientKey) pendingByKeyRef.current.delete(msg.clientKey);

          const isSsh = Boolean(
            msg.sshHost || pending?.ssh || pending?.restore?.ssh
          );
          const pane = {
            id: msg.id,
            alive: true,
            ssh: msg.sshHost || pending?.ssh || pending?.restore?.ssh || null,
            kind:
              msg.kind ||
              (pending?.ssh || pending?.restore?.ssh ? 'ssh' : 'shell'),
            cwd: msg.cwd || pending?.cwd || pending?.restore?.cwd || null,
            scrollback: pending?.restore?.scrollback || '',
            sshStatus: isSsh ? 'connecting' : null,
          };

          if (pending?.restore?.tabId) {
            const { tabId, paneIndex } = pending.restore;
            if (restorePendingRef.current > 0) {
              restorePendingRef.current -= 1;
              if (restorePendingRef.current <= 0) {
                restorePendingRef.current = 0;
                resumeLockRef.current = false;
              }
            }
            setTabs((prev) =>
              prev.map((t) => {
                if (t.id !== tabId || t.kind !== 'terminal') return t;
                const expected = t._restoreExpected || 1;
                const slots = [
                  ...(t._restoreSlots || Array(expected).fill(null)),
                ];
                while (slots.length < expected) slots.push(null);
                slots[paneIndex] = pane;
                const complete = slots.every(Boolean);
                if (!complete) {
                  return { ...t, _restoreSlots: slots };
                }
                const focusIdx = Math.min(
                  t._restoreFocusIndex ?? 0,
                  slots.length - 1
                );
                return {
                  id: t.id,
                  title: t.title,
                  kind: 'terminal',
                  direction: t.direction || 'row',
                  panes: slots,
                  focusedPaneId: slots[focusIdx]?.id || slots[0]?.id,
                };
              })
            );
            setTimeout(() => {
              setTabs((prev) =>
                prev.map((t) => {
                  if (t.id !== tabId || t.kind !== 'terminal') return t;
                  return {
                    ...t,
                    panes: t.panes.map((p) =>
                      p?.scrollback ? { ...p, scrollback: '' } : p
                    ),
                  };
                })
              );
            }, 2500);
            return;
          }

          if (pending?.split?.groupId) {
            const { groupId: gid, direction } = pending.split;
            setTabs((prev) =>
              prev.map((t) => {
                if (t.id !== gid || t.kind !== 'terminal') return t;
                if (t.panes.length >= MAX_PANES) return t;
                return {
                  ...t,
                  direction,
                  panes: [...t.panes, { ...pane, scrollback: '' }],
                  focusedPaneId: msg.id,
                };
              })
            );
            setActiveId(gid);
            return;
          }

          const title = pending?.title || msg.title || 'Terminal';
          const tab = {
            id: groupId(),
            title,
            kind: 'terminal',
            direction: 'row',
            panes: [{ ...pane, scrollback: '' }],
            focusedPaneId: msg.id,
          };

          setTabs((prev) => {
            if (pending?.afterId) {
              const idx = prev.findIndex((t) => t.id === pending.afterId);
              if (idx >= 0) {
                const next = [...prev];
                next.splice(idx + 1, 0, tab);
                return next;
              }
            }
            if (!pending?.title && !msg.title) {
              tab.title = nextTitle(prev);
            }
            return [...prev, tab];
          });
          setActiveId(tab.id);
          return;
        }

        if (msg.type === 'error') {
          console.error('PTY error:', msg.message);
          alert(msg.message || 'Failed to create terminal');
          return;
        }

        if (msg.type === 'output') {
          const h = handlersRef.current.get(msg.id);
          if (h?.onOutput) h.onOutput(msg.data);
          else {
            const buf = pendingRef.current.get(msg.id);
            if (buf) buf.push(msg.data);
            else pendingRef.current.set(msg.id, [msg.data]);
          }

          // Promote SSH connecting → connected once a shell prompt appears.
          const owner = tabsRef.current.find(
            (t) =>
              t.kind === 'terminal' && t.panes?.some((p) => p.id === msg.id)
          );
          const pane = owner?.panes?.find((p) => p.id === msg.id);
          if (
            pane?.ssh &&
            pane.sshStatus === 'connecting' &&
            pane.alive !== false
          ) {
            const prev = sshPromptBufRef.current.get(msg.id) || '';
            const next = (prev + String(msg.data || '')).slice(-8000);
            sshPromptBufRef.current.set(msg.id, next);
            if (endsWithShellPrompt(next)) {
              sshPromptBufRef.current.delete(msg.id);
              setTabs((prevTabs) =>
                prevTabs.map((t) => {
                  if (t.kind !== 'terminal') return t;
                  if (!t.panes?.some((p) => p.id === msg.id)) return t;
                  return {
                    ...t,
                    panes: t.panes.map((p) =>
                      p.id === msg.id && p.sshStatus === 'connecting'
                        ? { ...p, sshStatus: 'connected' }
                        : p
                    ),
                  };
                })
              );
            }
          }
          return;
        }

        if (msg.type === 'exit') {
          handlersRef.current.get(msg.id)?.onExit?.(msg.exitCode);
          sshPromptBufRef.current.delete(msg.id);

          // Keep SSH tabs open on failure/disconnect so errors remain visible.
          setTabs((prev) =>
            prev.map((t) => {
              if (t.kind !== 'terminal') return t;
              if (!t.panes?.some((p) => p.id === msg.id)) return t;
              return {
                ...t,
                panes: t.panes.map((p) =>
                  p.id === msg.id
                    ? {
                        ...p,
                        alive: false,
                        sshStatus: p.ssh || p.kind === 'ssh' ? 'error' : null,
                      }
                    : p
                ),
              };
            })
          );
          return;
        }

        if (msg.type === 'stats') {
          statsHandlersRef.current.get(msg.id)?.onStats?.(msg);
          return;
        }

        if (msg.type === 'kill-result') {
          statsHandlersRef.current.get(msg.id)?.onKillResult?.(msg);
          return;
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  const addTab = useCallback(
    (opts = {}) => {
      requestCreate(
        {
          afterId: opts.afterId,
          title: opts.title,
          ssh: opts.ssh,
          cwd: opts.cwd,
        },
        {
          type: 'create',
          cols: 80,
          rows: 24,
          title: opts.title,
          ssh: opts.ssh || undefined,
          cwd: opts.cwd || undefined,
          remoteCwd: opts.ssh ? opts.cwd || undefined : undefined,
        }
      );
    },
    [requestCreate]
  );

  const splitActive = useCallback(
    (direction, groupIdArg) => {
      const gid = groupIdArg ?? activeId;
      const tab = tabsRef.current.find((t) => t.id === gid);
      if (!tab || tab.kind !== 'terminal') return;
      if (tab.panes.length >= MAX_PANES) return;

      const focusId = tab.focusedPaneId || tab.panes[0]?.id;
      const focusPane = tab.panes.find((p) => p.id === focusId) || tab.panes[0];

      setActiveId(tab.id);
      requestCreate(
        {
          split: { groupId: tab.id, direction },
          ssh: focusPane?.ssh || undefined,
          cwd: focusPane?.cwd || undefined,
        },
        {
          type: 'create',
          cols: 80,
          rows: 24,
          cloneFrom: focusPane?.id,
          ssh: focusPane?.ssh || undefined,
          cwd: focusPane?.cwd || undefined,
          remoteCwd: focusPane?.ssh ? focusPane?.cwd || undefined : undefined,
        }
      );
    },
    [activeId, requestCreate]
  );

  /** Merge all panes from sourceTab into targetTab (no PTY kill). */
  const mergeTabs = useCallback((sourceId, targetId, direction) => {
    if (sourceId === targetId) return;
    setTabs((prev) => {
      const source = prev.find((t) => t.id === sourceId);
      const target = prev.find((t) => t.id === targetId);
      if (!source || !target) return prev;
      if (source.kind !== 'terminal' || target.kind !== 'terminal') return prev;

      const room = MAX_PANES - target.panes.length;
      if (room <= 0) {
        queueMicrotask(() =>
          alert('This tab already has the maximum of 3 panes.')
        );
        return prev;
      }

      const moving = source.panes.slice(0, room);
      const leftover = source.panes.slice(room);
      if (leftover.length) {
        queueMicrotask(() =>
          alert(
            `Only ${room} pane(s) could be merged (max 3). Remaining stay in the other tab.`
          )
        );
      }

      return prev
        .map((t) => {
          if (t.id === targetId) {
            return {
              ...t,
              direction: direction || t.direction || 'row',
              panes: [...t.panes, ...moving],
              focusedPaneId: moving[moving.length - 1]?.id || t.focusedPaneId,
            };
          }
          if (t.id === sourceId) {
            if (leftover.length === 0) return null;
            return {
              ...t,
              panes: leftover,
              focusedPaneId: leftover[0]?.id,
            };
          }
          return t;
        })
        .filter(Boolean);
    });
    setActiveId(targetId);
  }, []);

  const updatePaneCwd = useCallback((groupId, paneId, cwd) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== groupId || t.kind !== 'terminal') return t;
        return {
          ...t,
          panes: t.panes.map((p) => {
            if (p.id !== paneId) return p;
            const next = { ...p, cwd };
            // Remote OSC 7 means the shell is up — treat as connected.
            if (p.ssh && p.sshStatus === 'connecting' && p.alive !== false) {
              next.sshStatus = 'connected';
              sshPromptBufRef.current.delete(paneId);
            }
            return next;
          }),
        };
      })
    );
  }, []);


  const openConfigEditor = useCallback(() => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === SSH_CONFIG_TAB_ID);
      if (existing) return prev;
      return [
        ...prev,
        { id: SSH_CONFIG_TAB_ID, title: '~/.ssh/config', kind: 'editor' },
      ];
    });
    setActiveId(SSH_CONFIG_TAB_ID);
  }, []);

  const closeTabsByIds = useCallback(
    (ids) => {
      if (!ids.length) return;
      const idSet = new Set(ids);

      setTabs((prev) => {
        const closing = prev.filter((t) => idSet.has(t.id));
        for (const t of closing) {
          closedStackRef.current.push({ title: t.title, kind: t.kind });
          if (t.kind === 'terminal') {
            for (const pane of t.panes || []) closePty(pane.id);
          }
        }
        if (closedStackRef.current.length > 20) {
          closedStackRef.current = closedStackRef.current.slice(-20);
        }

        const next = prev.filter((t) => !idSet.has(t.id));
        setActiveId((cur) => {
          if (!idSet.has(cur)) return cur;
          const firstIdx = prev.findIndex((t) => idSet.has(t.id));
          const right = prev.slice(firstIdx + 1).find((t) => !idSet.has(t.id));
          if (right) return right.id;
          const left = [...prev.slice(0, firstIdx)]
            .reverse()
            .find((t) => !idSet.has(t.id));
          return left?.id ?? next[next.length - 1]?.id ?? null;
        });
        return next;
      });
    },
    [closePty]
  );

  const closePane = useCallback(
    (groupId, paneId) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === groupId);
        if (!tab || tab.kind !== 'terminal') return prev;

        if (tab.panes.length <= 1) {
          // Close whole tab
          queueMicrotask(() => closeTabsByIds([groupId]));
          return prev;
        }

        closePty(paneId);
        return prev.map((t) => {
          if (t.id !== groupId) return t;
          const panes = t.panes.filter((p) => p.id !== paneId);
          const focusedPaneId =
            t.focusedPaneId === paneId
              ? panes[panes.length - 1]?.id
              : t.focusedPaneId;
          return { ...t, panes, focusedPaneId };
        });
      });
    },
    [closePty, closeTabsByIds]
  );
  closePaneRef.current = closePane;


  const closeTab = useCallback(
    (id, e) => {
      e?.stopPropagation();
      closeTabsByIds([id]);
    },
    [closeTabsByIds]
  );

  /** Cmd+W: close focused pane if split, otherwise close tab */
  const closeFocused = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeId);
    if (!tab) return;
    if (tab.kind === 'terminal' && tab.panes?.length > 1 && tab.focusedPaneId) {
      closePane(tab.id, tab.focusedPaneId);
      return;
    }
    closeTabsByIds([tab.id]);
  }, [activeId, closePane, closeTabsByIds]);

  const renameTab = useCallback((id, title) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id && t.title !== title ? { ...t, title } : t))
    );
  }, []);

  const focusPane = useCallback((groupId, paneId) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === groupId && t.kind === 'terminal'
          ? { ...t, focusedPaneId: paneId }
          : t
      )
    );
  }, []);

  const setSplitDirection = useCallback((groupId, direction) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === groupId && t.kind === 'terminal' && t.panes?.length > 1
          ? { ...t, direction }
          : t
      )
    );
  }, []);

  const moveTab = useCallback((id, direction) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  const openCtxMenu = (e, tabId = null) => {
    e.preventDefault();
    e.stopPropagation();
    if (tabId) setActiveId(tabId);
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const ctxItems = useMemo(() => {
    if (!ctxMenu) return [];
    const canReopen = closedStackRef.current.length > 0;

    if (!ctxMenu.tabId) {
      return [
        { id: 'new', label: 'New tab', shortcut: '⌘T' },
        {
          id: 'reopen',
          label: 'Reopen closed tab',
          shortcut: '⇧⌘T',
          disabled: !canReopen,
        },
        { separator: true },
        {
          id: 'close-all',
          label: 'Close all tabs',
          disabled: tabs.length === 0,
          danger: true,
        },
      ];
    }

    const idx = tabs.findIndex((t) => t.id === ctxMenu.tabId);
    if (idx < 0) return [];
    const tab = tabs[idx];
    const hasLeft = idx > 0;
    const hasRight = idx < tabs.length - 1;
    const hasOthers = tabs.length > 1;
    const isEditor = tab.kind === 'editor';
    const canSplit =
      tab.kind === 'terminal' && (tab.panes?.length || 0) < MAX_PANES;
    const isSplit =
      tab.kind === 'terminal' && (tab.panes?.length || 0) > 1;
    const dir = tab.direction || 'row';

    return [
      { id: 'new', label: 'New tab', shortcut: '⌘T' },
      { id: 'new-right', label: 'New tab to the right' },
      { id: 'duplicate', label: 'Duplicate tab', disabled: isEditor },
      { separator: true },
      {
        id: 'split-right',
        label: 'Split Right (same state)',
        shortcut: '⌘\\',
        disabled: !canSplit || isEditor,
      },
      {
        id: 'split-down',
        label: 'Split Down (same state)',
        shortcut: '⇧⌘\\',
        disabled: !canSplit || isEditor,
      },
      {
        id: 'layout-horizontal',
        label: 'Arrange Horizontally',
        disabled: !isSplit || dir === 'row',
      },
      {
        id: 'layout-vertical',
        label: 'Arrange Vertically',
        disabled: !isSplit || dir === 'column',
      },
      { separator: true },
      { id: 'rename', label: 'Rename…', disabled: isEditor },
      { id: 'move-left', label: 'Move left', disabled: !hasLeft },
      { id: 'move-right', label: 'Move right', disabled: !hasRight },
      { separator: true },
      { id: 'close', label: 'Close', shortcut: '⌘W', danger: true },
      {
        id: 'close-others',
        label: 'Close other tabs',
        disabled: !hasOthers,
      },
      {
        id: 'close-right',
        label: 'Close tabs to the right',
        disabled: !hasRight,
      },
      {
        id: 'close-left',
        label: 'Close tabs to the left',
        disabled: !hasLeft,
      },
      { separator: true },
      {
        id: 'reopen',
        label: 'Reopen closed tab',
        shortcut: '⇧⌘T',
        disabled: !canReopen,
      },
    ];
  }, [ctxMenu, tabs]);

  const onCtxAction = useCallback(
    (actionId) => {
      if (!ctxMenu) return;
      const tabId = ctxMenu.tabId;

      if (actionId === 'new') {
        addTab();
        return;
      }
      if (actionId === 'reopen') {
        const last = closedStackRef.current.pop();
        if (!last) return;
        if (last.kind === 'editor') openConfigEditor();
        else addTab({ title: last.title });
        return;
      }
      if (actionId === 'close-all') {
        closeTabsByIds(tabs.map((t) => t.id));
        return;
      }

      const idx = tabs.findIndex((t) => t.id === tabId);
      const tab = tabs[idx];
      if (!tab) return;

      switch (actionId) {
        case 'new-right':
          addTab({ afterId: tabId });
          break;
        case 'duplicate': {
          if (tab.kind === 'editor') break;
          const focus =
            tab.panes.find((p) => p.id === tab.focusedPaneId) || tab.panes[0];
          const title = tab.title.startsWith('Copy of ')
            ? tab.title
            : `Copy of ${tab.title}`;
          requestCreate(
            {
              afterId: tabId,
              title,
              ssh: focus?.ssh || undefined,
              cwd: focus?.cwd || undefined,
            },
            {
              type: 'create',
              cols: 80,
              rows: 24,
              title,
              cloneFrom: focus?.id,
              ssh: focus?.ssh || undefined,
              cwd: focus?.cwd || undefined,
              remoteCwd: focus?.ssh ? focus?.cwd || undefined : undefined,
            }
          );
          break;
        }
        case 'split-right':
          splitActive('row', tabId);
          break;
        case 'split-down':
          splitActive('column', tabId);
          break;
        case 'layout-horizontal':
          setSplitDirection(tabId, 'row');
          break;
        case 'layout-vertical':
          setSplitDirection(tabId, 'column');
          break;
        case 'rename': {
          const name = prompt('Tab name', tab.title);
          if (name?.trim()) renameTab(tabId, name.trim());
          break;
        }
        case 'move-left':
          moveTab(tabId, -1);
          break;
        case 'move-right':
          moveTab(tabId, 1);
          break;
        case 'close':
          closeTabsByIds([tabId]);
          break;
        case 'close-others':
          closeTabsByIds(tabs.filter((t) => t.id !== tabId).map((t) => t.id));
          break;
        case 'close-right':
          closeTabsByIds(tabs.slice(idx + 1).map((t) => t.id));
          break;
        case 'close-left':
          closeTabsByIds(tabs.slice(0, idx).map((t) => t.id));
          break;
        default:
          break;
      }
    },
    [
      ctxMenu,
      tabs,
      addTab,
      renameTab,
      moveTab,
      closeTabsByIds,
      openConfigEditor,
      splitActive,
      setSplitDirection,
      requestCreate,
    ]
  );

  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === 't' && !e.shiftKey) {
        e.preventDefault();
        addTab();
      } else if (e.key === 'w') {
        e.preventDefault();
        closeFocused();
      } else if (e.key === 't' && e.shiftKey) {
        e.preventDefault();
        const last = closedStackRef.current.pop();
        if (!last) return;
        if (last.kind === 'editor') openConfigEditor();
        else addTab({ title: last.title });
      } else if (e.key === '\\' && !e.shiftKey) {
        e.preventDefault();
        splitActive('row');
      } else if (e.key === '\\' && e.shiftKey) {
        e.preventDefault();
        splitActive('column');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addTab, closeFocused, openConfigEditor, splitActive]);

  // Persist session layout, connections, and terminal scrollback.
  useEffect(() => {
    const onSave = () => persistSession();
    const timer = setInterval(onSave, 4000);
    window.addEventListener('beforeunload', onSave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onSave();
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', onSave);
      onSave();
    };
  }, [persistSession]);

  // Block browser context menu everywhere except tab bar (custom) and terminals.
  useEffect(() => {
    const onContextMenu = (e) => {
      const el = e.target;
      if (!(el instanceof Element)) {
        e.preventDefault();
        return;
      }
      if (
        el.closest('.tabbar') ||
        el.closest('.sidebar') ||
        el.closest('.snippets-panel') ||
        el.closest('.ctx-menu') ||
        el.closest('.terminal-host') ||
        el.closest('.xterm')
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    return () =>
      document.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  const connectSsh = useCallback(
    (host) => {
      addTab({ title: host.alias, ssh: host.alias });
    },
    [addTab]
  );

  const runSnippet = useCallback(
    (snippet) => {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (!tab || tab.kind !== 'terminal') {
        alert('Open a terminal tab first');
        return;
      }
      const pane =
        tab.panes?.find((p) => p.id === tab.focusedPaneId) || tab.panes?.[0];
      if (!pane?.id || pane.alive === false) {
        alert('No active terminal pane');
        return;
      }
      let data = String(snippet.command || '').replace(/\r\n/g, '\n');
      if (!data.trim()) return;
      if (!data.endsWith('\n')) data += '\n';
      send({ type: 'input', id: pane.id, data });
    },
    [send]
  );

  const toggleSnippetsCollapsed = useCallback(() => {
    setSnippetsCollapsed((v) => {
      const next = !v;
      localStorage.setItem(SNIPPETS_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) || null,
    [tabs, activeId]
  );
  const showSnippets = activeTab?.kind === 'terminal';

  const sshHostStatuses = useMemo(() => {
    /** @type {Map<string, 'connecting' | 'connected'>} */
    const map = new Map();
    for (const t of tabs) {
      if (t.kind !== 'terminal') continue;
      for (const p of t.panes || []) {
        if (!p?.ssh || p.alive === false) continue;
        const cur = map.get(p.ssh);
        if (p.sshStatus === 'connecting') {
          map.set(p.ssh, 'connecting');
        } else if (
          (p.sshStatus === 'connected' || !p.sshStatus) &&
          cur !== 'connecting'
        ) {
          // Legacy panes without sshStatus still count as connected if alive.
          map.set(p.ssh, 'connected');
        }
      }
    }
    return map;
  }, [tabs]);

  return (
    <div className="app">
      <TitleBar />
      <div className="workspace">
        <SshSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          onConnect={connectSsh}
          onOpenConfig={openConfigEditor}
          hostStatuses={sshHostStatuses}
        />

        <div className="main-col">
          <div className="tabbar" onContextMenu={(e) => openCtxMenu(e, null)}>
            <div className="tabs" onContextMenu={(e) => openCtxMenu(e, null)}>
              {tabs.map((tab) => {
                const isDrop =
                  dropTarget?.id === tab.id &&
                  dragTabId &&
                  dragTabId !== tab.id;
                return (
                  <div
                    key={tab.id}
                    className={`tab-wrap ${isDrop ? `drop-${dropTarget.zone}` : ''}`}
                    draggable={tab.kind === 'terminal'}
                    onDragStart={(e) => {
                      if (tab.kind !== 'terminal') return;
                      setDragTabId(tab.id);
                      e.dataTransfer.setData('text/tab-id', tab.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragTabId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragTabId || dragTabId === tab.id) return;
                      if (tab.kind !== 'terminal') return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const relY = (e.clientY - rect.top) / rect.height;
                      const zone = relY > 0.55 ? 'bottom' : 'right';
                      setDropTarget({ id: tab.id, zone });
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setDropTarget((cur) =>
                          cur?.id === tab.id ? null : cur
                        );
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceId =
                        e.dataTransfer.getData('text/tab-id') || dragTabId;
                      const zone = dropTarget?.id === tab.id
                        ? dropTarget.zone
                        : 'right';
                      setDragTabId(null);
                      setDropTarget(null);
                      if (!sourceId || sourceId === tab.id) return;
                      if (tab.kind !== 'terminal') return;
                      mergeTabs(
                        sourceId,
                        tab.id,
                        zone === 'bottom' ? 'column' : 'row'
                      );
                    }}
                  >
                    <button
                      type="button"
                      className={`tab ${tab.id === activeId ? 'active' : ''} ${
                        tab.kind === 'editor' ? 'editor-tab' : ''
                      }`}
                      onClick={() => setActiveId(tab.id)}
                      onContextMenu={(e) => openCtxMenu(e, tab.id)}
                      onDoubleClick={() => {
                        if (tab.kind === 'editor') return;
                        const name = prompt('Tab name', tab.title);
                        if (name) renameTab(tab.id, name.trim());
                      }}
                    >
                      <span className="tab-title">
                        {tab.kind === 'editor' ? `📄 ${tab.title}` : tab.title}
                      </span>
                      <span
                        className="tab-close"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => closeTab(tab.id, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ')
                            closeTab(tab.id, e);
                        }}
                        title="Close tab"
                      >
                        ×
                      </span>
                    </button>
                    {isDrop && (
                      <div className="tab-drop-hint">
                        {dropTarget.zone === 'bottom'
                          ? 'Merge below'
                          : 'Merge right'}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="new-tab"
                onClick={() => addTab()}
                onContextMenu={(e) => openCtxMenu(e, null)}
                title="New tab"
              >
                +
              </button>
            </div>
          </div>

          <main className="panes">
            {tabs.length === 0 && (
              <div className="empty">
                {connected ? (
                  <button type="button" onClick={() => addTab()}>
                    Open a terminal
                  </button>
                ) : (
                  <p>Connecting to PTY server…</p>
                )}
              </div>
            )}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`pane ${tab.id === activeId ? 'visible' : 'hidden'}`}
              >
                {tab.kind === 'editor' ? (
                  <ConfigEditorPane
                    active={tab.id === activeId}
                    onHostsChanged={() => {
                      window.dispatchEvent(new Event('ssh-hosts-changed'));
                    }}
                  />
                ) : tab._restoreExpected &&
                  (!tab.panes?.length ||
                    tab.panes.length < tab._restoreExpected) ? (
                  <div className="empty">
                    <p>Restoring session…</p>
                  </div>
                ) : (
                  <TerminalSplitView
                    tab={tab}
                    active={tab.id === activeId}
                    focusedPaneId={tab.focusedPaneId}
                    onFocusPane={(paneId) => focusPane(tab.id, paneId)}
                    onClosePane={(paneId) => closePane(tab.id, paneId)}
                    send={send}
                    connected={connected}
                    registerHandlers={registerHandlers}
                    registerStatsHandlers={registerStatsHandlers}
                    registerSerializer={registerSerializer}
                    onPaneTitle={(paneId, title) => {
                      if (tab.panes[0]?.id === paneId && title) {
                        renameTab(tab.id, title);
                      }
                    }}
                    onPaneCwd={(paneId, cwd) =>
                      updatePaneCwd(tab.id, paneId, cwd)
                    }
                  />
                )}
              </div>
            ))}
          </main>
        </div>

        {showSnippets && (
          <SnippetsPanel
            collapsed={snippetsCollapsed}
            onToggle={toggleSnippetsCollapsed}
            onRun={runSnippet}
          />
        )}
      </div>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
