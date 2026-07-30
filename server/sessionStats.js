import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import { pidsForLocalPort } from './processInfo.js';
import { hasPasswordlessSudo, REMOTE_SUDO_SETUP } from './sudo.js';

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function platformInfo() {
  const plat = os.platform();
  const labels = {
    darwin: 'macOS',
    linux: 'Linux',
    win32: 'Windows',
    freebsd: 'FreeBSD',
  };
  return {
    platform: plat,
    os: `${labels[plat] || plat} ${os.release()}`,
    arch: os.arch(),
    hostname: os.hostname(),
  };
}

async function listProcessTable() {
  const plat = os.platform();
  if (plat === 'win32') {
    const { stdout } = await execFileAsync(
      'wmic',
      [
        'process',
        'get',
        'ProcessId,ParentProcessId,Name,WorkingSetSize,PercentProcessorTime',
        '/FORMAT:CSV',
      ],
      { timeout: 4000, windowsHide: true }
    );
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 6) continue;
      const name = parts[1];
      const ppid = Number(parts[2]);
      const cpu = Number(parts[3]) || 0;
      const pid = Number(parts[parts.length - 2]);
      const rss = Number(parts[parts.length - 1]) || 0;
      if (!Number.isFinite(pid)) continue;
      rows.push({ pid, ppid, cpu, rss, name });
    }
    return rows;
  }

  const { stdout } = await execFileAsync(
    'ps',
    ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm='],
    { timeout: 4000 }
  );
  const rows = [];
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]) || 0,
      rss: (Number(m[4]) || 0) * 1024,
      name: m[5].trim(),
    });
  }
  return rows;
}

function collectTree(rootPid, rows) {
  const byParent = new Map();
  for (const row of rows) {
    if (!byParent.has(row.ppid)) byParent.set(row.ppid, []);
    byParent.get(row.ppid).push(row);
  }
  const out = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const self = rows.find((r) => r.pid === pid);
    if (self) out.push(self);
    for (const child of byParent.get(pid) || []) {
      stack.push(child.pid);
    }
  }
  return out;
}

function readLinuxCpuSample() {
  const text = fs.readFileSync('/proc/stat', 'utf8');
  const parts = text
    .split('\n')[0]
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return { idle, total };
}

async function getLocalCpuPercent() {
  try {
    if (os.platform() === 'linux' && fs.existsSync('/proc/stat')) {
      const a = readLinuxCpuSample();
      await sleep(300);
      const b = readLinuxCpuSample();
      const idle = b.idle - a.idle;
      const total = b.total - a.total;
      if (total > 0) {
        return Math.round(Math.min(100, Math.max(0, (1 - idle / total) * 100)) * 10) / 10;
      }
    }

    // macOS / fallback: sample busy vs idle over a short window via `ps`
    if (os.platform() === 'darwin') {
      const { stdout } = await execFileAsync(
        'ps',
        ['-A', '-o', '%cpu='],
        { timeout: 3000 }
      );
      let sum = 0;
      for (const line of stdout.split('\n')) {
        const n = Number(line.trim());
        if (Number.isFinite(n)) sum += n;
      }
      const ncpu = Math.max(1, os.cpus()?.length || 1);
      return Math.round(Math.min(100, Math.max(0, sum / ncpu)) * 10) / 10;
    }
  } catch {
    /* fall through */
  }

  const load = os.loadavg()[0] || 0;
  const n = Math.max(1, os.cpus()?.length || 1);
  return Math.round(Math.min(100, Math.max(0, (load / n) * 100)) * 10) / 10;
}

async function getLocalDiskStats() {
  try {
    if (os.platform() === 'win32') {
      const { stdout } = await execFileAsync(
        'wmic',
        ['logicaldisk', 'where', 'DeviceID="C:"', 'get', 'Size,FreeSpace', '/FORMAT:CSV'],
        { timeout: 4000, windowsHide: true }
      );
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1]?.split(',') || [];
      const free = Number(last[last.length - 2]) || 0;
      const total = Number(last[last.length - 1]) || 0;
      return { total, free, used: Math.max(0, total - free) };
    }
    const { stdout } = await execFileAsync('df', ['-k', '/'], { timeout: 3000 });
    const lines = stdout.trim().split('\n');
    const parts = lines[lines.length - 1].trim().split(/\s+/);
    const total = (Number(parts[1]) || 0) * 1024;
    const used = (Number(parts[2]) || 0) * 1024;
    const free = (Number(parts[3]) || 0) * 1024;
    return { total, used, free };
  } catch {
    return { total: 0, used: 0, free: 0 };
  }
}

