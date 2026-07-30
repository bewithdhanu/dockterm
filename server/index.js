import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { listSshHosts, readRawConfig, writeRawConfig, upsertHost, deleteHost, getConfigPath } from './sshConfig.js';
import {
  listSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  getSnippetsPath,
} from './snippets.js';
import {
  getProcessTreeStats,
  getRemoteSshStats,
  killPidOnHost,
  killCommandForPty,
  platformInfo,
} from './sessionStats.js';
import { pickIdentityFileNative } from './pickFile.js';
import { readIdentityPreview } from './identityPreview.js';
import { detectHostOs } from './detectHostOs.js';
import {
  getProcessCwd,
  escapeShellArg,
  listHostProcesses,
  listRemoteProcesses,
  resolveExistingCwd,
} from './processInfo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.DOCKTERM_ROOT || path.join(__dirname, '..');
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '1mb' }));

app.get('/api/ssh-hosts', (_req, res) => {
  try {
    const hosts = listSshHosts();
    const configPath = getConfigPath();
    res.json({
      configPath,
      exists: fs.existsSync(configPath),
      hosts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, hosts: [] });
  }
});

app.get('/api/ssh-config', (_req, res) => {
  try {
    res.json({
      path: getConfigPath(),
      content: readRawConfig(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put('/api/ssh-config', (req, res) => {
  try {
    const content = req.body?.content;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content string required' });
    }
    const result = writeRawConfig(content);
    res.json({ ok: true, ...result, hosts: listSshHosts() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.post('/api/ssh-hosts', (req, res) => {
  try {
    const host = upsertHost(req.body || {});
    res.json({ ok: true, host, hosts: listSshHosts() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.put('/api/ssh-hosts/:alias', (req, res) => {
  try {
    const originalAlias = decodeURIComponent(req.params.alias);
    const host = upsertHost(req.body || {}, { originalAlias });
    res.json({ ok: true, host, hosts: listSshHosts() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.delete('/api/ssh-hosts/:alias', (req, res) => {
  try {
    const alias = decodeURIComponent(req.params.alias);
    const result = deleteHost(alias);
    res.json({ ok: true, ...result, hosts: listSshHosts() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.post('/api/pick-identity-file', async (_req, res) => {
  try {
    const filePath = await pickIdentityFileNative();
    if (!filePath) return res.json({ cancelled: true, path: null });
    res.json({ cancelled: false, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/identity-preview', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'path query required' });
    }
    res.json(readIdentityPreview(filePath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.get('/api/ssh-hosts/:alias/os', async (req, res) => {
  try {
    const alias = decodeURIComponent(req.params.alias);
    const info = await detectHostOs(alias);
    res.json({ ok: true, alias, ...info });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.get('/api/snippets', (_req, res) => {
  try {
    res.json({
      path: getSnippetsPath(),
      snippets: listSnippets(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, snippets: [] });
  }
});

app.post('/api/snippets', (req, res) => {
  try {
    const result = createSnippet(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.put('/api/snippets/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const result = updateSnippet(id, req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.delete('/api/snippets/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const result = deleteSnippet(id);
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

const shellCandidates =
  os.platform() === 'win32'
    ? [process.env.SHELL, 'powershell.exe', 'cmd.exe'].filter(Boolean)
    : [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);

function listShells() {
  const seen = new Set();
  const shells = [];
  for (const candidate of shellCandidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidate === 'powershell.exe' || candidate === 'cmd.exe') {
      shells.push(candidate);
      continue;
    }
    if (fs.existsSync(candidate)) {
      shells.push(candidate);
    } else {
      console.warn(`Shell not found, skipping: ${candidate}`);
    }
  }
  return shells;
}

/** @type {Map<string, import('node-pty').IPty>} */
const sessions = new Map();

/** @type {Map<string, {
 *   bytesIn: number,
 *   bytesOut: number,
 *   sampleIn: number,
 *   sampleOut: number,
 *   sampleAt: number,
 *   inRate: number,
 *   outRate: number,
 *   createdAt: number,
 *   alive: boolean,
 * }>} */
const sessionMeta = new Map();

function ensureMeta(id) {
  let meta = sessionMeta.get(id);
  if (!meta) {
    const now = Date.now();
    meta = {
      bytesIn: 0,
      bytesOut: 0,
      sampleIn: 0,
      sampleOut: 0,
      sampleAt: now,
      inRate: 0,
      outRate: 0,
      createdAt: now,
      alive: true,
    };
    sessionMeta.set(id, meta);
  }
  return meta;
}

function noteBytes(id, direction, byteLength) {
  const meta = ensureMeta(id);
  if (direction === 'in') meta.bytesIn += byteLength;
  else meta.bytesOut += byteLength;
}

function sampleRates(meta) {
  const now = Date.now();
  const dt = Math.max(0.001, (now - meta.sampleAt) / 1000);
  meta.inRate = (meta.bytesIn - meta.sampleIn) / dt;
  meta.outRate = (meta.bytesOut - meta.sampleOut) / dt;
  meta.sampleIn = meta.bytesIn;
  meta.sampleOut = meta.bytesOut;
  meta.sampleAt = now;
  return meta;
}

function byteLen(data) {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.length;
  return String(data).length;
}

function ptyEnv() {
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Prevent macOS zsh from printing "Restored session: …" on every PTY spawn.
    SHELL_SESSIONS_DISABLE: '1',
  };
}

function createPty(cols = 80, rows = 24, { cwd } = {}) {
  const shells = listShells();
  if (shells.length === 0) {
    throw new Error(
      `No usable shell found. Tried: ${shellCandidates.join(', ') || '(none)'}`,
    );
  }

  const startCwd = resolveExistingCwd(cwd) || os.homedir();
  // Non-login interactive shells only — login shells (-l) trigger zsh session restore spam.
  const argSets = [[]];

  /** @type {Error | null} */
  let lastError = null;

  for (const shell of shells) {
    for (const args of argSets) {
      try {
        const term = pty.spawn(shell, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: startCwd,
          env: ptyEnv(),
        });
        term.__shellPath = shell;
        term.__kind = 'shell';
        term.__cwd = startCwd;
        console.log(
          `PTY spawned: ${shell} args=${JSON.stringify(args)} cwd=${startCwd}`,
        );
        return term;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `PTY spawn failed for ${shell} args=${JSON.stringify(args)}:`,
          lastError,
        );
      }
    }
  }

  throw lastError || new Error('PTY spawn failed for all shells');
}

function createSshPty(hostAlias, cols = 80, rows = 24, { remoteCwd } = {}) {
  const alias = String(hostAlias || '').trim();
  if (!alias || /[\s;|&$`<>]/.test(alias)) {
    throw new Error('Invalid SSH host alias');
  }

  const sshBin =
    os.platform() === 'win32'
      ? 'ssh'
      : fs.existsSync('/usr/bin/ssh')
        ? '/usr/bin/ssh'
        : 'ssh';

  // Quiet client-side chatter (known_hosts warnings); MOTD is still server-side.
  const term = pty.spawn(
    sshBin,
    ['-o', 'LogLevel=ERROR', '-o', 'UpdateHostKeys=no', alias],
    {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: ptyEnv(),
    }
  );
  term.__shellPath = sshBin;
  term.__kind = 'ssh';
  term.__sshHost = alias;
  term.__cwd = remoteCwd || null;
  console.log(`SSH PTY spawned: ${sshBin} ${alias}`);

  if (remoteCwd && typeof remoteCwd === 'string' && remoteCwd.trim()) {
    const cdCmd = `cd ${escapeShellArg(remoteCwd.trim())}\n`;
    setTimeout(() => {
      try {
        term.write(cdCmd);
      } catch {
        /* ignore */
      }
    }, 600);
  }

  return term;
}

wss.on('connection', (ws) => {
  /** @type {Map<string, import('node-pty').IPty>} */
  const tabs = new Map();

  const send = (msg) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create': {
        const id = randomUUID();
        const cols = Math.max(2, msg.cols || 80);
        const rows = Math.max(1, msg.rows || 24);

        let ssh = typeof msg.ssh === 'string' ? msg.ssh.trim() : '';
        let cwd = typeof msg.cwd === 'string' ? msg.cwd : null;
        let remoteCwd = typeof msg.remoteCwd === 'string' ? msg.remoteCwd : null;

        // Clone state from an existing session (split / duplicate).
        if (msg.cloneFrom) {
          const src =
            tabs.get(msg.cloneFrom) || sessions.get(msg.cloneFrom);
          if (src) {
            if (src.__kind === 'ssh' && src.__sshHost) {
              ssh = src.__sshHost;
              remoteCwd = remoteCwd || src.__cwd || null;
            } else {
              // Prefer reported cwd, else inspect process.
              if (!cwd) cwd = src.__cwd || null;
            }
          }
        }

        let term;
        try {
          if (ssh) {
            term = createSshPty(ssh, cols, rows, { remoteCwd });
          } else {
            // If cloning local and cwd unknown, resolve from source pid.
            if (!cwd && msg.cloneFrom) {
              const src =
                tabs.get(msg.cloneFrom) || sessions.get(msg.cloneFrom);
              if (src?.pid) {
                cwd = (await getProcessCwd(src.pid)) || cwd;
              }
            }
            term = createPty(cols, rows, { cwd });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('PTY spawn failed:', err);
          send({ type: 'error', message: `PTY spawn failed: ${message}` });
          return;
        }

        tabs.set(id, term);
        sessions.set(id, term);
        ensureMeta(id);

        term.onData((data) => {
          noteBytes(id, 'out', byteLen(data));
          send({ type: 'output', id, data });
        });

        term.onExit(({ exitCode }) => {
          const meta = sessionMeta.get(id);
          if (meta) meta.alive = false;
          send({
            type: 'exit',
            id,
            exitCode: exitCode ?? 0,
          });
          tabs.delete(id);
          sessions.delete(id);
        });

        const title =
          (typeof msg.title === 'string' && msg.title.trim()) ||
          term.__sshHost ||
          path.basename(term.__shellPath || shellsFallbackLabel()) ||
          'shell';

        const host = platformInfo();
        send({
          type: 'created',
          id,
          clientKey: typeof msg.clientKey === 'string' ? msg.clientKey : null,
          title,
          pid: term.pid,
          kind: term.__kind || 'shell',
          sshHost: term.__sshHost || null,
          cwd: term.__cwd || null,
          platform: host.platform,
          os: host.os,
        });
        break;
      }

      case 'cwd': {
        const term = tabs.get(msg.id) || sessions.get(msg.id);
        if (term && typeof msg.cwd === 'string' && msg.cwd.trim()) {
          term.__cwd = msg.cwd.trim();
        }
        break;
      }

      case 'input': {
        const term = tabs.get(msg.id);
        if (term && typeof msg.data === 'string') {
          noteBytes(msg.id, 'in', byteLen(msg.data));
          term.write(msg.data);
        }
        break;
      }

      case 'resize': {
        const term = tabs.get(msg.id);
        if (term) {
          const cols = Math.max(2, msg.cols || 80);
          const rows = Math.max(1, msg.rows || 24);
          try {
            term.resize(cols, rows);
          } catch {
            /* ignore */
          }
        }
        break;
      }

      case 'close': {
        const term = tabs.get(msg.id);
        if (term) {
          try {
            term.kill();
          } catch {
            /* ignore */
          }
          tabs.delete(msg.id);
          sessions.delete(msg.id);
          sessionMeta.delete(msg.id);
        }
        break;
      }

      case 'stats': {
        const id = msg.id;
        const term = tabs.get(id) || sessions.get(id);
        const meta = sessionMeta.get(id);
        if (!term || !meta) {
          send({
            type: 'stats',
            id,
            connected: false,
            alive: false,
          });
          break;
        }

        sampleRates(meta);
        const base = {
          type: 'stats',
          id,
          connected: true,
          alive: meta.alive,
          kind: term.__kind || 'shell',
          sshHost: term.__sshHost || null,
          shell: term.__shellPath || null,
          pid: term.pid,
          bytesIn: meta.bytesIn,
          bytesOut: meta.bytesOut,
          inRate: meta.inRate,
          outRate: meta.outRate,
          uptimeMs: Date.now() - meta.createdAt,
          cwd: term.__cwd || null,
        };

        const wantProcs = Boolean(msg.processes);

        const loadStats =
          term.__kind === 'ssh' && term.__sshHost
            ? getRemoteSshStats(term.__sshHost)
            : getProcessTreeStats(term.pid);

        const loadCwd =
          term.__kind === 'ssh'
            ? Promise.resolve(term.__cwd || null)
            : getProcessCwd(term.pid).then((c) => {
                if (c) term.__cwd = c;
                return c || term.__cwd || null;
              });

        const loadProcs = wantProcs
          ? term.__kind === 'ssh' && term.__sshHost
            ? listRemoteProcesses(term.__sshHost)
            : listHostProcesses()
          : Promise.resolve(null);

        Promise.all([loadStats, loadCwd, loadProcs])
          .then(([proc, cwd, processes]) => {
            send({
              ...base,
              cwd,
              remote: Boolean(proc.remote),
              os: proc.os,
              platform: proc.platform,
              arch: proc.arch,
              hostname: proc.hostname,
              cpuPercent: proc.cpuPercent,
              diskTotal: proc.diskTotal,
              diskUsed: proc.diskUsed,
              diskFree: proc.diskFree,
              publicIp: proc.publicIp || '',
              memoryUsed: proc.memoryUsed,
              ramTotal: proc.ramTotal,
              ramFree: proc.ramFree,
              processCount: proc.processCount,
              processes: processes || proc.processes || [],
              error: proc.error || null,
            });
          })
          .catch((err) => {
            send({
              ...base,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        break;
      }

      case 'kill': {
        const id = msg.id;
        const pid = Number(msg.pid);
        const force = Boolean(msg.force);
        const term = tabs.get(id) || sessions.get(id);

        if (!Number.isInteger(pid) || pid <= 0) {
          send({ type: 'kill-result', id, ok: false, error: 'Invalid PID' });
          break;
        }

        (async () => {
          try {
            // SSH sessions: send OS-appropriate kill into the remote shell.
            if (term && term.__kind === 'ssh') {
              const cmd = killCommandForPty(pid, {
                force,
                remoteOs: msg.remoteOs || 'unix',
              });
              term.write(cmd);
              send({
                type: 'kill-result',
                id,
                ok: true,
                method: 'pty',
                pid,
              });
              return;
            }

            const result = await killPidOnHost(pid, { force });
            send({ type: 'kill-result', id, ...result });
          } catch (err) {
            send({
              type: 'kill-result',
              id,
              ok: false,
              pid,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        break;
      }

      case 'title': {
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    for (const [id, term] of tabs) {
      try {
        term.kill();
      } catch {
        /* ignore */
      }
      sessions.delete(id);
      sessionMeta.delete(id);
    }
    tabs.clear();
  });
});

function shellsFallbackLabel() {
  return listShells()[0] || 'shell';
}

let staticMounted = false;

function mountStaticClient(appRoot = root) {
  if (staticMounted) return;
  const dist = path.join(appRoot, 'client', 'dist');
  if (!fs.existsSync(dist)) return;
  staticMounted = true;
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

/**
 * Start the DockTerm HTTP + WebSocket server.
 * @param {{ host?: string, port?: number, serveClient?: boolean }} [opts]
 * @returns {Promise<{ port: number, host: string, server: import('http').Server }>}
 */
export async function startServer(opts = {}) {
  const host = opts.host || process.env.HOST || '127.0.0.1';
  const port = opts.port != null ? opts.port : Number(PORT) || 3001;
  const serveClient =
    opts.serveClient != null ? opts.serveClient : isProd || opts.port === 0;

  if (serveClient) {
    mountStaticClient(process.env.DOCKTERM_ROOT || root);
  }

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`DockTerm server listening on http://${host}:${boundPort}`);
  console.log(`Shells available: ${listShells().join(', ') || '(none)'}`);
  try {
    console.log(`SSH hosts loaded: ${listSshHosts().length}`);
  } catch (err) {
    console.warn('SSH config parse failed:', err);
  }
  return { port: boundPort, host, server };
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startServer({
    host: process.env.HOST || '0.0.0.0',
    port: Number(PORT) || 3001,
    serveClient: isProd,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}