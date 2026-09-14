import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { findSshHost } from './sshConfig.js';

/**
 * Connect-time identity: config still stores IdentityFile path, but the live
 * ssh command uses a 0600 temp copy of the key contents so OpenSSH won't
 * reject world-readable / weird-FS PEMs.
 */

function identityCacheDir() {
  return path.join(os.tmpdir(), 'dockterm-ssh-ids');
}

function ensureCacheDir() {
  const dir = identityCacheDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* Windows / some FS ignore mode */
  }
  return dir;
}

/**
 * @param {string} alias
 * @returns {string | null} absolute IdentityFile path from ~/.ssh/config
 */
export function identityFileForAlias(alias) {
  const host = findSshHost(alias);
  const p = host?.identityFile ? String(host.identityFile).trim() : '';
  return p || null;
}

/**
 * Read key bytes from the configured path and materialize a private temp file.
 * @param {string} sourcePath
 * @returns {{ path: string, cleanup: () => void }}
 */
export function materializeIdentityFile(sourcePath) {
  const src = String(sourcePath || '').trim();
  if (!src) throw new Error('Identity file path is empty');
  if (!fs.existsSync(src)) {
    throw new Error(`Identity file not found: ${src}`);
  }

  let st;
  try {
    st = fs.statSync(src);
  } catch (err) {
    throw new Error(
      `Cannot stat identity file: ${err instanceof Error ? err.message : err}`
    );
  }
  if (!st.isFile()) {
    throw new Error(`Identity path is not a file: ${src}`);
  }

  let contents;
  try {
    contents = fs.readFileSync(src);
  } catch (err) {
    throw new Error(
      `Cannot read identity file: ${err instanceof Error ? err.message : err}`
    );
  }
  if (!contents || !contents.length) {
    throw new Error(`Identity file is empty: ${src}`);
  }

  const dir = ensureCacheDir();
  const dest = path.join(
    dir,
    `id-${process.pid}-${randomBytes(8).toString('hex')}`
  );

  // ponytail: write+chmod; on Windows ACL is best-effort via mode flags.
  const fd = fs.openSync(dest, 'w', 0o600);
  try {
    fs.writeSync(fd, contents);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    /* ignore */
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  };

  return { path: dest, cleanup };
}

/**
 * @param {string} alias
 * @returns {{ path: string, cleanup: () => void } | null}
 */
export function prepareIdentityForAlias(alias) {
  const source = identityFileForAlias(alias);
  if (!source) return null;
  return materializeIdentityFile(source);
}

/**
 * OpenSSH argv fragment: ignore config IdentityFile (bad perms), use temp key.
 * @param {string} identityPath
 * @returns {string[]}
 */
export function sshIdentityArgs(identityPath) {
  const p = String(identityPath || '').trim();
  if (!p) return [];
  // IdentityFile=none clears config keys (OpenSSH 7.3+); -i supplies ours.
  return [
    '-o',
    'IdentityFile=none',
    '-i',
    p,
    '-o',
    'IdentitiesOnly=yes',
  ];
}

function selfCheck() {
  const dir = ensureCacheDir();
  const loose = path.join(dir, `loose-${process.pid}.pem`);
  fs.writeFileSync(
    loose,
    '-----BEGIN RSA PRIVATE KEY-----\nMIIB loose-test\n-----END RSA PRIVATE KEY-----\n',
    { mode: 0o644 }
  );
  try {
    fs.chmodSync(loose, 0o644);
  } catch {
    /* ignore */
  }

  const { path: secured, cleanup } = materializeIdentityFile(loose);
  try {
    const mode = fs.statSync(secured).mode & 0o777;
    const body = fs.readFileSync(secured, 'utf8');
    if (!body.includes('BEGIN RSA PRIVATE KEY')) {
      throw new Error('temp identity missing key contents');
    }
    if (process.platform !== 'win32' && mode !== 0o600) {
      throw new Error(`expected mode 600, got ${mode.toString(8)}`);
    }
    const args = sshIdentityArgs(secured);
    if (!args.includes('-i') || !args.includes(secured)) {
      throw new Error('sshIdentityArgs missing -i path');
    }
    if (!args.includes('IdentityFile=none')) {
      throw new Error('sshIdentityArgs missing IdentityFile=none');
    }
    console.log('sshSessionIdentity self-check ok');
  } finally {
    cleanup();
    try {
      fs.unlinkSync(loose);
    } catch {
      /* ignore */
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selfCheck();
}
