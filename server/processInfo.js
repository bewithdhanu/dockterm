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

/**
 * List processes on the local host for the Procs panel.
 */
export async function listHostProcesses({ limit = 80 } = {}) {
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
      return rows.slice(0, limit);
    }

    const { stdout } = await execFileAsync(
      'ps',
      ['-axo', 'pid=,pcpu=,rss=,etime=,comm='],
      { timeout: 5000 }
    );
    const rows = [];
    for (const line of stdout.split('\n')) {
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
    return rows.slice(0, limit);
  } catch {
    return [];
  }
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

/**
 * List processes on a remote host via SSH config alias.
 */
export async function listRemoteProcesses(alias, { limit = 80 } = {}) {
  const host = String(alias || '').trim();
  if (!host || /[\s;|&$`<>]/.test(host)) return [];

  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=6',
        host,
        'ps',
        '-axo',
        'pid=,pcpu=,rss=,etime=,comm=',
      ],
      { timeout: 10000, maxBuffer: 1024 * 1024, env: process.env }
    );
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
    return rows.slice(0, limit);
  } catch {
    return [];
  }
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
