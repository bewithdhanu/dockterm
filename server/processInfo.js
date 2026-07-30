import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Resolve the current working directory of a process.
 */
export async function getProcessCwd(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;

  try {
    if (os.platform() === 'linux') {
      return fs.readlinkSync(`/proc/${n}/cwd`);
    }
    if (os.platform() === 'darwin') {
      const { stdout } = await execFileAsync(
        'lsof',
        ['-a', '-p', String(n), '-d', 'cwd', '-Fn'],
        { timeout: 3000 }
      );
      const line = stdout.split('\n').find((l) => l.startsWith('n'));
      if (line) return line.slice(1);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function escapeShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseEtime(etime) {
  // [[dd-]hh:]mm:ss
  const s = String(etime || '').trim();
  if (!s) return 0;
  const daySplit = s.split('-');
  let days = 0;
  let rest = s;
  if (daySplit.length === 2) {
    days = Number(daySplit[0]) || 0;
    rest = daySplit[1];
  }
  const parts = rest.split(':').map(Number);
  if (parts.length === 3) {
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return days * 86400 + parts[0] * 60 + parts[1];
  }
  return 0;
}

function sortByHeavy(rows) {
  return rows.sort((a, b) => {
    const cpu = (b.cpu || 0) - (a.cpu || 0);
    if (cpu !== 0) return cpu;
    return (b.mem || 0) - (a.mem || 0);
  });
}

function parsePsLines(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split('\n')) {
    const m = line
      .trim()
      .match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      cpu: Number(m[2]) || 0,
      mem: (Number(m[3]) || 0) * 1024,
      etime: m[4],
      etimeSec: parseEtime(m[4]),
      name: m[5].trim(),
    });
  }
  return rows;
}

/**
 * List processes on the local host for the Procs panel (heaviest first).
 */
export async function listHostProcesses({ limit = 120 } = {}) {
  try {
    if (os.platform() === 'win32') {
      const { stdout } = await execFileAsync(
        'wmic',
        [
          'process',
          'get',
          'ProcessId,Name,WorkingSetSize,UserModeTime,KernelModeTime',
          '/FORMAT:CSV',
        ],
        { timeout: 5000, windowsHide: true }
      );
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 5) continue;
        const name = parts[1];
        const pid = Number(parts[parts.length - 2]);
        const rss = Number(parts[parts.length - 1]) || 0;
        if (!Number.isFinite(pid)) continue;
        rows.push({
          pid,
          name,
          cpu: 0,
          mem: rss,
          etime: '',
          etimeSec: 0,
        });
      }
      return sortByHeavy(rows).slice(0, limit);
    }

    const { stdout } = await execFileAsync(
      'ps',
      ['-axo', 'pid=,pcpu=,rss=,etime=,comm='],
      { timeout: 5000 }
    );
    return sortByHeavy(parsePsLines(stdout)).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * List processes on a remote host via SSH config alias (heaviest first).
 */
