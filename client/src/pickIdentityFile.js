/**
 * Resolve an absolute identity path from a Finder/Explorer drop.
 * Electron 32+ exposes paths via webUtils.getPathForFile (preload).
 * @param {DragEvent} event
 * @returns {string | null}
 */
export function pathFromIdentityDrop(event) {
  const dt = event?.dataTransfer;
  if (!dt) return null;

  const files = dt.files;
  if (files && files.length > 0) {
    const file = files[0];
    try {
      if (typeof window !== 'undefined' && window.dockterm?.pathForFile) {
        const p = window.dockterm.pathForFile(file);
        if (p) return String(p);
      }
    } catch {
      /* fall through */
    }
    // Older Electron / some embeds still set File.path
    if (typeof file.path === 'string' && file.path.trim()) {
      return file.path.trim();
    }
  }

  // Fallback: text URI list (file:///…)
  try {
    const uri = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
    const line = String(uri)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#'));
    if (line && /^file:/i.test(line)) {
      const u = new URL(line);
      let p = decodeURIComponent(u.pathname || '');
      // Windows file:///C:/… → /C:/… → C:/…
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p || null;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * @returns {Promise<string|null>} Absolute path, or null if cancelled.
 */
export async function pickIdentityFile() {
  if (typeof window !== 'undefined' && window.dockterm?.pickIdentityFile) {
    const path = await window.dockterm.pickIdentityFile();
    return path || null;
  }

  const res = await fetch('/api/pick-identity-file', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (data.cancelled) return null;
  return data.path || null;
}
