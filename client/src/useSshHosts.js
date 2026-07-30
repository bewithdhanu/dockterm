import { useCallback, useEffect, useMemo, useState } from 'react';

const SORT_KEY = 'web-terminal.ssh-sort';
const RECENT_KEY = 'web-terminal.ssh-recent';
const MAX_RECENT = 100;

export function readSort() {
  const v = localStorage.getItem(SORT_KEY);
  if (v === 'name-asc' || v === 'name-desc' || v === 'recent') return v;
  return 'name-asc';
}

export function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function touchRecent(alias) {
  const map = readRecent();
  map[alias] = Date.now();
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const trimmed = Object.fromEntries(entries.slice(0, MAX_RECENT));
  localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function nextCopyAlias(alias, hosts) {
  const taken = new Set(hosts.map((h) => h.alias.toLowerCase()));
  const base = `${alias}-copy`;
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base}${i}`.toLowerCase())) i += 1;
  return `${base}${i}`;
}

export function useSshHosts() {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [configPath, setConfigPath] = useState('~/.ssh/config');
  const [exists, setExists] = useState(true);
  const [sort, setSort] = useState(readSort);
  const [recent, setRecent] = useState(readRecent);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ssh-hosts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHosts(Array.isArray(data.hosts) ? data.hosts : []);
      if (data.configPath) setConfigPath(data.configPath);
      setExists(data.exists !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener('ssh-hosts-changed', onChanged);
    return () => window.removeEventListener('ssh-hosts-changed', onChanged);
  }, [load]);

  const onSortChange = (value) => {
    setSort(value);
    localStorage.setItem(SORT_KEY, value);
  };

  const onHostsSaved = useCallback(
    (nextHosts) => {
      if (Array.isArray(nextHosts)) setHosts(nextHosts);
      else load();
    },
    [load]
  );

  const deleteHost = useCallback(
    async (host) => {
      if (!host.editable) {
        alert(
          'This host comes from an Include file or a multi-host entry. Edit the full config instead.'
        );
        return false;
      }
      if (!confirm(`Delete SSH host "${host.alias}" from ~/.ssh/config?`)) {
        return false;
      }
      try {
        const res = await fetch(
          `/api/ssh-hosts/${encodeURIComponent(host.alias)}`,
          { method: 'DELETE' }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        onHostsSaved(data.hosts);
        return true;
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [onHostsSaved]
  );

  const markRecent = useCallback((alias) => {
    setRecent(touchRecent(alias));
  }, []);

  const filterSort = useCallback(
    (query) => {
      const q = String(query || '')
        .trim()
        .toLowerCase();
      let list = !q
        ? [...hosts]
        : hosts.filter(
            (h) =>
              h.alias.toLowerCase().includes(q) ||
              (h.hostName && h.hostName.toLowerCase().includes(q)) ||
              (h.user && h.user.toLowerCase().includes(q))
          );

      if (sort === 'name-asc') {
        list.sort((a, b) =>
          a.alias.localeCompare(b.alias, undefined, { sensitivity: 'base' })
        );
      } else if (sort === 'name-desc') {
        list.sort((a, b) =>
          b.alias.localeCompare(a.alias, undefined, { sensitivity: 'base' })
        );
      } else if (sort === 'recent') {
        list.sort((a, b) => {
          const ra = recent[a.alias] || 0;
          const rb = recent[b.alias] || 0;
          if (rb !== ra) return rb - ra;
          return a.alias.localeCompare(b.alias, undefined, {
            sensitivity: 'base',
          });
        });
      }
      return list;
    },
    [hosts, sort, recent]
  );

  const displayPath = useMemo(() => {
    if (!exists) return 'No ~/.ssh/config';
    return configPath
      .replace(/\/Users\/[^/]+/, '~')
      .replace(/^\/home\/[^/]+/, '~');
  }, [configPath, exists]);

  return {
    hosts,
    loading,
    error,
    configPath,
    exists,
    displayPath,
    sort,
    recent,
    load,
    onSortChange,
    onHostsSaved,
    deleteHost,
    markRecent,
    filterSort,
  };
}
