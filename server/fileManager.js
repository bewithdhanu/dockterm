import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import {
  prepareIdentityForAlias,
  sshIdentityArgs,
} from './sshSessionIdentity.js';
import { resolveSshConnectTarget } from './sshConfig.js';

const execFileAsync = promisify(execFile);

function assertSafePath(p) {
  const s = String(p || '').trim();
  if (!s) throw new Error('Path is required');
  if (s.includes('\0')) throw new Error('Invalid path');
  return s;
}

function basename(p) {
  const s = String(p || '').replace(/[/\\]+$/, '');
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

function parentPath(p) {
  const s = String(p || '').replace(/[/\\]+$/, '') || '/';
  if (s === '/' || /^[A-Za-z]:[/\\]?$/.test(s)) return s;
  const dir = path.posix.dirname(s.replace(/\\/g, '/'));
  // Preserve Windows drive paths when local
  if (/^[A-Za-z]:/.test(s)) {
    return path.dirname(s);
  }
  return dir || '/';
}

function joinPath(base, name) {
  if (/^[A-Za-z]:/.test(base) || base.includes('\\')) {
    return path.join(base, name);
  }
  return path.posix.join(base.replace(/\\/g, '/'), name);
}

function modeToString(mode) {
  const m = mode & 0o777;
  return m.toString(8).padStart(3, '0');
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Run a remote argv command (preferred) or a shell string via sh -c.
 * Remote side uses only POSIX shell / coreutils — no Python/Node required.
 * @param {string} alias
 * @param {string | string[]} remote
 */
async function sshExec(alias, remote, { timeout = 60000 } = {}) {
  const target = resolveSshConnectTarget(alias);
  let prepared = null;
  try {
    prepared = prepareIdentityForAlias(target);
  } catch {
    prepared = null;
  }
  const sshBin =
    os.platform() === 'win32'
      ? 'ssh'
      : fs.existsSync('/usr/bin/ssh')
        ? '/usr/bin/ssh'
        : 'ssh';

  const remoteArgv = Array.isArray(remote)
    ? remote
    : ['sh', '-c', String(remote)];

  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=12',
    '-o',
    'ConnectionAttempts=1',
    ...sshIdentityArgs(prepared?.path),
    target,
    ...remoteArgv,
  ];
  try {
    const { stdout, stderr } = await execFileAsync(sshBin, args, {
      timeout,
      maxBuffer: 12 * 1024 * 1024,
      env: process.env,
      encoding: 'utf8',
    });
    return { stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (err) {
    const msg =
      (err && err.stderr && String(err.stderr).trim()) ||
      (err && err.stdout && String(err.stdout).trim()) ||
      (err instanceof Error ? err.message : String(err));
    throw new Error(
      msg.split('\n').filter(Boolean).pop() || 'SSH command failed'
    );
  } finally {
    try {
      prepared?.cleanup?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Portable remote directory listing (GNU/BSD/BusyBox-ish).
 * Lines: type\\tsize\\tmtimeMs\\tmode\\tbase64(name)
 * Path is embedded (not $1) — OpenSSH runs the remote command via the
 * login shell, so trailing argv after `sh -c` is unreliable.
 */
function remoteListScript(root) {
  return `
set -e
cd -- ${shellQuote(root)} || exit 1
if stat -c '%s' . >/dev/null 2>&1; then
  sz() { stat -c '%s' "$1" 2>/dev/null || echo 0; }
  mt() { stat -c '%Y' "$1" 2>/dev/null || echo 0; }
  md() { stat -c '%a' "$1" 2>/dev/null || echo 644; }
elif stat -f '%z' . >/dev/null 2>&1; then
  sz() { stat -f '%z' "$1" 2>/dev/null || echo 0; }
  mt() { stat -f '%m' "$1" 2>/dev/null || echo 0; }
  md() { stat -f '%OLp' "$1" 2>/dev/null || echo 644; }
else
  sz() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
  mt() { echo 0; }
  md() { echo 644; }
fi
b64() {
  if command -v base64 >/dev/null 2>&1; then
    if base64 --help 2>&1 | grep -q -- '-w'; then
      printf '%s' "$1" | base64 -w 0
    else
      printf '%s' "$1" | base64 | tr -d '\\n'
    fi
  elif command -v openssl >/dev/null 2>&1; then
    printf '%s' "$1" | openssl base64 2>/dev/null | tr -d '\\n'
  else
    printf '%s' "$1" | sed 's/ /_/g'
  fi
}
for f in .* *; do
  [ "$f" = "." ] && continue
  [ "$f" = ".." ] && continue
  if [ ! -e "$f" ] && [ ! -L "$f" ]; then continue; fi
  if [ -d "$f" ]; then t=d; else t=f; fi
  size=$(sz "$f")
  mtime=$(mt "$f")
  mode=$(md "$f")
  mtime_ms=$((mtime * 1000))
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$t" "$size" "$mtime_ms" "$mode" "$(b64 "$f")"
done
`.trim();
}

function parseRemoteList(stdout, root) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const [t, size, mtime, mode, b64name] = parts;
    let name;
    try {
      name = Buffer.from(b64name, 'base64').toString('utf8');
    } catch {
      name = b64name;
    }
    if (!name || name === '.' || name === '..') continue;
    out.push({
      name,
      path: joinPath(root, name),
      isDirectory: t === 'd',
      size: Number(size) || 0,
      modified: Number(mtime) || 0,
      mode: String(mode || '644').replace(/\D/g, '').slice(-4) || '644',
    });
  }
  out.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return out;
}

async function listLocal(dirPath) {
  const root = assertSafePath(dirPath);
  const st = await fsp.stat(root);
  if (!st.isDirectory()) throw new Error('Not a directory');
  const names = await fsp.readdir(root);
  const out = [];
  for (const name of names.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  )) {
    const full = path.join(root, name);
    try {
      const lst = await fsp.lstat(full);
      let isDirectory = lst.isDirectory();
      if (lst.isSymbolicLink()) {
        try {
          isDirectory = (await fsp.stat(full)).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      out.push({
        name,
        path: full,
        isDirectory,
        size: lst.size,
        modified: Math.floor(lst.mtimeMs),
        mode: modeToString(lst.mode),
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

async function listRemote(alias, dirPath) {
  const root = assertSafePath(dirPath);
  const { stdout } = await sshExec(alias, remoteListScript(root), {
    timeout: 45000,
  });
  return parseRemoteList(stdout, root);
}

async function expandRemotePath(alias, p) {
  const raw = String(p || '').trim();
  if (!raw || raw === 'null' || raw === 'undefined') {
    return expandRemotePath(alias, '~');
  }
  if (raw !== '~' && !raw.startsWith('~/')) return raw;
  // Prefer shell HOME (works when printenv is missing); avoid empty cd.
  const { stdout } = await sshExec(
    alias,
    'h=$(printenv HOME 2>/dev/null || true); [ -n "$h" ] || h=$HOME; [ -n "$h" ] || h=/; printf %s "$h"'
  );
  const home = stdout.trim().replace(/\/+$/, '') || '/';
  if (raw === '~') return home;
  return `${home}/${raw.slice(2)}`;
}

/** Expand ~ on remote paths before any mutating op. */
async function resolveRemotePath(alias, p) {
  return expandRemotePath(alias, assertSafePath(p || '~'));
}

async function isWritableLocal(dir) {
  try {
    await fsp.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function isWritableRemote(alias, dir) {
  try {
    const { stdout } = await sshExec(
      alias,
      `if [ -d ${shellQuote(dir)} ] && [ -w ${shellQuote(dir)} ]; then printf y; else printf n; fi`
    );
    return stdout.trim() === 'y';
  } catch {
    return false;
  }
}

export async function fmList({ sshHost, path: dirPath }) {
  const p = assertSafePath(dirPath || (sshHost ? '~' : os.homedir()));
  if (sshHost) {
    const remotePath = await expandRemotePath(sshHost, p);
    const [entries, writable] = await Promise.all([
      listRemote(sshHost, remotePath),
      isWritableRemote(sshHost, remotePath),
    ]);
    return { path: remotePath, entries, writable };
  }
  const local = p.startsWith('~')
    ? p.replace(/^~(?=$|[/\\])/, os.homedir())
    : p;
  const resolved = path.resolve(local);
  const [entries, writable] = await Promise.all([
    listLocal(resolved),
    isWritableLocal(resolved),
  ]);
  return { path: resolved, entries, writable };
}

export async function fmMkdir({ sshHost, path: parent, name }) {
  const n = String(name || '').trim();
  if (!n || n.includes('/') || n.includes('\\') || n === '.' || n === '..') {
    throw new Error('Invalid folder name');
  }
  if (sshHost) {
    const dest = joinPath(await resolveRemotePath(sshHost, parent), n);
    await sshExec(sshHost, `mkdir -p -- ${shellQuote(dest)}`);
    return { path: dest };
  }
  const dest = joinPath(assertSafePath(parent), n);
  await fsp.mkdir(dest, { recursive: false });
  return { path: dest };
}

export async function fmCreateFile({ sshHost, path: parent, name }) {
  const n = String(name || '').trim();
  if (!n || n.includes('/') || n.includes('\\') || n === '.' || n === '..') {
    throw new Error('Invalid file name');
  }
  if (sshHost) {
    const dest = joinPath(await resolveRemotePath(sshHost, parent), n);
    await sshExec(
      sshHost,
      `set -e; if [ -e ${shellQuote(dest)} ]; then echo EXISTS; exit 1; fi; : > ${shellQuote(dest)}`
    );
    return { path: dest };
  }
  const dest = joinPath(assertSafePath(parent), n);
  const fh = await fsp.open(dest, 'wx');
  await fh.close();
  return { path: dest };
}

export async function fmRename({ sshHost, path: from, newName }) {
  const n = String(newName || '').trim();
  if (!n || n.includes('/') || n.includes('\\')) {
    throw new Error('Invalid name');
  }
  if (sshHost) {
    const src = await resolveRemotePath(sshHost, from);
    const dest = joinPath(parentPath(src), n);
    await sshExec(sshHost, `mv -- ${shellQuote(src)} ${shellQuote(dest)}`);
    return { path: dest };
  }
  const src = assertSafePath(from);
  const dest = joinPath(parentPath(src), n);
  await fsp.rename(src, dest);
  return { path: dest };
}

export async function fmDelete({ sshHost, paths }) {
  const list = paths || [];
  if (!list.length) throw new Error('Nothing to delete');
  if (sshHost) {
    const resolved = [];
    for (const p of list) {
      const rp = await resolveRemotePath(sshHost, p);
      if (rp === '/') throw new Error('Refusing to delete root');
      resolved.push(rp);
    }
    const args = resolved.map(shellQuote).join(' ');
    await sshExec(sshHost, `rm -rf -- ${args}`);
    return { ok: true };
  }
  const localList = list.map(assertSafePath);
  for (const p of localList) {
    if (p === '/' || /^[A-Za-z]:[/\\]?$/.test(p)) {
      throw new Error('Refusing to delete root');
    }
  }
  for (const p of localList) {
    await fsp.rm(p, { recursive: true, force: true });
  }
  return { ok: true };
}

export async function fmChmod({ sshHost, paths, mode }) {
  const m = String(mode || '').trim();
  if (!/^[0-7]{3,4}$/.test(m)) throw new Error('Mode must be octal like 644 or 755');
  const list = paths || [];
  if (!list.length) throw new Error('Nothing to chmod');
  if (sshHost) {
    const resolved = [];
    for (const p of list) resolved.push(await resolveRemotePath(sshHost, p));
    const args = resolved.map(shellQuote).join(' ');
    await sshExec(sshHost, `chmod ${m} -- ${args}`);
    return { ok: true };
  }
  const localList = list.map(assertSafePath);
  const modeNum = parseInt(m, 8);
  for (const p of localList) {
    await fsp.chmod(p, modeNum);
  }
  return { ok: true };
}

export async function fmPaste({ sshHost, paths, destination, operation }) {
  const list = paths || [];
  if (!list.length) throw new Error('Nothing to paste');
  const op = operation === 'move' ? 'move' : 'copy';
  if (sshHost) {
    const destDir = await resolveRemotePath(sshHost, destination);
    for (const item of list) {
      const src = await resolveRemotePath(sshHost, item);
      const dest = joinPath(destDir, basename(src));
      if (op === 'move') {
        await sshExec(sshHost, `mv -- ${shellQuote(src)} ${shellQuote(dest)}`);
      } else {
        await sshExec(
          sshHost,
          `cp -a -- ${shellQuote(src)} ${shellQuote(dest)}`
        );
      }
    }
    return { ok: true };
  }
  const destDir = assertSafePath(destination);
  const localList = list.map(assertSafePath);
  for (const src of localList) {
    const dest = path.join(destDir, path.basename(src));
    if (op === 'move') {
      await fsp.rename(src, dest);
    } else {
      const st = await fsp.lstat(src);
      if (st.isDirectory()) {
        await fsp.cp(src, dest, { recursive: true });
      } else {
        await fsp.copyFile(src, dest);
      }
    }
  }
  return { ok: true };
}

export async function fmArchive({
  sshHost,
  paths,
  destinationDir,
  format,
  archiveName,
}) {
  const listIn = paths || [];
  if (!listIn.length) throw new Error('Select files to archive');
  const fmt = format === 'zip' ? 'zip' : 'tar.gz';
  const base =
    String(archiveName || '').trim() ||
    (listIn.length === 1 ? basename(listIn[0]) : 'archive');
  const safeBase = base.replace(/[/\\]/g, '_');
  const fileName = fmt === 'zip' ? `${safeBase}.zip` : `${safeBase}.tar.gz`;

  if (sshHost) {
    const list = [];
    for (const p of listIn) list.push(await resolveRemotePath(sshHost, p));
    const dir = await resolveRemotePath(sshHost, destinationDir);
    const outPath = joinPath(dir, fileName);
    const parent = parentPath(list[0]);
    for (const p of list) {
      if (parentPath(p) !== parent) {
        throw new Error('Archive items must share the same folder');
      }
    }
    const names = list.map((p) => shellQuote(basename(p))).join(' ');
    if (fmt === 'zip') {
      await sshExec(
        sshHost,
        `cd -- ${shellQuote(parent)} && zip -r ${shellQuote(outPath)} ${names}`
      );
    } else {
      await sshExec(
        sshHost,
        `cd -- ${shellQuote(parent)} && tar -czf ${shellQuote(outPath)} ${names}`
      );
    }
    return { path: outPath, name: fileName };
  }

  const list = listIn.map(assertSafePath);
  const dir = assertSafePath(destinationDir);
  const outPath = joinPath(dir, fileName);
  const parent = path.dirname(list[0]);
  for (const p of list) {
    if (path.dirname(p) !== parent) {
      throw new Error('Archive items must share the same folder');
    }
  }
  const rels = list.map((p) => path.basename(p));
  if (fmt === 'zip') {
    await execFileAsync('zip', ['-r', outPath, ...rels], {
      cwd: parent,
      timeout: 120000,
    });
  } else {
    await execFileAsync('tar', ['-czf', outPath, ...rels], {
      cwd: parent,
      timeout: 120000,
    });
  }
  return { path: outPath, name: fileName };
}

export async function fmExtract({
  sshHost,
  archivePath,
  mode,
  destinationDir,
}) {
  const lower = String(archivePath || '').toLowerCase();
  const isZip = lower.endsWith('.zip');
  const isTar =
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar');
  if (!isZip && !isTar) {
    throw new Error('Only .zip and .tar.gz are supported');
  }

  if (sshHost) {
    const src = await resolveRemotePath(sshHost, archivePath);
    let dest = await resolveRemotePath(
      sshHost,
      destinationDir || parentPath(src)
    );
    if (mode === 'folder') {
      const folderName = basename(src).replace(
        /(\.tar\.gz|\.tgz|\.tar|\.zip)$/i,
        ''
      );
      dest = joinPath(
        dest,
        folderName || `extract-${randomBytes(3).toString('hex')}`
      );
      await sshExec(sshHost, `mkdir -p -- ${shellQuote(dest)}`);
    }
    if (isZip) {
      await sshExec(
        sshHost,
        `unzip -o ${shellQuote(src)} -d ${shellQuote(dest)}`
      );
    } else {
      await sshExec(
        sshHost,
        `tar -xzf ${shellQuote(src)} -C ${shellQuote(dest)}`
      );
    }
    return { path: dest };
  }

  const src = assertSafePath(archivePath);
  let dest = assertSafePath(destinationDir || parentPath(src));
  if (mode === 'folder') {
    const folderName = basename(src).replace(/(\.tar\.gz|\.tgz|\.tar|\.zip)$/i, '');
    dest = joinPath(dest, folderName || `extract-${randomBytes(3).toString('hex')}`);
    await fsp.mkdir(dest, { recursive: true });
  }
  if (isZip) {
    await execFileAsync('unzip', ['-o', src, '-d', dest], {
      timeout: 120000,
    });
  } else {
    await execFileAsync('tar', ['-xzf', src, '-C', dest], {
      timeout: 120000,
    });
  }
  return { path: dest };
}

const FM_TRANSFER_MAX = 32 * 1024 * 1024; // ponytail: 32MB ceiling; stream/SFTP later

async function withSshIdentity(alias, fn) {
  const target = resolveSshConnectTarget(alias);
  let prepared = null;
  try {
    prepared = prepareIdentityForAlias(target);
  } catch {
    prepared = null;
  }
  try {
    return await fn(target, prepared?.path || null);
  } finally {
    try {
      prepared?.cleanup?.();
    } catch {
      /* ignore */
    }
  }
}

function scpBin() {
  return os.platform() === 'win32'
    ? 'scp'
    : fs.existsSync('/usr/bin/scp')
      ? '/usr/bin/scp'
      : 'scp';
}

function transferError(err, dest) {
  const raw = [
    err && err.stderr,
    err && err.stdout,
    err instanceof Error ? err.message : String(err),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('\n');
  if (/Permission denied/i.test(raw)) {
    return new Error(
      `Permission denied: ${dest}. Use a folder your SSH user can write, or fix directory permissions on the server.`
    );
  }
  if (/No such file/i.test(raw)) {
    return new Error(`Remote path not found: ${dest}`);
  }
  const last = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Command failed:/i.test(l))
    .pop();
  return new Error(last || 'Transfer failed');
}

export async function fmDownload({ sshHost, path: filePath }) {
  const src = sshHost
    ? await resolveRemotePath(sshHost, filePath)
    : assertSafePath(filePath);
  const name = basename(src);

  if (sshHost) {
    const tmp = path.join(
      os.tmpdir(),
      `dockterm-dl-${randomBytes(6).toString('hex')}`
    );
    try {
      await withSshIdentity(sshHost, async (target, idPath) => {
        try {
          await execFileAsync(
            scpBin(),
            [
              '-o',
              'BatchMode=yes',
              '-o',
              'ConnectTimeout=12',
              ...sshIdentityArgs(idPath),
              `${target}:${src}`,
              tmp,
            ],
            { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
          );
        } catch (err) {
          throw transferError(err, src);
        }
      });
      const st = await fsp.stat(tmp);
      if (st.isDirectory()) throw new Error('Select a file to download');
      if (st.size > FM_TRANSFER_MAX) {
        throw new Error('File too large (max 32 MB)');
      }
      const buf = await fsp.readFile(tmp);
      return {
        name,
        size: buf.length,
        contentBase64: buf.toString('base64'),
      };
    } finally {
      try {
        await fsp.unlink(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  const st = await fsp.stat(src);
  if (st.isDirectory()) throw new Error('Select a file to download');
  if (st.size > FM_TRANSFER_MAX) {
    throw new Error('File too large (max 32 MB)');
  }
  const buf = await fsp.readFile(src);
  return { name, size: buf.length, contentBase64: buf.toString('base64') };
}

export async function fmUpload({ sshHost, path: destDir, name, contentBase64 }) {
  const n = String(name || '').trim();
  if (!n || n.includes('/') || n.includes('\\') || n === '.' || n === '..') {
    throw new Error('Invalid file name');
  }
  let buf;
  try {
    buf = Buffer.from(String(contentBase64 || ''), 'base64');
  } catch {
    throw new Error('Invalid file data');
  }
  if (!buf.length) throw new Error('Empty file');
  if (buf.length > FM_TRANSFER_MAX) {
    throw new Error('File too large (max 32 MB)');
  }

  if (sshHost) {
    const dir = await resolveRemotePath(sshHost, destDir);
    if (!(await isWritableRemote(sshHost, dir))) {
      throw new Error(
        `Permission denied: cannot write to ${dir}. Choose a writable folder (e.g. your home directory).`
      );
    }
    const dest = joinPath(dir, n);
    const tmp = path.join(
      os.tmpdir(),
      `dockterm-ul-${randomBytes(6).toString('hex')}`
    );
    try {
      await fsp.writeFile(tmp, buf, { mode: 0o600 });
      await withSshIdentity(sshHost, async (target, idPath) => {
        try {
          await execFileAsync(
            scpBin(),
            [
              '-o',
              'BatchMode=yes',
              '-o',
              'ConnectTimeout=12',
              ...sshIdentityArgs(idPath),
              tmp,
              `${target}:${dest}`,
            ],
            { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
          );
        } catch (err) {
          throw transferError(err, dest);
        }
      });
    } finally {
      try {
        await fsp.unlink(tmp);
      } catch {
        /* ignore */
      }
    }
    return { path: dest, name: n, size: buf.length };
  }

  const dir = assertSafePath(destDir);
  if (!(await isWritableLocal(dir))) {
    throw new Error(
      `Permission denied: cannot write to ${dir}. Choose a writable folder.`
    );
  }
  const dest = path.join(dir, n);
  try {
    await fsp.writeFile(dest, buf, { flag: 'wx' });
  } catch (err) {
    if (err && err.code === 'EACCES') {
      throw new Error(`Permission denied writing to ${dest}`);
    }
    if (err && err.code === 'EEXIST') {
      throw new Error(`File already exists: ${n}`);
    }
    throw err;
  }
  return { path: dest, name: n, size: buf.length };
}

export function fmHelpers() {
  return { basename, parentPath, joinPath };
}

// Tiny self-check for path helpers
if (process.argv[1] && path.resolve(process.argv[1]).endsWith('fileManager.js')) {
  const a = joinPath('/tmp/demo', 'x.txt');
  if (a !== '/tmp/demo/x.txt') throw new Error('joinPath failed');
  console.log('fileManager helpers ok');
}
