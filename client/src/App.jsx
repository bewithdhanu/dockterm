import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuLayoutGrid, LuPanelLeft, LuPanelRight } from 'react-icons/lu';
import { TitleBar } from './TitleBar.jsx';
import { AppThemeControl } from './AppThemeControl.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';
import { NavRail } from './NavRail.jsx';
import { HostsView } from './HostsView.jsx';
import {
  SnippetsView,
  SnippetDetailPanel,
  nextCopySnippetName,
  notifySnippetsChanged,
} from './SnippetsView.jsx';
import { CommandHistoryView, HistoryDetailPanel } from './CommandHistoryView.jsx';
import { HostDetailPanel } from './SshModals.jsx';
import { SessionHostsRail } from './SessionHostsRail.jsx';
import { RightDrawer } from './RightDrawer.jsx';
import { ConfigEditorPane } from './ConfigEditorPane.jsx';
import { MAX_PANES, TerminalSplitView } from './TerminalSplitView.jsx';
import { clearSession, saveSession } from './sessionPersist.js';
import { endsWithShellPrompt, looksLikeSshSessionReady } from './shellPrompt.js';
import { nextCopyAlias, useSshHosts } from './useSshHosts.js';
import { useHostOs } from './useHostOs.js';
import {
  connectionKeyFromPane,
  connectionLabel,
} from './terminalThemes.js';

const SSH_CONFIG_TAB_ID = 'editor:ssh-config';
const NAV_KEY = 'dockterm.nav-section';
const SESSION_HOSTS_KEY = 'dockterm.session-hosts-open';
const SESSION_SNIPPETS_KEY = 'dockterm.session-snippets-open';

function readNavSection() {
  const v = localStorage.getItem(NAV_KEY);
  if (v === 'hosts' || v === 'snippets' || v === 'history') return v;
  return 'hosts';
}

