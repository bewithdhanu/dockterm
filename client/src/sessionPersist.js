const STORAGE_KEY = 'web-terminal.session.v1';
const MAX_SCROLLBACK_ROWS = 4000;

/**
 * @typedef {{
 *   version: number,
 *   savedAt: number,
 *   activeId: string | null,
 *   sidebarCollapsed: boolean,
 *   tabs: Array<{
 *     id: string,
 *     title: string,
 *     kind: 'terminal' | 'editor',
 *     direction?: 'row' | 'column',
 *     focusedPaneIndex?: number,
 *     panes?: Array<{
 *       ssh: string | null,
 *       cwd: string | null,
 *       kind: string,
 *       scrollback: string,
 *       cols?: number,
 *       rows?: number,
 *     }>
 *   }>
 * }} SessionSnapshot
 */

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.tabs)) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {SessionSnapshot} snapshot
 */
export function saveSession(snapshot) {
  try {
    const payload = JSON.stringify(snapshot);
    // Soft cap ~4.5MB to stay under typical 5MB localStorage limits
    if (payload.length > 4.5 * 1024 * 1024) {
      const trimmed = {
        ...snapshot,
        tabs: snapshot.tabs.map((t) => ({
          ...t,
          panes: (t.panes || []).map((p) => ({
            ...p,
            scrollback: (p.scrollback || '').slice(-1_500_000),
          })),
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (err) {
    console.warn('Failed to persist session:', err);
    try {
      // Last resort: drop scrollback, keep layout + connections
      const slim = {
        ...snapshot,
        tabs: snapshot.tabs.map((t) => ({
          ...t,
          panes: (t.panes || []).map((p) => ({
            ...p,
            scrollback: '',
          })),
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

export { MAX_SCROLLBACK_ROWS, STORAGE_KEY };
