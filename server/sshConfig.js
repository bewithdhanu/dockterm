import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

/**
 * SSH config helpers: list hosts, read/write main ~/.ssh/config,
 * add/update/delete individual Host blocks in the main file.
 *
 * OpenSSH Host tokens cannot contain spaces. DockTerm allows spaced
 * display names and stores them as `# DockTerm-Alias: …` while using a
 * safe internal Host token for `ssh`.
 */

const DOCKTERM_ALIAS_RE = /^#\s*DockTerm-Alias:\s*(.+)$/i;

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
}

/** First OpenSSH config token; supports "quoted paths with spaces". */
export function parseConfigToken(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (s[0] === '"') {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length) {
        out += s[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') return out;
      out += ch;
    }
    return out;
  }

  if (s[0] === "'" && s.length >= 2 && s[s.length - 1] === "'") {
    return s.slice(1, -1);
  }

  return s.split(/\s+/)[0];
}

function formatConfigPathArg(p) {
  if (!p) return null;
  const v = String(p).trim();
  if (!v) return null;
  if (/[\s"']/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

function normalizeIdentityFile(raw) {
  const token = parseConfigToken(raw);
  if (!token) return null;
  return expandHome(token);
}

function isWildcardHost(token) {
  return /[*?]/.test(token);
}

export function getConfigPath() {
  return path.join(os.homedir(), '.ssh', 'config');
}

function ensureSshDir() {
  const dir = path.join(os.homedir(), '.ssh');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function backupConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return null;
  const bak = `${p}.bak.${Date.now()}`;
  fs.copyFileSync(p, bak);
  return bak;
}

export function readRawConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

export function writeRawConfig(content) {
  if (typeof content !== 'string') {
    throw new Error('Config content must be a string');
  }
  // Soft safety: reject NUL
  if (content.includes('\0')) {
    throw new Error('Invalid config content');
  }
  ensureSshDir();
  const bak = backupConfig();
  const p = getConfigPath();
  fs.writeFileSync(p, content, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
  return { path: p, backup: bak };
}

function readConfigFile(filePath, seen = new Set(), sourceLabel = null) {
  const resolved = path.resolve(expandHome(filePath));
  if (seen.has(resolved)) return [];
  if (!fs.existsSync(resolved)) return [];
  seen.add(resolved);

  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch {
    return [];
  }

  const mainPath = path.resolve(getConfigPath());
  const isMain = resolved === mainPath;
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    const trimmed = raw.trim();

    // Full-line DockTerm display-name comment inside a Host block.
    if (current && trimmed.startsWith('#')) {
      const label = trimmed.match(DOCKTERM_ALIAS_RE);
      if (label) {
        current.displayAlias = String(label[1] || '').trim() || null;
        current.endLine = i;
      }
      continue;
    }

    const hash = raw.indexOf('#');
    const code = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (!code) continue;

    const match = code.match(/^(\S+)\s+(.+)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (key === 'include') {
      flush();
      const baseDir = path.dirname(resolved);
      for (const pattern of value.split(/\s+/)) {
        const globPath = path.isAbsolute(expandHome(pattern))
          ? expandHome(pattern)
          : path.join(baseDir, pattern);
        blocks.push(...expandInclude(globPath, seen));
      }
      continue;
    }

    if (key === 'host') {
      flush();
      const hosts = value.split(/\s+/).filter(Boolean);
      current = {
        hosts,
        values: {},
        displayAlias: null,
        sourceFile: resolved,
        isMain,
        startLine: i,
        endLine: i,
        singleAlias: hosts.length === 1 && !isWildcardHost(hosts[0]),
      };
      continue;
    }

    if (key === 'match') {
      flush();
      current = null;
      continue;
    }

    if (current) {
      current.values[key] = value;
      current.endLine = i;
    }
  }
  flush();
  return blocks;
}

function expandInclude(globPath, seen) {
  if (!globPath.includes('*') && !globPath.includes('?')) {
    return readConfigFile(globPath, seen);
  }

  const dir = path.dirname(globPath);
  const base = path.basename(globPath);
  if (!fs.existsSync(dir)) return [];

  const re = new RegExp(
    '^' +
      base
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );

  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (re.test(name)) {
        out.push(...readConfigFile(path.join(dir, name), seen));
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * True if `s` is a single OpenSSH Host token (no spaces / wildcards).
 */
export function isValidSshHostToken(s) {
  const a = String(s || '').trim();
  if (!a || /[\s*?]/.test(a)) return false;
  return /^[A-Za-z0-9._@:+=-]+$/.test(a);
}

/**
 * User-facing host name. Spaces allowed; OpenSSH Host line may differ.
 */
export function validateAlias(alias) {
  const a = String(alias || '').trim().replace(/\s+/g, ' ');
  if (!a) throw new Error('Host alias is required');
  if (/[*?]/.test(a)) {
    throw new Error('Host alias cannot contain wildcards (* or ?)');
  }
  if (/[\r\n#]/.test(a)) {
    throw new Error('Host alias has invalid characters');
  }
  return a;
}

function makeInternalSshAlias(displayAlias) {
  const digest = createHash('sha256')
    .update(String(displayAlias).trim().toLowerCase())
    .digest('hex')
    .slice(0, 12);
  return `dt-${digest}`;
}

/**
 * Pick OpenSSH Host token for a display name.
 * @param {string} displayAlias
 * @param {string | null} [keepSshAlias] preserve on edit when still needed
 */
export function sshAliasForDisplay(displayAlias, keepSshAlias = null) {
  const display = validateAlias(displayAlias);
  if (isValidSshHostToken(display)) return display;
  if (keepSshAlias && isValidSshHostToken(keepSshAlias)) return keepSshAlias;
  return makeInternalSshAlias(display);
}

function sanitizeField(value, label) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/[\r\n#]/.test(v)) {
    throw new Error(`${label} contains invalid characters`);
  }
  return v;
}

function formatHostBlock({
  sshAlias,
  displayAlias,
  hostName,
  user,
  port,
  identityFile,
}) {
  const lines = [`Host ${sshAlias}`];
  if (displayAlias && displayAlias !== sshAlias) {
    lines.push(`  # DockTerm-Alias: ${displayAlias}`);
  }
  if (hostName) lines.push(`  HostName ${hostName}`);
  if (user) lines.push(`  User ${user}`);
  if (port) lines.push(`  Port ${port}`);
  if (identityFile) {
    lines.push(`  IdentityFile ${formatConfigPathArg(identityFile)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @returns {Array<{
 *  alias: string,
 *  sshAlias: string,
 *  hostName: string,
 *  user: string | null,
 *  port: string | null,
 *  identityFile: string | null,
 *  editable: boolean,
 *  sourceFile: string
 * }>}
 */
export function listSshHosts() {
  const configPath = getConfigPath();
  const blocks = readConfigFile(configPath);

  /** @type {Map<string, any>} */
  const hosts = new Map();

  for (const block of blocks) {
    const concrete = block.hosts.filter((h) => !isWildcardHost(h));
    if (concrete.length === 0) continue;

    for (const sshAlias of concrete) {
      if (hosts.has(sshAlias)) continue;
      const display =
        (block.singleAlias && block.displayAlias) || sshAlias;
      hosts.set(sshAlias, {
        alias: display,
        sshAlias,
        hostName: block.values.hostname || sshAlias,
        user: block.values.user || null,
        port: block.values.port || null,
        identityFile: block.values.identityfile
          ? normalizeIdentityFile(block.values.identityfile)
          : null,
        editable: Boolean(block.isMain && block.singleAlias),
        sourceFile: block.sourceFile,
      });
    }
  }

  return [...hosts.values()].sort((a, b) =>
    a.alias.localeCompare(b.alias, undefined, { sensitivity: 'base' })
  );
}

/** @param {string} name display alias or ssh Host token */
export function findSshHost(name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  return (
    listSshHosts().find(
      (h) =>
        h.alias.toLowerCase() === want || h.sshAlias.toLowerCase() === want
    ) || null
  );
}

/** OpenSSH connect target for a display name or Host token. */
export function resolveSshConnectTarget(name) {
  const raw = String(name || '').trim();
  if (!raw) throw new Error('SSH host is required');
  const found = findSshHost(raw);
  if (found) return found.sshAlias;
  if (isValidSshHostToken(raw)) return raw;
  throw new Error(`Unknown SSH host "${raw}"`);
}

function findEditableHostRange(lines, sshAlias) {
  const target = String(sshAlias || '').toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/#.*$/, '').trim();
    const m = code.match(/^Host\s+(.+)$/i);
    if (!m) continue;
    const aliases = m[1].trim().split(/\s+/).filter(Boolean);
    if (aliases.length !== 1 || aliases[0].toLowerCase() !== target) continue;

    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].replace(/#.*$/, '').trim();
      if (/^(Host|Match)\b/i.test(next)) break;
      end = j;
    }
    while (end > i && lines[end].trim() === '') end -= 1;
    return { start: i, end };
  }
  return null;
}

export function upsertHost(input, { originalAlias } = {}) {
  const displayAlias = validateAlias(input.alias);
  const hostName = sanitizeField(input.hostName, 'HostName');
  const user = sanitizeField(input.user, 'User');
  const port = sanitizeField(input.port, 'Port');
  const identityFile = sanitizeField(input.identityFile, 'IdentityFile');

  if (port && !/^\d+$/.test(port)) {
    throw new Error('Port must be a number');
  }

  const existing = listSshHosts();
  const renameFrom = originalAlias
    ? validateAlias(originalAlias)
    : null;
  const old = renameFrom ? findSshHost(renameFrom) : null;

  if (renameFrom && !old) {
    throw new Error(`Host "${renameFrom}" not found`);
  }
  if (old && !old.editable) {
    throw new Error(
      `Host "${renameFrom}" is not editable here (multi-host entry or included file)`
    );
  }

  const conflict = existing.find(
    (h) => h.alias.toLowerCase() === displayAlias.toLowerCase()
  );
  if (
    conflict &&
    (!old || conflict.sshAlias.toLowerCase() !== old.sshAlias.toLowerCase())
  ) {
    throw new Error(`Host "${displayAlias}" already exists`);
  }

  // Keep internal Host token stable across renames when display needs one;
  // if the new display is itself a valid Host token, use it (and rename Host).
  let sshAlias = sshAliasForDisplay(displayAlias, old?.sshAlias || null);
  if (old && !isValidSshHostToken(displayAlias)) {
    sshAlias = old.sshAlias;
  }

  // Avoid Host-token clash with a different entry.
  const tokenClash = existing.find(
    (h) => h.sshAlias.toLowerCase() === sshAlias.toLowerCase()
  );
  if (
    tokenClash &&
    (!old || tokenClash.sshAlias.toLowerCase() !== old.sshAlias.toLowerCase())
  ) {
    // Extremely unlikely hash collision — bump with extra entropy.
    sshAlias = makeInternalSshAlias(`${displayAlias}\0${Date.now()}`);
  }

  ensureSshDir();
  const raw = readRawConfig();
  const lines = raw === '' ? [] : raw.split(/\n/);
  const block = formatHostBlock({
    sshAlias,
    displayAlias,
    hostName,
    user,
    port,
    identityFile,
  }).replace(/\n$/, '');

  if (old) {
    const range = findEditableHostRange(lines, old.sshAlias);
    if (!range) {
      throw new Error(`Could not find editable Host block for "${renameFrom}"`);
    }
    const next = [
      ...lines.slice(0, range.start),
      ...block.split('\n'),
      ...lines.slice(range.end + 1),
    ];
    writeRawConfig(next.join('\n').replace(/\n*$/, '\n'));
  } else {
    const trimmed = raw.replace(/\s*$/, '');
    const next = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
    writeRawConfig(next);
  }

  return listSshHosts().find(
    (h) => h.sshAlias.toLowerCase() === sshAlias.toLowerCase()
  );
}

export function deleteHost(alias) {
  const a = validateAlias(alias);
  const existing = findSshHost(a);
  if (!existing) throw new Error(`Host "${a}" not found`);
  if (!existing.editable) {
    throw new Error(
      `Host "${a}" is not deletable here (multi-host entry or included file)`
    );
  }

  const raw = readRawConfig();
  const lines = raw.split(/\n/);
  const range = findEditableHostRange(lines, existing.sshAlias);
  if (!range) throw new Error(`Could not find Host block for "${a}"`);

  let start = range.start;
  let end = range.end;
  if (end + 1 < lines.length && lines[end + 1].trim() === '') end += 1;
  if (start > 0 && lines[start - 1].trim() === '') start -= 1;

  const next = [...lines.slice(0, start), ...lines.slice(end + 1)];
  writeRawConfig(next.join('\n').replace(/\n*$/, '\n'));
  return { deleted: existing.alias, sshAlias: existing.sshAlias };
}
