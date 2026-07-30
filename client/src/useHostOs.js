import { useCallback, useRef, useState } from 'react';

const OS_KEY = 'dockterm.host-os.v1';

function loadOsMap() {
  try {
    const raw = localStorage.getItem(OS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveOsMap(map) {
  try {
    localStorage.setItem(OS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Cache + fetch remote OS id per SSH host alias.
 */
export function useHostOs() {
  const [osByAlias, setOsByAlias] = useState(() => loadOsMap());
  const inflightRef = useRef(new Set());
  const osRef = useRef(osByAlias);
  osRef.current = osByAlias;

  const ensure = useCallback(async (alias) => {
    const key = String(alias || '').trim();
    if (!key) return null;
    const existing = osRef.current[key];
    if (existing?.id && existing.id !== 'unknown') return existing;
    if (inflightRef.current.has(key)) return existing || null;

    inflightRef.current.add(key);
    try {
      const res = await fetch(
        `/api/ssh-hosts/${encodeURIComponent(key)}/os`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const entry = {
        id: data.id || 'unknown',
        label: data.label || 'SSH',
        pretty: data.pretty || data.label || 'SSH',
        at: Date.now(),
      };
      setOsByAlias((prev) => {
        const next = { ...prev, [key]: entry };
        saveOsMap(next);
        return next;
      });
      return entry;
    } catch {
      return existing || null;
    } finally {
      inflightRef.current.delete(key);
    }
  }, []);

  const getOs = useCallback(
    (alias) => {
      if (!alias) return null;
      return osByAlias[alias] || null;
    },
    [osByAlias]
  );

  return { osByAlias, ensure, getOs };
}