export async function listRemoteProcesses(alias, { limit = 120 } = {}) {
  const host = String(alias || '').trim();
  if (!host || /[\s;|&$`<>]/.test(host)) return [];

  try {
    const script =
      'SUDO=""; if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi; ' +
      '$SUDO ps -axo pid=,pcpu=,rss=,etime=,comm= 2>/dev/null || ps -axo pid=,pcpu=,rss=,etime=,comm=';
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=6',
        host,
        'sh',
        '-c',
        script,
      ],
      { timeout: 10000, maxBuffer: 1024 * 1024, env: process.env }
    );
    return sortByHeavy(parsePsLines(stdout)).slice(0, limit);
  } catch {
    return [];
  }
}

function parsePortFromAddr(addr) {
  const s = String(addr || '').trim();
  // *:3001, 127.0.0.1:5173, [::1]:8080, :::80, 0.0.0.0:22
  const m = s.match(/:(\d+)\s*$/);
  if (m) return Number(m[1]);
  return null;
}

function portKey(row) {
  return `${row.port}|${row.address || ''}|${row.proto || 'TCP'}`;
}

function mergePortRows(...lists) {
  /** @type {Map<string, { port: number, proto: string, pid: number, name: string, address: string }>} */
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (!row || !Number.isInteger(row.port)) continue;
      const key = portKey(row);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...row });
        continue;
      }
      // Prefer rows that include process identity.
      if ((!prev.pid || prev.pid <= 0) && row.pid > 0) {
        prev.pid = row.pid;
        prev.name = row.name || prev.name;
      } else if (
        prev.pid > 0 &&
        row.pid > 0 &&
        (!prev.name || prev.name === '—') &&
        row.name &&
        row.name !== '—'
      ) {
        prev.name = row.name;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

function parseLsofListen(stdout) {
  /** @type {Map<string, { port: number, proto: string, pid: number, name: string, address: string }>} */
  const map = new Map();
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (/^COMMAND\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const name = parts[0];
    const pid = Number(parts[1]);
    const proto = String(parts[7] || 'TCP').toUpperCase();
    const address = parts.slice(8).join(' ').replace(/\s*\(LISTEN\)\s*$/i, '');
    const port = parsePortFromAddr(address);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port)) continue;
    const key = `${port}:${pid}:${proto}:${address}`;
    if (!map.has(key)) {
      map.set(key, { port, proto, pid, name, address });
    }
  }
  return [...map.values()];
}

function parseSsListen(stdout) {
  /** @type {Map<string, { port: number, proto: string, pid: number, name: string, address: string }>} */
  const map = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^State\b/i.test(trimmed) || /^Netid\b/i.test(trimmed)) continue;
    // ss -tln: "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*"
    // ss -tlnp: same + users:((...))
    // ss -ltn with Netid: "tcp LISTEN 0 128 ..."
    if (!/\bLISTEN\b/i.test(trimmed) && !/^LISTEN\b/i.test(trimmed)) continue;

    const users = trimmed.match(/users:\(\((.+)\)\)/);
    const withoutUsers = trimmed.replace(/\s*users:\(\(.*$/, '').trim();
    const parts = withoutUsers.split(/\s+/);
    if (parts.length < 4) continue;

    let proto = 'TCP';
    let address = '';
    if (/^(tcp|udp|tcp6|udp6)$/i.test(parts[0])) {
      proto = parts[0].toUpperCase().replace(/6$/, '');
      // tcp LISTEN Recv-Q Send-Q Local Peer
      address = parts[4] || parts[3] || '';
    } else if (/^LISTEN$/i.test(parts[0])) {
      address = parts[3] || '';
    } else {
      continue;
    }

    const port = parsePortFromAddr(address);
    let pid = 0;
    let name = '';
    if (users) {
      const m = users[1].match(/"?([^",]+)"?,pid=(\d+)/);
      if (m) {
        name = m[1];
        pid = Number(m[2]);
      }
    }
    if (!Number.isInteger(port)) continue;
    const key = `${port}:${pid || 0}:${proto}:${address}`;
    if (!map.has(key)) {
      map.set(key, {
        port,
        proto,
        pid: pid || 0,
        name: name || '—',
        address,
      });
    }
  }
  return [...map.values()];
}

function parseNetstatListen(stdout) {
  /** @type {Map<string, { port: number, proto: string, pid: number, name: string, address: string }>} */
  const map = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line
      .trim()
      .match(/^(tcp6?|udp6?)\s+\d+\s+\d+\s+(\S+)\s+\S+\s+LISTEN(?:ING)?(?:\s+(\d+)\/(\S+))?/i);
    if (!m) {
      // macOS netstat: tcp4 0 0 *.22 *.* LISTEN
      const mac = line
        .trim()
        .match(/^(tcp[46]?)\s+\d+\s+\d+\s+(\S+)\s+\S+\s+LISTEN\b/i);
      if (!mac) continue;
      const address = mac[2].replace(/^\*\./, '*:');
      const port = parsePortFromAddr(
        address.includes(':') ? address : address.replace('*', '*:')
      );
      // *.22 style
      let p = port;
      if (!p) {
        const star = address.match(/\*\.(\d+)$/);
        if (star) p = Number(star[1]);
      }
      if (!Number.isInteger(p)) continue;
      const key = `${p}:0:TCP:${address}`;
      if (!map.has(key)) {
        map.set(key, {
          port: p,
          proto: 'TCP',
          pid: 0,
          name: '—',
          address,
        });
      }
      continue;
    }
    const proto = m[1].toUpperCase().replace(/6$/, '');
    const address = m[2];
    const port = parsePortFromAddr(address);
    const pid = m[3] ? Number(m[3]) : 0;
    const name = m[4] || '—';
    if (!Number.isInteger(port)) continue;
    const key = `${port}:${pid || 0}:${proto}:${address}`;
    if (!map.has(key)) {
      map.set(key, { port, proto, pid: pid || 0, name, address });
    }
  }
  return [...map.values()];
}

/**
 * Full listen table from ss/netstat (visible system-wide without root),
 * then enrich with process names from lsof/ss -p when permitted.
 */
async function collectUnixPorts(run) {
  const inventory = [];
  const enriched = [];

  // 1) Complete listen inventory — does not require root.
  for (const cmd of [
    ['ss', ['-H', '-tln']],
    ['ss', ['-tln']],
    ['netstat', ['-lnt']],
    ['netstat', ['-an', '-p', 'tcp']],
  ]) {
    try {
      const { stdout } = await run(cmd[0], cmd[1]);
      const rows = /\bss\b|State|LISTEN/i.test(String(stdout || ''))
        ? [
            ...parseSsListen(stdout),
            ...parseNetstatListen(stdout),
          ]
        : parseNetstatListen(stdout);
      if (rows.length) {
        inventory.push(...rows);
        break;
      }
    } catch {
      /* try next */
    }
  }

  // 2) Process enrichment — often limited to the current user without root.
  for (const cmd of [
    ['sudo', ['-n', 'ss', '-H', '-tlnp']],
    ['sudo', ['-n', 'ss', '-tlnp']],
    ['sudo', ['-n', 'lsof', '-nP', '-iTCP', '-sTCP:LISTEN']],
    ['lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']],
    ['ss', ['-H', '-tlnp']],
    ['ss', ['-tlnp']],
  ]) {
    try {
      const { stdout } = await run(cmd[0], cmd[1]);
      const rows =
        cmd[0] === 'lsof' || (cmd[0] === 'sudo' && cmd[1]?.includes('lsof'))
          ? parseLsofListen(stdout)
          : parseSsListen(stdout);
      if (rows.length) {
        enriched.push(...rows);
        // Prefer sudo results; stop once we have PIDs.
        if (rows.some((r) => r.pid > 0)) break;
      }
    } catch {
      /* try next */
    }
  }

  const ports = mergePortRows(inventory, enriched);
  const withPid = ports.filter((p) => p.pid > 0).length;
  let portsNote = null;
  if (ports.length > 0 && withPid === 0) {
    portsNote =
      'Ports are visible, but PIDs need root (common for :80/:443). Enable passwordless sudo for ss/lsof.';
  } else if (ports.length > withPid && withPid > 0) {
    portsNote =
      'Some PIDs hidden — those listeners are owned by another user/root.';
  } else if (inventory.length === 0 && enriched.length > 0) {
    portsNote =
      'Showing only processes visible to this user. System services owned by root may be missing.';
  }

  return { ports, portsNote };
}

async function listLocalPortsUnix() {
  const run = async (file, args) =>
    execFileAsync(file, args, {
      timeout: 6000,
      maxBuffer: 2 * 1024 * 1024,
    });
  return collectUnixPorts(run);
}

async function listLocalPortsWin() {
  try {
    const { stdout } = await execFileAsync(
      'netstat',
      ['-ano', '-p', 'tcp'],
      { timeout: 6000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    );
    /** @type {Map<string, { port: number, proto: string, pid: number, name: string, address: string }>} */
    const map = new Map();
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const m = line
        .trim()
        .match(/^TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!m) continue;
      const address = m[1];
      const pid = Number(m[2]);
      const port = parsePortFromAddr(address);
      if (!Number.isInteger(port) || !Number.isInteger(pid)) continue;
      const key = `${port}:${pid}`;
      if (!map.has(key)) {
        map.set(key, {
          port,
          proto: 'TCP',
          pid,
          name: `pid ${pid}`,
          address,
        });
      }
    }
    return {
      ports: [...map.values()].sort((a, b) => a.port - b.port || a.pid - b.pid),
      portsNote: null,
    };
  } catch {
    return { ports: [], portsNote: null };
  }
}

/** Listening TCP ports on the local machine. */
export async function listHostPorts() {
  if (os.platform() === 'win32') return listLocalPortsWin();
  return listLocalPortsUnix();
}

/** Listening TCP ports on a remote host via SSH. */
export async function listRemotePorts(alias) {
  const host = String(alias || '').trim();
  if (!host || /[\s;|&$`<>]/.test(host)) {
    return { ports: [], portsNote: null };
  }

  // One SSH round-trip: inventory (ss/netstat) + enrichment (lsof/ss -p).
  // IMPORTANT: do not stop at lsof alone — without root it only shows the
  // current user's listeners and hides nginx/docker/system ports.
  // Port 80/443/etc. are usually root-owned: ss -tln shows the port, but
  // PID/name need ss -tlnp / lsof as root (try passwordless sudo -n).
  const remoteScript = [
    'echo "__DT_INV__"',
    '(ss -H -tln 2>/dev/null || ss -tln 2>/dev/null || netstat -lnt 2>/dev/null || netstat -tln 2>/dev/null || true)',
    'echo "__DT_ENR__"',
    '(' +
      'sudo -n ss -H -tlnp 2>/dev/null || ' +
      'sudo -n ss -tlnp 2>/dev/null || ' +
      'sudo -n lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || ' +
      'ss -H -tlnp 2>/dev/null || ' +
      'ss -tlnp 2>/dev/null || ' +
      'lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || ' +
      'true' +
      ')',
  ].join('; ');

  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=6',
        host,
        remoteScript,
      ],
      { timeout: 15000, maxBuffer: 3 * 1024 * 1024, env: process.env }
    );
    const text = String(stdout || '');
    const invIdx = text.indexOf('__DT_INV__');
    const enrIdx = text.indexOf('__DT_ENR__');
    let invText = text;
    let enrText = '';
    if (invIdx >= 0 && enrIdx >= 0) {
      invText = text.slice(invIdx + '__DT_INV__'.length, enrIdx);
      enrText = text.slice(enrIdx + '__DT_ENR__'.length);
    }

    const inventory = [
      ...parseSsListen(invText),
      ...parseNetstatListen(invText),
    ];
    const enriched = [
      ...parseLsofListen(enrText),
      ...parseSsListen(enrText),
    ];
    const ports = mergePortRows(inventory, enriched);
    const withPid = ports.filter((p) => p.pid > 0).length;
    let portsNote = null;
    if (inventory.length === 0 && enriched.length > 0) {
      portsNote =
        'Only listeners owned by this SSH user are visible (lsof without root). System ports may be missing.';
    } else if (ports.length > 0 && withPid === 0) {
      portsNote =
        'Ports are visible, but PIDs need root (e.g. nginx on :80). Enable passwordless sudo for ss/lsof, or SSH as root.';
    } else if (ports.length > withPid && withPid > 0) {
      portsNote =
        'Some PIDs hidden — those listeners are owned by another user/root. Passwordless sudo unlocks them.';
    } else if (ports.length === 0) {
      portsNote =
        'No listening TCP ports found (or ss/netstat/lsof unavailable on the remote host).';
    }

    return { ports, portsNote };
  } catch {
    return {
      ports: [],
      portsNote: 'Could not list remote ports (SSH command failed).',
    };
  }
}

/** PIDs listening on a local TCP port. */
export async function pidsForLocalPort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return [];

  if (os.platform() === 'win32') {
    const { ports } = await listLocalPortsWin();
    return [
      ...new Set(
        ports.filter((p) => p.port === n && p.pid > 0).map((p) => p.pid)
      ),
    ];
  }

  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${n}`, '-sTCP:LISTEN', '-t'],
      { timeout: 5000 }
    );
    const fromLsof = [
      ...new Set(
        String(stdout || '')
          .split(/\s+/)
          .map((x) => Number(x))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
      ),
    ];
    if (fromLsof.length) return fromLsof;
  } catch {
    /* fall through */
  }

  const { ports } = await listLocalPortsUnix();
  return [
    ...new Set(
      ports.filter((p) => p.port === n && p.pid > 0).map((p) => p.pid)
    ),
  ];
}

export function resolveExistingCwd(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  const expanded = candidate.startsWith('~/')
    ? path.join(os.homedir(), candidate.slice(2))
    : candidate === '~'
      ? os.homedir()
      : candidate;
  try {
    if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
      return expanded;
    }
  } catch {
    /* ignore */
  }
  return null;
}
