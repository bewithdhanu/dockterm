import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * SSH config helpers: list hosts, read/write main ~/.ssh/config,
 * add/update/delete individual Host blocks in the main file.
 */

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
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

function validateAlias(alias) {
  const a = String(alias || '').trim();
  if (!a) throw new Error('Host alias is required');
  if (/[\s*]/.test(a) || a.includes('?')) {
    throw new Error('Host alias cannot contain spaces or wildcards');
  }
  if (!/^[A-Za-z0-9._@:+=-]+$/.test(a)) {
    throw new Error('Host alias has invalid characters');
  }
  return a;
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

function formatHostBlock({ alias, hostName, user, port, identityFile }) {
  const lines = [`Host ${alias}`];
  if (hostName) lines.push(`  HostName ${hostName}`);
  if (user) lines.push(`  User ${user}`);
  if (port) lines.push(`  Port ${port}`);
  if (identityFile) lines.push(`  IdentityFile ${identityFile}`);
  return `${lines.join('\n')}\n`;
}

/**
 * @returns {Array<{
 *  alias: string,
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

    for (const alias of concrete) {
      if (hosts.has(alias)) continue;
      hosts.set(alias, {
        alias,
        hostName: block.values.hostname || alias,
        user: block.values.user || null,
        port: block.values.port || null,
        identityFile: block.values.identityfile
          ? expandHome(block.values.identityfile.split(/\s+/)[0])
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

function findEditableHostRange(lines, alias) {
  const target = alias.toLowerCase();
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
    // Trim trailing blank lines from block end for cleaner replace
    while (end > i && lines[end].trim() === '') end -= 1;
    return { start: i, end };
  }
  return null;
}

export function upsertHost(input, { originalAlias } = {}) {
  const alias = validateAlias(input.alias);
  const hostName = sanitizeField(input.hostName, 'HostName');
  const user = sanitizeField(input.user, 'User');
  const port = sanitizeField(input.port, 'Port');
  const identityFile = sanitizeField(input.identityFile, 'IdentityFile');

  if (port && !/^\d+$/.test(port)) {
    throw new Error('Port must be a number');
  }

  const renameFrom = originalAlias ? validateAlias(originalAlias) : null;
  const existing = listSshHosts();
  const conflict = existing.find(
    (h) => h.alias.toLowerCase() === alias.toLowerCase()
  );
  if (conflict && (!renameFrom || conflict.alias.toLowerCase() !== renameFrom.toLowerCase())) {
    throw new Error(`Host "${alias}" already exists`);
  }

  if (renameFrom) {
    const old = existing.find(
      (h) => h.alias.toLowerCase() === renameFrom.toLowerCase()
    );
    if (!old) throw new Error(`Host "${renameFrom}" not found`);
    if (!old.editable) {
      throw new Error(
        `Host "${renameFrom}" is not editable here (multi-host entry or included file)`
      );
    }
  }

  ensureSshDir();
  const raw = readRawConfig();
  const lines = raw === '' ? [] : raw.split(/\n/);
  // If file ends with \n, last element is ''; keep structure
  const block = formatHostBlock({
    alias,
    hostName,
    user,
    port,
    identityFile,
  }).replace(/\n$/, '');

  if (renameFrom) {
    const range = findEditableHostRange(lines, renameFrom);
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

  return listSshHosts().find((h) => h.alias === alias);
}

export function deleteHost(alias) {
  const a = validateAlias(alias);
  const existing = listSshHosts().find(
    (h) => h.alias.toLowerCase() === a.toLowerCase()
  );
  if (!existing) throw new Error(`Host "${a}" not found`);
  if (!existing.editable) {
    throw new Error(
      `Host "${a}" is not deletable here (multi-host entry or included file)`
    );
  }

  const raw = readRawConfig();
  const lines = raw.split(/\n/);
  const range = findEditableHostRange(lines, a);
  if (!range) throw new Error(`Could not find Host block for "${a}"`);

  let start = range.start;
  let end = range.end;
  // Also remove one surrounding blank line to avoid huge gaps
  if (end + 1 < lines.length && lines[end + 1].trim() === '') end += 1;
  if (start > 0 && lines[start - 1].trim() === '') start -= 1;

  const next = [...lines.slice(0, start), ...lines.slice(end + 1)];
  writeRawConfig(next.join('\n').replace(/\n*$/, '\n'));
  return { deleted: a };
}