function readBool(key, fallback) {
  const v = localStorage.getItem(key);
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return fallback;
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
  /** Outbound WS messages queued while the socket is connecting. */
  const outboxRef = useRef([]);
  const closedStackRef = useRef([]);
  /** Rolling SSH output used to detect first shell prompt (connecting → connected). */
  const sshPromptBufRef = useRef(new Map());
  /** When each SSH pane entered connecting (for ready fallback). */
  const sshConnectAtRef = useRef(new Map());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const closePaneRef = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [mainView, setMainView] = useState('hosts'); // hosts | session
  const [navSection, setNavSection] = useState(readNavSection);
  /** @type {[null | { mode: 'add' | 'edit' | 'duplicate', snippet?: object }, Function]} */
  const [snippetDetail, setSnippetDetail] = useState(null);
  /** @type {[null | object, Function]} */
  const [historyDetail, setHistoryDetail] = useState(null);
  /** @type {[null | { mode: 'add' | 'edit' | 'duplicate', host?: object, sourceAlias?: string }, Function]} */
  const [hostDetail, setHostDetail] = useState(null);
  const [sessionHostsOpen, setSessionHostsOpen] = useState(() =>
    readBool(SESSION_HOSTS_KEY, true)
  );
  const [sessionSnippetsOpen, setSessionSnippetsOpen] = useState(() =>
    readBool(SESSION_SNIPPETS_KEY, false)
  );
  const [dragTabId, setDragTabId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, zone: 'right'|'bottom' }
  const hostsApi = useSshHosts();
  const hostOs = useHostOs();

  const focusedConnectionKey = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || tab.kind !== 'terminal') return connectionKeyFromPane(null);
    const pane =
      tab.panes?.find((p) => p.id === tab.focusedPaneId) || tab.panes?.[0];
    return connectionKeyFromPane(pane?.ssh);
  }, [tabs, activeId]);

  // If SSH output already includes a shell prompt but no further chunks arrive
  // (common after MOTD), promote connecting → connected on a short poll.
  useEffect(() => {
    const tick = () => {
      const promote = [];
      for (const t of tabsRef.current) {
        if (t.kind !== 'terminal' || !t.panes) continue;
        for (const p of t.panes) {
          if (!p.ssh || p.sshStatus !== 'connecting' || p.alive === false) {
            continue;
          }
          const buf = sshPromptBufRef.current.get(p.id) || '';
          if (!buf) continue;
          const started = sshConnectAtRef.current.get(p.id) || Date.now();
          const elapsed = Date.now() - started;
          if (
            endsWithShellPrompt(buf) ||
            looksLikeSshSessionReady(buf, elapsed)
          ) {
            promote.push(p.id);
          }
        }
      }
      if (!promote.length) return;
      for (const id of promote) {
        sshPromptBufRef.current.delete(id);
        sshConnectAtRef.current.delete(id);
      }
      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          if (t.kind !== 'terminal' || !t.panes) return t;
          let changed = false;
          const panes = t.panes.map((p) => {
            if (
              promote.includes(p.id) &&
              p.sshStatus === 'connecting'
            ) {
              changed = true;
              return { ...p, sshStatus: 'connected' };
            }
            return p;
          });
          return changed ? { ...t, panes } : t;
        })
      );
    };
    const id = window.setInterval(tick, 750);
    return () => window.clearInterval(id);
  }, []);

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
      return;
    }
    // Queue creates (and only creates) so "+" / connect still work during WS setup.
    if (msg?.type === 'create') {
      outboxRef.current.push(msg);
    }
  }, []);

  const flushOutbox = useCallback((ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const queued = outboxRef.current.splice(0);
    for (const msg of queued) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
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
    if (!currentTabs.length) {
      clearSession();
      return;
    }
    const snapshot = {
      version: 1,
      savedAt: Date.now(),
      activeId: activeIdRef.current,
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
          // Do not auto-restore SSH/terminal sessions on page load/refresh.
          // Stay on the hosts screen until the user opens a connection —
          // unless they already queued a create while the socket was connecting.
          const hadQueuedCreates = outboxRef.current.length > 0;
          clearSession();
          setTabs([]);
          setActiveId(null);
          setMainView(hadQueuedCreates ? 'session' : 'hosts');
          flushOutbox(ws);
        } else {
          // Recreate PTYs after server dropped them; skip if restore already in flight.
          resumeAfterReconnect(ws);
          // Keep any creates the user issued during the reconnect gap.
          flushOutbox(ws);
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

          if (isSsh) {
            sshConnectAtRef.current.set(msg.id, Date.now());
          }

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

          const title = pending?.title || msg.title || null;
          const tab = {
            id: groupId(),
            title: title || 'Terminal',
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
            if (!sshConnectAtRef.current.has(msg.id)) {
              sshConnectAtRef.current.set(msg.id, Date.now());
            }
            const prev = sshPromptBufRef.current.get(msg.id) || '';
            const next = (prev + String(msg.data || '')).slice(-8000);
            sshPromptBufRef.current.set(msg.id, next);
            const elapsed =
              Date.now() - (sshConnectAtRef.current.get(msg.id) || Date.now());
            if (
              endsWithShellPrompt(next) ||
              looksLikeSshSessionReady(next, elapsed)
            ) {
              sshPromptBufRef.current.delete(msg.id);
              sshConnectAtRef.current.delete(msg.id);
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
          sshConnectAtRef.current.delete(msg.id);

          const owner = tabsRef.current.find(
            (t) =>
              t.kind === 'terminal' && t.panes?.some((p) => p.id === msg.id)
          );
          const pane = owner?.panes?.find((p) => p.id === msg.id);
          const isSsh = Boolean(pane?.ssh || pane?.kind === 'ssh');
          const wasConnecting = isSsh && pane?.sshStatus === 'connecting';

          // SSH session that had already connected (user typed `exit`, hangup, etc.)
          // — close the pane/tab. Keep the error toast only for failed connects.
          if (isSsh && !wasConnecting) {
            if (owner) closePaneRef.current?.(owner.id, msg.id);
            return;
          }

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
                        sshStatus: isSsh ? 'error' : null,
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
      setMainView('session');
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

  // Finder / CLI: open a local terminal tab at a folder.
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.dockterm : null;
    if (!api?.onOpenFolder) return undefined;
    return api.onOpenFolder((payload) => {
      const cwd = String(payload?.cwd || '').trim();
      if (!cwd) return;
      const parts = cwd.split(/[/\\]/).filter(Boolean);
      const title = parts[parts.length - 1] || 'Terminal';
      setHostDetail(null);
      setSnippetDetail(null);
      setHistoryDetail(null);
      addTab({ cwd, title });
    });
  }, [addTab]);

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
    setMainView('session');
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
        if (next.length === 0) {
          clearSession();
          queueMicrotask(() => setMainView('hosts'));
        }
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

  // Native context menu for text fields (browser) / Electron main handler.
  // Do not preventDefault on editable fields in Electron — main.cjs owns that menu.
  useEffect(() => {
    const onContextMenu = (e) => {
      const el = e.target;
      if (!(el instanceof Element)) {
        e.preventDefault();
        return;
      }
      const editable = Boolean(
        el.closest('input') ||
          el.closest('textarea') ||
          el.closest('select') ||
          el.closest('[contenteditable="true"]') ||
          el.closest('.monaco-editor') ||
          el.closest('.editor-pane') ||
          el.closest('.allow-native-menu')
      );
      const inTerminal = Boolean(
        el.closest('.xterm') || el.closest('.terminal-host')
      );

      if (editable) {
        // Browser: allow native menu. Electron: main process shows the menu
        // (preventDefault there). Don't block the event here.
        return;
      }
      if (inTerminal) {
        e.preventDefault();
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
      hostsApi.markRecent(host.alias);
      setMainView('session');
      addTab({ title: host.alias, ssh: host.alias });
    },
    [addTab, hostsApi]
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
      // Snippet runs are not recorded in Command History.
      send({ type: 'input', id: pane.id, data });
    },
    [send]
  );

  const selectNav = useCallback(
    (id) => {
      if (id === 'config') {
        openConfigEditor();
        setMainView('session');
        return;
      }
      setNavSection(id);
      if (id === 'hosts' || id === 'snippets' || id === 'history') {
        localStorage.setItem(NAV_KEY, id);
        setMainView('hosts');
      }
      if (id !== 'snippets') setSnippetDetail(null);
      if (id !== 'history') setHistoryDetail(null);
      if (id === 'snippets' || id === 'history') setHostDetail(null);
      if (id === 'history') setSnippetDetail(null);
    },
    [openConfigEditor]
  );

  const setSessionHosts = useCallback((open) => {
    setSessionHostsOpen(open);
    localStorage.setItem(SESSION_HOSTS_KEY, open ? '1' : '0');
  }, []);

  const setSessionSnippets = useCallback((open) => {
    setSessionSnippetsOpen(open);
    localStorage.setItem(SESSION_SNIPPETS_KEY, open ? '1' : '0');
  }, []);

  const openSessionTab = useCallback((tabId) => {
    setActiveId(tabId);
    setMainView('session');
  }, []);

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
          map.set(p.ssh, 'connected');
        }
      }
    }
    return map;
  }, [tabs]);

  useEffect(() => {
    for (const [alias, status] of sshHostStatuses) {
      if (status === 'connected') hostOs.ensure(alias);
    }
  }, [sshHostStatuses, hostOs.ensure]);

  const openConfigAndShow = useCallback(() => {
    openConfigEditor();
    setMainView('session');
  }, [openConfigEditor]);

  return (
    <div className={`app ${mainView === 'session' ? 'is-session' : ''}`}>
      <TitleBar
        session={mainView === 'session'}
        trailing={
          <div className="chrome-trailing-row">
            <AppThemeControl />
            {mainView === 'session' ? (
              <div
                className="chrome-panel-toggles"
                role="group"
                aria-label="Panels"
              >
                <button
                  type="button"
                  className={`chrome-panel-toggle ${
                    sessionHostsOpen ? 'active' : ''
                  }`}
                  title={sessionHostsOpen ? 'Hide hosts' : 'Show hosts'}
                  aria-pressed={sessionHostsOpen}
                  onClick={() => setSessionHosts(!sessionHostsOpen)}
                >
                  <LuPanelLeft size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`chrome-panel-toggle ${
                    sessionSnippetsOpen && !hostDetail ? 'active' : ''
                  }`}
                  title={
                    sessionSnippetsOpen && !hostDetail
                      ? 'Hide sidebar'
                      : 'Show sidebar'
                  }
                  aria-pressed={sessionSnippetsOpen && !hostDetail}
                  onClick={() => {
                    if (sessionSnippetsOpen && !hostDetail) {
                      setSessionSnippets(false);
                      return;
                    }
                    setHostDetail(null);
                    setSnippetDetail(null);
                    setSessionSnippets(true);
                  }}
                >
                  <LuPanelRight size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        }
      >
        <div className="tabbar" onContextMenu={(e) => openCtxMenu(e, null)}>
          <button
            type="button"
            className={`tab home-tab ${mainView === 'hosts' ? 'active' : ''}`}
            onClick={() => selectNav('hosts')}
            title="Hosts"
          >
            <span className="tab-icon" aria-hidden="true">
              <LuLayoutGrid size={14} />
            </span>
            <span className="tab-title">Hosts</span>
          </button>
          <div className="tab-sep" aria-hidden="true" />
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
                    const zone =
                      dropTarget?.id === tab.id ? dropTarget.zone : 'right';
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
                    className={`tab ${
                      mainView === 'session' && tab.id === activeId
                        ? 'active'
                        : ''
                    } ${tab.kind === 'editor' ? 'editor-tab' : ''}`}
                    onClick={() => openSessionTab(tab.id)}
                    onContextMenu={(e) => openCtxMenu(e, tab.id)}
                    onDoubleClick={() => {
                      if (tab.kind === 'editor') return;
                      const name = prompt('Tab name', tab.title);
                      if (name) renameTab(tab.id, name.trim());
                    }}
                  >
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
                    <span className="tab-title">
                      {tab.kind === 'editor' ? tab.title : tab.title}
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
              onClick={() => {
                setMainView('session');
                addTab();
              }}
              onContextMenu={(e) => openCtxMenu(e, null)}
              title="New terminal"
            >
              +
            </button>
          </div>
        </div>
      </TitleBar>

      <div className="workspace">
        {mainView === 'hosts' ? (
          <NavRail
            active={
              navSection === 'snippets' || navSection === 'history'
                ? navSection
                : 'hosts'
            }
            onSelect={selectNav}
          />
        ) : sessionHostsOpen ? (
          <SessionHostsRail
            hostsApi={hostsApi}
            hostStatuses={sshHostStatuses}
            hostOsByAlias={hostOs.osByAlias}
            onConnect={connectSsh}
            onCollapse={() => setSessionHosts(false)}
            onOpenEditHost={(host) => {
              setSnippetDetail(null);
              setHostDetail({ mode: 'edit', host });
            }}
            onOpenDuplicateHost={(host, sourceAlias) => {
              setSnippetDetail(null);
              setHostDetail({ mode: 'duplicate', host, sourceAlias });
            }}
          />
        ) : null}

        <div className="main-col">
          <div
            className={`hosts-main ${
              mainView === 'hosts' ? 'visible' : 'hidden'
            }`}
            aria-hidden={mainView !== 'hosts'}
          >
            {navSection === 'snippets' ? (
              <SnippetsView
                selectedId={
                  snippetDetail?.mode === 'edit'
                    ? snippetDetail.snippet?.id
                    : null
                }
                onOpenNew={() => {
                  setHostDetail(null);
                  setSnippetDetail({ mode: 'add' });
                }}
                onOpenEdit={(snippet) => {
                  setHostDetail(null);
                  setSnippetDetail({ mode: 'edit', snippet });
                }}
                onOpenDuplicate={(snippet) => {
                  setHostDetail(null);
                  setSnippetDetail({ mode: 'duplicate', snippet });
                }}
                onDeleted={(id) => {
                  setSnippetDetail((cur) =>
                    cur?.mode === 'edit' && cur.snippet?.id === id
                      ? null
                      : cur
                  );
                }}
                onOpenTerminal={() => {
                  setMainView('session');
                  addTab();
                }}
                onOpenConfig={openConfigAndShow}
              />
            ) : navSection === 'history' ? (
              <CommandHistoryView
                selectedId={historyDetail?.id ?? null}
                onSelect={(entry) => {
                  setHostDetail(null);
                  setSnippetDetail(null);
                  setHistoryDetail(entry || null);
                }}
                onOpenTerminal={() => {
                  setMainView('session');
                  addTab();
                }}
                onOpenConfig={openConfigAndShow}
              />
            ) : (
              <HostsView
                hostsApi={hostsApi}
                hostStatuses={sshHostStatuses}
                hostOsByAlias={hostOs.osByAlias}
                selectedAlias={
                  hostDetail?.mode === 'edit' ? hostDetail.host?.alias : null
                }
                onConnect={connectSsh}
                onOpenTerminal={() => {
                  setMainView('session');
                  addTab();
                }}
                onOpenConfig={openConfigAndShow}
                onOpenNewHost={() => {
                  setSnippetDetail(null);
                  setHostDetail({ mode: 'add' });
                }}
                onOpenEditHost={(host) => {
                  setSnippetDetail(null);
                  setHostDetail({ mode: 'edit', host });
                }}
                onOpenDuplicateHost={(host, sourceAlias) => {
                  setSnippetDetail(null);
                  setHostDetail({ mode: 'duplicate', host, sourceAlias });
                }}
              />
            )}
          </div>

          <main
            className={`panes ${mainView === 'session' ? 'visible' : 'hidden'}`}
            aria-hidden={mainView !== 'session'}
          >
            {tabs.length === 0 && (
              <div className="empty">
                {connected ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMainView('hosts');
                    }}
                  >
                    Browse hosts
                  </button>
                ) : (
                  <p>Connecting to PTY server…</p>
                )}
              </div>
            )}
            {tabs.map((tab) => {
              const tabActive = mainView === 'session' && tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  className={`pane ${tabActive ? 'visible' : 'hidden'}`}
                >
                  {tab.kind === 'editor' ? (
                    <ConfigEditorPane
                      active={tabActive}
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
                      active={tabActive}
                      focusedPaneId={tab.focusedPaneId}
                      onFocusPane={(paneId) => focusPane(tab.id, paneId)}
                      onClosePane={(paneId) => closePane(tab.id, paneId)}
                      send={send}
                      connected={connected}
                      registerHandlers={registerHandlers}
                      registerStatsHandlers={registerStatsHandlers}
                      registerSerializer={registerSerializer}
                      onPaneTitle={(paneId, title) => {
                        const pane = tab.panes.find((p) => p.id === paneId);
                        // Keep SSH connection / alias name — don't replace with user@host.
                        if (pane?.ssh) return;
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
              );
            })}
          </main>
        </div>

        {hostDetail && (
          <HostDetailPanel
            key={
              hostDetail.mode === 'edit'
                ? `edit-${hostDetail.host?.alias}`
                : hostDetail.mode === 'duplicate'
                  ? `dup-${hostDetail.sourceAlias || hostDetail.host?.alias}`
                  : 'add'
            }
            mode={hostDetail.mode === 'edit' ? 'edit' : hostDetail.mode === 'duplicate' ? 'duplicate' : 'add'}
            initial={hostDetail.mode === 'add' ? null : hostDetail.host}
            titleOverride={
              hostDetail.mode === 'duplicate'
                ? `Duplicate ${hostDetail.sourceAlias || hostDetail.host?.alias || ''}`
                : undefined
            }
            onClose={() => setHostDetail(null)}
            onSaved={(hosts, saved) => {
              hostsApi.onHostsSaved?.(hosts);
              if (saved) {
                setHostDetail({ mode: 'edit', host: saved });
                return;
              }
              setHostDetail(null);
            }}
            onDuplicate={(host) => {
              const alias = nextCopyAlias(
                host.alias || 'host',
                hostsApi.hosts || []
              );
              setHostDetail({
                mode: 'duplicate',
                host: { ...host, alias },
                sourceAlias: host.alias,
              });
            }}
            onDelete={(host) => {
              hostsApi.deleteHost?.(host);
              setHostDetail(null);
            }}
          />
        )}

        {mainView === 'hosts' &&
          navSection === 'snippets' &&
          snippetDetail &&
          !hostDetail && (
            <SnippetDetailPanel
              key={
                snippetDetail.mode === 'edit'
                  ? `edit-${snippetDetail.snippet?.id}`
                  : snippetDetail.mode === 'duplicate'
                    ? `dup-${snippetDetail.snippet?.name}-${snippetDetail.snippet?.command?.length || 0}`
                    : 'add'
              }
              mode={snippetDetail.mode === 'edit' ? 'edit' : 'add'}
              initial={
                snippetDetail.mode === 'add' ? null : snippetDetail.snippet
              }
              onClose={() => setSnippetDetail(null)}
              onSaved={(_list, saved) => {
                notifySnippetsChanged();
                if (saved) {
                  setSnippetDetail({ mode: 'edit', snippet: saved });
                } else {
                  setSnippetDetail(null);
                }
              }}
              onDuplicate={(snippet) => {
                fetch('/api/snippets')
                  .then((r) => r.json())
                  .then((data) => {
                    const all = Array.isArray(data.snippets)
                      ? data.snippets
                      : [];
                    setSnippetDetail({
                      mode: 'duplicate',
                      snippet: {
                        name: nextCopySnippetName(
                          snippet.name || 'Snippet',
                          all
                        ),
                        command: snippet.command || '',
                      },
                    });
                  })
                  .catch(() => {
                    setSnippetDetail({
                      mode: 'duplicate',
                      snippet: {
                        name: nextCopySnippetName(
                          snippet.name || 'Snippet',
                          []
                        ),
                        command: snippet.command || '',
                      },
                    });
                  });
              }}
              onDelete={async (snippet) => {
                if (!confirm(`Delete snippet “${snippet.name}”?`)) return;
                try {
                  const res = await fetch(
                    `/api/snippets/${encodeURIComponent(snippet.id)}`,
                    { method: 'DELETE' }
                  );
                  const data = await res.json();
                  if (!res.ok) {
                    throw new Error(data.error || `HTTP ${res.status}`);
                  }
                  notifySnippetsChanged();
                  setSnippetDetail(null);
                } catch (err) {
                  alert(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          )}

        {mainView === 'hosts' &&
          navSection === 'history' &&
          historyDetail &&
          !hostDetail && (
            <HistoryDetailPanel
              key={historyDetail.id}
              entry={historyDetail}
              onClose={() => setHistoryDetail(null)}
              onRun={(snippet) => {
                setMainView('session');
                requestAnimationFrame(() => runSnippet(snippet));
              }}
            />
          )}

        {mainView === 'session' && sessionSnippetsOpen && !hostDetail && (
          <RightDrawer
            onRun={runSnippet}
            onClose={() => setSessionSnippets(false)}
            connectionKey={focusedConnectionKey}
            connectionLabel={connectionLabel(focusedConnectionKey)}
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
