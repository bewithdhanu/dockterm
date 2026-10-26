import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Saved SSH passwords for DockTerm hosts.
 * Stored next to ~/.ssh/config, mode 0600. OpenSSH does not read this file.
 */

function storePath() {
  if (process.env.DOCKTERM_PASSWORD_FILE) {
    return process.env.DOCKTERM_PASSWORD_FILE;
  }
  return path.join(os.homedir(), '.ssh', 'dockterm-passwords.json');
}

function readStore() {
  const file = storePath();
  try {
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeStore(data) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
}

function keyFor(sshAlias) {
  return String(sshAlias || '').trim();
}

export function getHostPassword(sshAlias) {
  const key = keyFor(sshAlias);
  if (!key) return null;
  const value = readStore()[key];
  return typeof value === 'string' && value ? value : null;
}

export function hasHostPassword(sshAlias) {
  return Boolean(getHostPassword(sshAlias));
}

export function setHostPassword(sshAlias, password) {
  const key = keyFor(sshAlias);
  const secret = String(password ?? '');
  if (!key) throw new Error('Host is required');
  if (!secret) throw new Error('Password is required');
  if (/[\r\n\0]/.test(secret)) {
    throw new Error('Password cannot contain line breaks');
  }
  const data = readStore();
  data[key] = secret;
  writeStore(data);
}

export function deleteHostPassword(sshAlias) {
  const key = keyFor(sshAlias);
  if (!key) return;
  const data = readStore();
  if (!(key in data)) return;
  delete data[key];
  writeStore(data);
}

export function renameHostPassword(fromAlias, toAlias) {
  const from = keyFor(fromAlias);
  const to = keyFor(toAlias);
  if (!from || !to || from === to) return;
  const data = readStore();
  if (!(from in data)) return;
  data[to] = data[from];
  delete data[from];
  writeStore(data);
}

function selfCheck() {
  const file = path.join(
    os.tmpdir(),
    `dockterm-pw-${process.pid}.json`
  );
  process.env.DOCKTERM_PASSWORD_FILE = file;
  try {
    setHostPassword('web', 's3cret');
    if (getHostPassword('web') !== 's3cret') {
      throw new Error('password round-trip failed');
    }
    if ((fs.statSync(file).mode & 0o777) !== 0o600 && process.platform !== 'win32') {
      throw new Error('password file is not mode 600');
    }
    renameHostPassword('web', 'web2');
    if (getHostPassword('web2') !== 's3cret' || getHostPassword('web')) {
      throw new Error('password rename failed');
    }
    deleteHostPassword('web2');
    if (hasHostPassword('web2')) throw new Error('password delete failed');
    console.log('hostPasswords self-check ok');
  } finally {
    delete process.env.DOCKTERM_PASSWORD_FILE;
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selfCheck();
}
