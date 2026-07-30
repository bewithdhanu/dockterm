import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execFileAsync = promisify(execFile);

/** @type {{ at: number, ok: boolean } | null} */
let sudoCache = null;
const SUDO_CACHE_MS = 60_000;

/**
 * True when `sudo -n true` succeeds (passwordless sudo available).
 */
export async function hasPasswordlessSudo() {
  if (os.platform() === 'win32') return false;
  if (sudoCache && Date.now() - sudoCache.at < SUDO_CACHE_MS) {
    return sudoCache.ok;
  }
  try {
    await execFileAsync('sudo', ['-n', 'true'], {
      timeout: 2500,
    });
    sudoCache = { at: Date.now(), ok: true };
    return true;
  } catch {
    sudoCache = { at: Date.now(), ok: false };
    return false;
  }
}

/**
 * Run a command; if it fails with EACCES/EPERM-ish and sudo -n works, retry via sudo -n.
 * Or preferSudo=true to try sudo first when available.
 */
export async function execMaybeSudo(file, args, opts = {}) {
  const { preferSudo = false, ...execOpts } = opts;
  const timeout = execOpts.timeout ?? 5000;

  if (preferSudo && (await hasPasswordlessSudo())) {
    try {
      return await execFileAsync('sudo', ['-n', file, ...args], {
        ...execOpts,
        timeout,
      });
    } catch {
      /* fall through to direct */
    }
  }

  try {
    return await execFileAsync(file, args, { ...execOpts, timeout });
  } catch (err) {
    const msg = String(err?.message || err || '');
    const code = err && typeof err === 'object' ? err.code : null;
    const denied =
      code === 'EPERM' ||
      code === 'EACCES' ||
      /permission denied|operation not permitted/i.test(msg);
    if (!denied) throw err;
    if (!(await hasPasswordlessSudo())) throw err;
    return execFileAsync('sudo', ['-n', file, ...args], {
      ...execOpts,
      timeout,
    });
  }
}

/** Shell snippet: set SUDO="sudo -n" when passwordless sudo works. */
export const REMOTE_SUDO_SETUP = `
SUDO=""
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  SUDO="sudo -n"
fi
`;
