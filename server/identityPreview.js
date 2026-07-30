import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
}

function looksLikePublicKey(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/BEGIN (OPENSSH )?PUBLIC KEY|BEGIN CERTIFICATE/i.test(t)) return true;
  return /^(ssh-|ecdsa-|sk-ssh-|sk-ecdsa-)/m.test(t);
}

function extractPublicKey(filePath) {
  const pubSibling = filePath.endsWith('.pub') ? filePath : `${filePath}.pub`;

  if (fs.existsSync(pubSibling)) {
    const text = fs.readFileSync(pubSibling, 'utf8').trim();
    if (text) return { publicKey: text, source: pubSibling };
  }

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf8');
  if (looksLikePublicKey(raw)) {
    return { publicKey: raw.trim(), source: filePath };
  }

  try {
    const out = execFileSync('ssh-keygen', ['-y', '-f', filePath], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SSH_ASKPASS: '/usr/bin/false', DISPLAY: '' },
    }).trim();
    if (out) return { publicKey: out, source: filePath };
  } catch {
    /* passphrase-protected or not a key */
  }

  return null;
}

function fingerprintFor(filePath) {
  try {
    return execFileSync('ssh-keygen', ['-lf', filePath, '-E', 'sha256'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Safe preview of an IdentityFile: name + public material only (never private key).
 */
export function readIdentityPreview(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('path required');
  }

  const resolved = path.resolve(expandHome(rawPath.trim()));
  const name = path.basename(resolved);
  const exists = fs.existsSync(resolved);

  if (!exists && !fs.existsSync(`${resolved}.pub`)) {
    return {
      name,
      path: resolved,
      exists: false,
      publicKey: null,
      fingerprint: null,
    };
  }

  const extracted = extractPublicKey(resolved);
  const fpTarget =
    extracted?.source ||
    (fs.existsSync(`${resolved}.pub`) ? `${resolved}.pub` : resolved);

  return {
    name,
    path: resolved,
    exists,
    publicKey: extracted?.publicKey || null,
    fingerprint: fingerprintFor(fpTarget),
  };
}
