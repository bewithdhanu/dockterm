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