async function getPublicIp() {
  const tries = [
    ['curl', ['-4', '-fsS', '--max-time', '2', 'https://api.ipify.org']],
    ['curl', ['-4', '-fsS', '--max-time', '2', 'https://ifconfig.me/ip']],
    ['curl', ['-4', '-fsS', '--max-time', '2', 'https://icanhazip.com']],
    ['dig', ['+short', 'myip.opendns.com', '@208.67.222.222']],
  ];
  for (const [bin, args] of tries) {
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout: 3500 });
      const ip = String(stdout || '')
        .trim()
        .split(/\s+/)[0];
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {
      /* next */
    }
  }
  return '';
}

/**
 * System stats for a local PTY session.
 */
export async function getProcessTreeStats(rootPid) {
  const info = platformInfo();
  const [disk, publicIp, systemCpu, sudoOk] = await Promise.all([
    getLocalDiskStats(),
    getPublicIp(),
    getLocalCpuPercent(),
    hasPasswordlessSudo(),
  ]);

  const base = {
    ...info,
    pid: rootPid || null,
    cpuPercent: systemCpu,
    diskTotal: disk.total,
    diskUsed: disk.used,
    diskFree: disk.free,
    publicIp,
    sudoOk,
    processCount: 0,
    processes: [],
  };

  if (!rootPid || !Number.isFinite(rootPid)) return base;

  try {
    const rows = await listProcessTable();
    const tree = collectTree(rootPid, rows);
    return {
      ...base,
      processCount: tree.length,
      processes: tree.slice(0, 12).map((r) => ({
        pid: r.pid,
        name: r.name,
        cpu: r.cpu,
        rss: r.rss,
      })),
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { platformInfo };

export async function killPidOnHost(pid, { force = false } = {}) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('Invalid PID');
  }
  if (n === process.pid) {
    throw new Error('Refusing to kill the server process');
  }

  if (os.platform() === 'win32') {
    const args = ['/PID', String(n), '/T'];
    if (force) args.push('/F');
    await execFileAsync('taskkill', args, {
      timeout: 5000,
      windowsHide: true,
    });
    return { ok: true, method: 'taskkill', pid: n };
  }

  const sig = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(n, sig);
    return { ok: true, method: sig, pid: n };
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : null;
    if (code === 'ESRCH') throw new Error(`No process with PID ${n}`);
    if (code !== 'EPERM') throw err;
  }

  // Other user's process — try passwordless sudo.
  if (!(await hasPasswordlessSudo())) {
    throw new Error(
      `Permission denied for PID ${n} (enable passwordless sudo to kill root/system processes)`
    );
  }
  try {
    await execFileAsync(
      'sudo',
      ['-n', 'kill', `-${force ? '9' : 'TERM'}`, String(n)],
      { timeout: 5000 }
    );
    return {
      ok: true,
      method: force ? 'sudo-SIGKILL' : 'sudo-SIGTERM',
      pid: n,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/No such process|ESRCH|No process/i.test(msg)) {
      throw new Error(`No process with PID ${n}`);
    }
    throw new Error(`sudo kill failed for PID ${n}: ${msg.split('\n')[0]}`);
  }
}

/**
 * Kill every process listening on a local TCP port.
 */
