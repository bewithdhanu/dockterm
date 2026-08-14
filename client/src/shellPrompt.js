/**
 * Detect a usable shell after SSH MOTD / login banners.
 * Must tolerate ANSI colors, missing trailing spaces, and CSI after the prompt
 * (e.g. bracketed-paste mode from bash).
 */

function stripAnsi(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b./g, '');
}

function normalizeForPrompt(buf) {
  return stripAnsi(buf)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '');
}

/** Classic interactive shell prompt on a single line. */
function lineLooksLikePrompt(line) {
  const last = String(line || '').trimEnd();
  if (!last || last.length > 240) return false;

  // Still on auth / confirmation — not a shell yet.
  if (
    /password:\s*$/i.test(last) ||
    /passphrase.*:\s*$/i.test(last) ||
    /\(yes\/no[^)]*\)\??\s*$/i.test(last) ||
    /are you sure you want to continue/i.test(last)
  ) {
    return false;
  }

  // Skip MOTD / login chatter lines.
  if (/^\*{2,}/.test(last)) return false;
  if (/^last login:/i.test(last)) return false;
  if (/^welcome to/i.test(last)) return false;

  // user@host:path$   root@host:~#
  if (/^[^:\n]*@[^:\n]+:.+[#$]\s*$/.test(last)) return true;

  // host#  /  user$
  if (/^[A-Za-z0-9._-]+[#%$]\s*$/.test(last)) return true;

  // path-only prompts: ~/proj$  /var/log#
  if (/^[~\/].*[#$]\s*$/.test(last)) return true;

  // bare prompt
  if (/^[#$%]\s*$/.test(last)) return true;

  // fish / some zsh: … ~>
  if (/^.+~>\s*$/.test(last)) return true;

  // zsh % with short left side
  if (last.length < 100 && /%\s*$/.test(last) && !/[?]/.test(last)) {
    return true;
  }

  return false;
}

/**
 * True when buffer ends on a typical shell prompt (post-MOTD / login).
 * @param {string} buf
 */
export function endsWithShellPrompt(buf) {
  const plain = normalizeForPrompt(buf).replace(/\n+$/, '');
  if (!plain) return false;

  const lines = plain.split('\n');
  // Prompt is usually the last non-empty line; check a few in case of trailing junk.
  let checked = 0;
  for (let i = lines.length - 1; i >= 0 && checked < 6; i -= 1) {
    const line = lines[i];
    if (!String(line || '').trim()) continue;
    checked += 1;
    if (lineLooksLikePrompt(line)) return true;
  }
  return false;
}

/**
 * Fallback when prompt heuristics miss (exotic PS1) but login clearly finished.
 * @param {string} buf
 * @param {number} elapsedMs
 */
export function looksLikeSshSessionReady(buf, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 3000) return false;
  const plain = normalizeForPrompt(buf);
  if (!plain.trim()) return false;

  const tail = plain.slice(-1200);
  const hasLoginNoise =
    /last login:/i.test(tail) ||
    /welcome to/i.test(tail) ||
    /\*\*\* system restart required \*\*\*/i.test(tail);

  // Any user@host … $/# in the recent tail after MOTD-ish output.
  const hasAtPrompt = /[A-Za-z0-9._-]+@[A-Za-z0-9._-]+[^#$\n]{0,120}[#$]\s*$/m.test(
    tail
  );

  if (hasAtPrompt) return true;
  if (elapsedMs >= 8000 && hasLoginNoise && /[#$%>]\s*$/m.test(tail)) {
    return true;
  }
  // Long connect with interactive-looking trailing line
  if (elapsedMs >= 15000 && endsWithShellPrompt(plain)) return true;
  if (elapsedMs >= 25000 && /[#$]\s*$/m.test(tail) && tail.length > 40) {
    return true;
  }
  return false;
}
