const KEY = 'dockterm.command-history';
export const COMMAND_HISTORY_EVENT = 'dockterm:command-history';
export const COMMAND_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Soft cap so a busy month cannot blow up localStorage. */
const MAX_ENTRIES = 8000;

function prune(entries, now = Date.now()) {
  const cutoff = now - COMMAND_HISTORY_MAX_AGE_MS;
  return entries
    .filter((e) => e && typeof e.at === 'number' && e.at >= cutoff)
    .slice(-MAX_ENTRIES);
}

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* quota — drop oldest half and retry once */
    try {
      const trimmed = entries.slice(Math.floor(entries.length / 2));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      /* ignore */
    }
  }
  return entries;
}

function emit(entries) {
  try {
    window.dispatchEvent(
      new CustomEvent(COMMAND_HISTORY_EVENT, { detail: { entries } })
    );
  } catch {
    /* ignore */
  }
}

export function loadCommandHistory() {
  const entries = prune(readRaw());
  writeRaw(entries);
  return entries;
}

/**
 * @param {{
 *   command: string,
 *   where?: string,
 *   cwd?: string | null,
 *   at?: number,
 * }} entry
 */
export function appendCommandHistory(entry) {
  const command = String(entry?.command || '').replace(/\r\n/g, '\n');
  if (!command.trim()) return loadCommandHistory();

  const next = prune([
    ...readRaw(),
    {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      command,
      where: String(entry.where || 'Local').trim() || 'Local',
      cwd: entry.cwd ? String(entry.cwd) : null,
      at: Number.isFinite(entry.at) ? entry.at : Date.now(),
    },
  ]);
  writeRaw(next);
  emit(next);
  return next;
}

export function clearCommandHistory() {
  writeRaw([]);
  emit([]);
  return [];
}