export async function killPortOnHost(port, { force = false } = {}) {
  const n = Number(port);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error('Invalid port');
  }

  let pids = await pidsForLocalPort(n);

  // Root-owned listeners often need sudo lsof to discover PIDs.
  if (!pids.length && (await hasPasswordlessSudo())) {
    try {
      const { stdout } = await execFileAsync(
        'sudo',
        ['-n', 'lsof', '-nP', `-iTCP:${n}`, '-sTCP:LISTEN', '-t'],
        { timeout: 5000 }
      );
      pids = [
        ...new Set(
          String(stdout || '')
            .split(/\s+/)
            .map((x) => Number(x))
            .filter((pid) => Number.isInteger(pid) && pid > 0)
        ),
      ];
    } catch {
      /* ignore */
    }
  }

  if (!pids.length) {
    throw new Error(`No process listening on port ${n}`);
  }

  const killed = [];
  const errors = [];
  for (const pid of pids) {
    try {
      const result = await killPidOnHost(pid, { force });
      killed.push(result.pid);
    } catch (err) {
      errors.push(
        `${pid}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!killed.length) {
    throw new Error(errors.join('; ') || `Failed to kill port ${n}`);
  }

  return {
    ok: true,
    method: force ? 'port-SIGKILL' : 'port-SIGTERM',
    port: n,
    pids: killed,
    pid: killed[0],
    error: errors.length ? errors.join('; ') : null,
  };
}

export function killCommandForPty(pid, { force = false, remoteOs = 'unix' } = {}) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('Invalid PID');
  }
  if (remoteOs === 'win32' || remoteOs === 'windows') {
    return `taskkill /PID ${n} /T${force ? ' /F' : ''}\r\n`;
  }
  const sig = force ? '9' : 'TERM';
  // Prefer passwordless sudo when available so root-owned PIDs can be killed.
  return (
    `if sudo -n true 2>/dev/null; then sudo -n kill -${sig} ${n}; ` +
    `else kill -${sig} ${n}; fi\n`
  );
}

/** Shell one-liner to kill listeners on a remote TCP port. */
export function killPortCommandForPty(
  port,
  { force = false, remoteOs = 'unix' } = {}
) {
  const n = Number(port);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error('Invalid port');
  }
  if (remoteOs === 'win32' || remoteOs === 'windows') {
    return (
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${n} ^| findstr LISTENING')` +
      ` do taskkill /PID %a /T${force ? ' /F' : ''}\r\n`
    );
  }
  const sig = force ? 'KILL' : 'TERM';
  return (
    `SUDO=""; if sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi; ` +
    `PIDS=$($SUDO lsof -tiTCP:${n} -sTCP:LISTEN 2>/dev/null || ` +
    `$SUDO fuser ${n}/tcp 2>/dev/null | tr -s ' ' '\\n'); ` +
    `if [ -n "$PIDS" ]; then $SUDO kill -${sig} $PIDS; else echo "No listener on ${n}"; fi\n`
  );
}

/**
 * Kill a PID on a remote host via SSH (uses passwordless sudo when available).
 */
export async function killPidOnRemote(alias, pid, { force = false } = {}) {
  const host = String(alias || '').trim();
  const n = Number(pid);
  if (!host || /[\s;|&$`<>]/.test(host)) throw new Error('Invalid SSH host');
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid PID');

  const sig = force ? '9' : 'TERM';
  const script =
    `${REMOTE_SUDO_SETUP}` +
    `if [ -n "$SUDO" ]; then $SUDO kill -${sig} ${n}; else kill -${sig} ${n}; fi`;

  try {
    await execFileAsync(
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
      { timeout: 10000, env: process.env }
    );
    return {
      ok: true,
      method: force ? 'ssh-sudo-SIGKILL' : 'ssh-sudo-SIGTERM',
      pid: n,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Remote kill failed: ${msg.split('\n')[0]}`);
  }
}

/**
 * Kill listeners on a remote TCP port via SSH (+ sudo -n when available).
 */
export async function killPortOnRemote(alias, port, { force = false } = {}) {
  const host = String(alias || '').trim();
  const n = Number(port);
  if (!host || /[\s;|&$`<>]/.test(host)) throw new Error('Invalid SSH host');
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error('Invalid port');
  }

  const sig = force ? 'KILL' : 'TERM';
  const script =
    `${REMOTE_SUDO_SETUP}` +
    `PIDS=$($SUDO lsof -tiTCP:${n} -sTCP:LISTEN 2>/dev/null || ` +
    `$SUDO fuser ${n}/tcp 2>/dev/null | tr -s ' ' '\\n' || true); ` +
    `if [ -z "$PIDS" ]; then echo "NO_LISTENER"; exit 2; fi; ` +
    `$SUDO kill -${sig} $PIDS; echo "KILLED:$PIDS"`;

  try {
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
      { timeout: 12000, env: process.env }
    );
    const text = String(stdout || '');
    if (/NO_LISTENER/.test(text)) {
      throw new Error(`No process listening on port ${n}`);
    }
    const m = text.match(/KILLED:([^\r\n]+)/);
    const pids = m
      ? m[1]
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((p) => Number.isInteger(p) && p > 0)
      : [];
    return {
      ok: true,
      method: force ? 'ssh-port-SIGKILL' : 'ssh-port-SIGTERM',
      port: n,
      pids,
      pid: pids[0],
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = String(err.message);
      if (/No process listening/.test(msg)) throw err;
      throw new Error(`Remote port kill failed: ${msg.split('\n')[0]}`);
    }
    throw err;
  }
}

/** Compact remote probe: OS, CPU sample, disk, public IP, memory */
const REMOTE_SCRIPT = `
set +e
${REMOTE_SUDO_SETUP}
os_name=\`uname -s 2>/dev/null || echo unknown\`
os_rel=\`uname -r 2>/dev/null || echo\`
os_arch=\`uname -m 2>/dev/null || echo\`
host=\`hostname 2>/dev/null || echo\`
ncpu=\`getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1\`
cpu_pct=0
disk_total=0
disk_used=0
disk_free=0
ram_total=0
ram_free=0
public_ip=
sudo_ok=0
if [ -n "$SUDO" ]; then sudo_ok=1; fi

# CPU: sample /proc/stat when available (readable without root)
if [ -r /proc/stat ]; then
  read1=\`awk '/^cpu / {print \$2+\$3+\$4+\$5+\$6+\$7+\$8+\$9+\$10+\$11; print \$5+\$6}' /proc/stat\`
  t1=\`echo "\$read1" | sed -n '1p'\`
  i1=\`echo "\$read1" | sed -n '2p'\`
  sleep 0.35
  read2=\`awk '/^cpu / {print \$2+\$3+\$4+\$5+\$6+\$7+\$8+\$9+\$10+\$11; print \$5+\$6}' /proc/stat\`
  t2=\`echo "\$read2" | sed -n '1p'\`
  i2=\`echo "\$read2" | sed -n '2p'\`
  dt=\`expr \$t2 - \$t1 2>/dev/null || echo 0\`
  di=\`expr \$i2 - \$i1 2>/dev/null || echo 0\`
  if [ "\$dt" -gt 0 ] 2>/dev/null; then
    cpu_pct=\`awk -v dt="\$dt" -v di="\$di" 'BEGIN { printf "%.1f", (1 - di/dt) * 100 }'\`
  fi
elif command -v top >/dev/null 2>&1; then
  cpu_pct=\`$SUDO top -bn1 2>/dev/null | awk -F'[, ]+' '/Cpu/ { for(i=1;i<=NF;i++) if(\$i ~ /id/) { gsub(/[^0-9.]/,"",\$(i-1)); print 100-\$(i-1); exit } }'\`
fi
if [ -z "\$cpu_pct" ]; then cpu_pct=0; fi

# Disk for root filesystem (sudo helps on restricted mounts)
if command -v df >/dev/null 2>&1; then
  df_line=\`$SUDO df -kP / 2>/dev/null | tail -1\`
  if [ -z "\$df_line" ]; then
    df_line=\`df -kP / 2>/dev/null | tail -1\`
  fi
  if [ -n "\$df_line" ]; then
    disk_total=\`echo "\$df_line" | awk '{print \$2 * 1024}'\`
    disk_used=\`echo "\$df_line" | awk '{print \$3 * 1024}'\`
    disk_free=\`echo "\$df_line" | awk '{print \$4 * 1024}'\`
  fi
fi

# Memory
if [ -r /proc/meminfo ]; then
  ram_total=\`awk '/^MemTotal:/ {print \$2 * 1024}' /proc/meminfo\`
  ram_free=\`awk '/^MemAvailable:/ {print \$2 * 1024}' /proc/meminfo\`
  if [ -z "\$ram_free" ] || [ "\$ram_free" = "0" ]; then
    ram_free=\`awk '/^MemFree:/ {print \$2 * 1024}' /proc/meminfo\`
  fi
elif command -v sysctl >/dev/null 2>&1; then
  ram_total=\`sysctl -n hw.memsize 2>/dev/null || echo 0\`
fi

# Public IP (best-effort, short timeouts)
for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
  if command -v curl >/dev/null 2>&1; then
    public_ip=\`curl -4 -fsS --max-time 2 "\$url" 2>/dev/null | tr -d '\\r' | head -1\`
  elif command -v wget >/dev/null 2>&1; then
    public_ip=\`wget -qO- --timeout=2 "\$url" 2>/dev/null | tr -d '\\r' | head -1\`
  fi
  case "\$public_ip" in
    *[!0-9.]*|"") public_ip= ;;
    *) break ;;
  esac
done

printf 'OS_NAME=%s\\n' "\$os_name"
printf 'OS_REL=%s\\n' "\$os_rel"
printf 'OS_ARCH=%s\\n' "\$os_arch"
printf 'HOST=%s\\n' "\$host"
printf 'CPU_PCT=%s\\n' "\$cpu_pct"
printf 'NCPU=%s\\n' "\$ncpu"
printf 'DISK_TOTAL=%s\\n' "\$disk_total"
printf 'DISK_USED=%s\\n' "\$disk_used"
printf 'DISK_FREE=%s\\n' "\$disk_free"
printf 'RAM_TOTAL=%s\\n' "\$ram_total"
printf 'RAM_FREE=%s\\n' "\$ram_free"
printf 'PUBLIC_IP=%s\\n' "\$public_ip"
printf 'SUDO_OK=%s\\n' "\$sudo_ok"
`;

/** @type {Map<string, { at: number, value: any }>} */
const remoteCache = new Map();
const REMOTE_CACHE_MS = 2000;

function mapRemotePlatform(osName) {
  const n = String(osName || '').toLowerCase();
  if (n.includes('darwin') || n.includes('mac')) return 'darwin';
  if (n.includes('linux')) return 'linux';
  if (n.includes('win')) return 'win32';
  if (n.includes('freebsd')) return 'freebsd';
  return 'unix';
}

function labelRemoteOs(osName, release) {
  const n = String(osName || 'unknown');
  const labels = {
    Darwin: 'macOS',
    Linux: 'Linux',
    FreeBSD: 'FreeBSD',
    Windows: 'Windows',
  };
  const label = labels[n] || n;
  return release ? `${label} ${release}` : label;
}

/**
 * Probe remote host via the same SSH config alias used by the session.
 */
export async function getRemoteSshStats(alias) {
  const host = String(alias || '').trim();
  if (!host || /[\s;|&$`<>]/.test(host)) {
    throw new Error('Invalid SSH host alias');
  }

  const cached = remoteCache.get(host);
  if (cached && Date.now() - cached.at < REMOTE_CACHE_MS) {
    return cached.value;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=6',
        '-o',
        'ServerAliveInterval=3',
        host,
        'sh',
        '-c',
        REMOTE_SCRIPT,
      ],
      {
        timeout: 12000,
        maxBuffer: 256 * 1024,
        env: process.env,
      }
    );

    const text = `${stdout || ''}\n${stderr || ''}`;
    const fields = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) fields[m[1]] = m[2].trim();
    }

    if (!fields.OS_NAME || fields.OS_NAME === 'unknown') {
      const retry = await execFileAsync(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=6',
          host,
          'uname -s; uname -r; uname -m; hostname',
        ],
        { timeout: 8000, maxBuffer: 64 * 1024, env: process.env }
      );
      const parts = String(retry.stdout || '')
        .trim()
        .split(/\r?\n/);
      fields.OS_NAME = parts[0] || 'unknown';
      fields.OS_REL = parts[1] || '';
      fields.OS_ARCH = parts[2] || '';
      fields.HOST = parts[3] || '';
    }

    const cpu = Number(fields.CPU_PCT);
    const value = {
      remote: true,
      sshHost: host,
      platform: mapRemotePlatform(fields.OS_NAME),
      os: labelRemoteOs(fields.OS_NAME, fields.OS_REL),
      arch: fields.OS_ARCH || '',
      hostname: fields.HOST || host,
      cpuPercent: Number.isFinite(cpu)
        ? Math.round(Math.min(100, Math.max(0, cpu)) * 10) / 10
        : 0,
      diskTotal: Number(fields.DISK_TOTAL) || 0,
      diskUsed: Number(fields.DISK_USED) || 0,
      diskFree: Number(fields.DISK_FREE) || 0,
      ramTotal: Number(fields.RAM_TOTAL) || 0,
      ramFree: Number(fields.RAM_FREE) || 0,
      publicIp: fields.PUBLIC_IP || '',
      cpus: Number(fields.NCPU) || 0,
      sudoOk: fields.SUDO_OK === '1',
      processCount: 0,
      processes: [],
    };
    remoteCache.set(host, { at: Date.now(), value });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const value = {
      remote: true,
      sshHost: host,
      platform: 'unix',
      os: `SSH · ${host}`,
      arch: '',
      hostname: host,
      cpuPercent: 0,
      diskTotal: 0,
      diskUsed: 0,
      diskFree: 0,
      publicIp: '',
      processCount: 0,
      processes: [],
      error: `Remote probe failed: ${message.split('\n')[0]}`,
    };
    remoteCache.set(host, { at: Date.now(), value });
    return value;
  }
}
