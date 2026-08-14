const { app, BrowserWindow, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const {
  parseOpenRequestsFromArgv,
  parseOpenRequestFromUrl,
  installFinderServices,
} = require('./folderOpen.cjs');

/** @type {import('electron').BrowserWindow | null} */
let primaryWindow = null;
/** @type {Set<import('electron').BrowserWindow>} */
const windows = new Set();
/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;
let serverPort = null;
let isQuitting = false;

/** @type {{ mode: 'tab' | 'window', cwd: string }[]} */
let pendingFolderOpens = [];

const PREFERRED_PORT = 39281;
const SERVER_BOOT_MS = 45000;
const SERVER_BOOT_AT_LOGIN_MS = 90000;
const LOGIN_START_DELAY_MS = 4000;

/** @type {string | null} */
let logFilePath = null;
/** @type {fs.WriteStream | null} */
let logStream = null;

function appRoot() {
  return app.getAppPath();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureLogSink() {
  if (logStream) return logFilePath;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'main.log');
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    logStream.write(`\n---- ${new Date().toISOString()} pid=${process.pid} ----\n`);
  } catch (err) {
    console.error('DockTerm log sink failed:', err);
  }
  return logFilePath;
}

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.error(line);
  try {
    ensureLogSink();
    logStream?.write(`${line}\n`);
  } catch {
    /* ignore */
  }
}

function wasOpenedAtLogin() {
  try {
    return Boolean(app.getLoginItemSettings()?.wasOpenedAtLogin);
  } catch {
    return false;
  }
}

function resolveIcon() {
  const icns = path.join(appRoot(), 'build', 'icon.icns');
  const png = path.join(appRoot(), 'build', 'icon.png');
  if (process.platform === 'darwin' && fs.existsSync(icns)) return icns;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function bundledNodePath() {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  return path.join(appRoot(), 'runtime', name);
}

function resolveNodeBinary() {
  // 1) Explicit override (debug only)
  if (process.env.DOCKTERM_NODE && fs.existsSync(process.env.DOCKTERM_NODE)) {
    return process.env.DOCKTERM_NODE;
  }

  // 2) Bundled official Node shipped inside the .app (isolated from system Node)
  const bundled = bundledNodePath();
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  // 3) Dev / unpackaged fallback — system Node 20–22
  const candidates = [
    '/opt/homebrew/opt/node@22/bin/node',
    '/usr/local/opt/node@22/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }

  try {
    const which = execFileSync('which', ['node'], {
      encoding: 'utf8',
      env: process.env,
    })
      .trim()
      .split('\n')[0];
    if (which && fs.existsSync(which)) return which;
  } catch {
    /* ignore */
  }

  throw new Error(
    'DockTerm runtime Node is missing from the app bundle.\n\nReinstall DockTerm, or for development run: npm run runtime:node'
  );
}

/** Prefer bundled Node immediately; only retry when falling back to system paths. */
async function resolveNodeBinaryReady(timeoutMs = 30000) {
  const bundled = bundledNodePath();
  if (
    (process.env.DOCKTERM_NODE && fs.existsSync(process.env.DOCKTERM_NODE)) ||
    fs.existsSync(bundled)
  ) {
    return resolveNodeBinary();
  }

  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return resolveNodeBinary();
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw lastErr || new Error('Node.js not found');
}

function probeServer(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/snippets', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(port, timeoutMs, isDead) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const tryOnce = () => {
      if (settled) return;
      if (typeof isDead === 'function' && isDead()) {
        finish(
          new Error(
            'DockTerm server process exited before becoming ready. See ~/Library/Logs/DockTerm/main.log'
          )
        );
        return;
      }
      if (Date.now() - started > timeoutMs) {
        finish(
          new Error(
            'DockTerm server did not start in time. See ~/Library/Logs/DockTerm/main.log'
          )
        );
        return;
      }

      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/snippets', timeout: 1000 },
        (res) => {
          res.resume();
          finish(null, port);
        }
      );
      const retry = () => {
        if (settled) return;
        setTimeout(tryOnce, 200);
      };
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    tryOnce();
  });
}

function killServerProc() {
  if (!serverProc || serverProc.killed) {
    serverProc = null;
    return;
  }
  try {
    serverProc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  serverProc = null;
}

function startBackend(timeoutMs = SERVER_BOOT_MS) {
  return (async () => {
    const nodeBin = await resolveNodeBinaryReady(
      Math.min(timeoutMs, wasOpenedAtLogin() ? 45000 : 15000)
    );
    const serverEntry = path.join(appRoot(), 'server', 'index.js');
    const port = PREFERRED_PORT;
    ensureLogSink();

    logLine(`Starting backend with ${nodeBin} (timeout ${timeoutMs}ms)`);
    logLine(`server entry: ${serverEntry}`);

    if (!fs.existsSync(serverEntry)) {
      throw new Error(`Server entry missing: ${serverEntry}`);
    }

    let childExited = false;
    let exitSummary = '';
    const outputTail = [];
    const pushOut = (buf) => {
      const text = String(buf);
      outputTail.push(text);
      if (outputTail.length > 40) outputTail.shift();
      logStream?.write(text);
      process.stdout.write(`[dockterm-server] ${text}`);
    };

    killServerProc();

    const runtimeBinDir = path.dirname(nodeBin);
    serverProc = spawn(nodeBin, [serverEntry], {
      cwd: appRoot(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DOCKTERM_ROOT: appRoot(),
        HOST: '127.0.0.1',
        PORT: String(port),
        ELECTRON_RUN_AS_NODE: undefined,
        // Prefer bundled runtime on PATH so any nested node lookups stay isolated.
        PATH: [runtimeBinDir, '/usr/bin', '/bin', process.env.PATH || ''].join(
          path.delimiter
        ),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProc.stdout?.on('data', pushOut);
    serverProc.stderr?.on('data', pushOut);
    serverProc.on('error', (err) => {
      childExited = true;
      exitSummary = `spawn error: ${err.message}`;
      logLine(exitSummary);
    });
    serverProc.on('exit', (code, signal) => {
      childExited = true;
      exitSummary = `exited code=${code} signal=${signal}`;
      logLine(`DockTerm server ${exitSummary}`);
      serverProc = null;
    });

    try {
      const readyPort = await waitForServer(port, timeoutMs, () => childExited);
      serverPort = readyPort;
      logLine(`Backend ready on port ${readyPort}`);
      return readyPort;
    } catch (err) {
      const detail = outputTail.join('').trim() || exitSummary;
      killServerProc();
      const base = err instanceof Error ? err.message : String(err);
      throw new Error(detail ? `${base}\n\n${detail.slice(-1200)}` : base);
    }
  })();
}

async function ensureBackend() {
  ensureLogSink();
  const atLogin = wasOpenedAtLogin();
  logLine(
    `ensureBackend atLogin=${atLogin} appPath=${appRoot()} port=${PREFERRED_PORT}`
  );

  if (atLogin) {
    logLine(`Login-item launch — waiting ${LOGIN_START_DELAY_MS}ms for system settle`);
    await sleep(LOGIN_START_DELAY_MS);
  }

  if (serverPort && (await probeServer(serverPort))) {
    logLine(`Reusing existing backend on ${serverPort}`);
    return serverPort;
  }
  if (await probeServer(PREFERRED_PORT)) {
    serverPort = PREFERRED_PORT;
    logLine(`Attached to already-running backend on ${PREFERRED_PORT}`);
    return serverPort;
  }

  const timeoutMs = atLogin ? SERVER_BOOT_AT_LOGIN_MS : SERVER_BOOT_MS;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      logLine(`Backend start attempt ${attempt}/3`);
      return await startBackend(timeoutMs);
    } catch (err) {
      lastErr = err;
      logLine(`Backend attempt ${attempt} failed: ${err?.message || err}`);
      killServerProc();
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastErr || new Error('DockTerm server did not start');
}

function hidePrimaryWindow() {
  if (!primaryWindow || primaryWindow.isDestroyed()) return;
  // Close = hide window; keep UI process + backend + WS alive until Quit.
  if (!primaryWindow.isVisible()) return;
  primaryWindow.hide();
}

function showWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function showPrimaryWindow() {
  showWindow(primaryWindow);
}

function anyLiveWindow() {
  for (const win of windows) {
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

function normalizeFolderPath(cwd) {
  try {
    const resolved = path.resolve(String(cwd || '').trim());
    if (!resolved) return null;
    if (!fs.existsSync(resolved)) return null;
    const st = fs.statSync(resolved);
    return st.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return null;
  }
}

function sendOpenFolderToWindow(win, request) {
  if (!win || win.isDestroyed()) return false;
  const cwd = normalizeFolderPath(request.cwd);
  if (!cwd) return false;
  const payload = { mode: request.mode || 'tab', cwd };
  const send = () => {
    try {
      win.webContents.send('dockterm:open-folder', payload);
    } catch (err) {
      logLine(`open-folder send failed: ${err?.message || err}`);
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(send, 250);
    });
  } else {
    setTimeout(send, 80);
  }
  showWindow(win);
  return true;
}

async function enqueueFolderOpens(requests) {
  const list = (requests || [])
    .map((r) => ({
      mode: r.mode === 'window' ? 'window' : 'tab',
      cwd: normalizeFolderPath(r.cwd),
    }))
    .filter((r) => r.cwd);
  if (!list.length) return;

  for (const req of list) {
    if (req.mode === 'window') {
      try {
        const win = await createWindow({
          primary: !anyLiveWindow(),
        });
        sendOpenFolderToWindow(win, req);
      } catch (err) {
        logLine(`new-window open failed: ${err?.message || err}`);
        pendingFolderOpens.push(req);
      }
      continue;
    }

    let win = anyLiveWindow();
    if (!win) {
      pendingFolderOpens.push(req);
      try {
        win = await createWindow({ primary: true });
      } catch (err) {
        logLine(`create window for tab open failed: ${err?.message || err}`);
        continue;
      }
    }
    sendOpenFolderToWindow(win, req);
  }
}

function flushPendingFolderOpens(win) {
  if (!pendingFolderOpens.length || !win || win.isDestroyed()) return;
  const queued = pendingFolderOpens.slice();
  pendingFolderOpens = [];
  // Cold start: first request (tab or window) lands in the primary window.
  // Extra --new-window requests still spawn additional windows.
  let assignedPrimary = false;
  for (const req of queued) {
    if (req.mode === 'window' && assignedPrimary) {
      void enqueueFolderOpens([req]);
      continue;
    }
    sendOpenFolderToWindow(win, req);
    assignedPrimary = true;
  }
}

function handleArgvOpens(argv) {
  const reqs = parseOpenRequestsFromArgv(argv || []);
  if (!reqs.length) return;
  void enqueueFolderOpens(reqs);
}

function wireWindowControls() {
  ipcMain.removeHandler('window:isMaximized');
  ipcMain.removeHandler('dialog:pickIdentityFile');
  ipcMain.removeHandler('clipboard:writeText');
  ipcMain.removeHandler('clipboard:readText');
  ipcMain.removeHandler('shell:openExternal');
  ipcMain.removeHandler('finder:installServices');
  ipcMain.removeAllListeners('window:minimize');
  ipcMain.removeAllListeners('window:maximize');
  ipcMain.removeAllListeners('window:close');

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    // Primary window hides (background stay-alive); secondary windows destroy.
    if (win === primaryWindow) hidePrimaryWindow();
    else win.close();
  });
  ipcMain.handle('window:isMaximized', (event) => {
    return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized());
  });
  ipcMain.handle('clipboard:writeText', (_event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(String(text ?? ''));
    return true;
  });
  ipcMain.handle('clipboard:readText', () => {
    const { clipboard } = require('electron');
    return clipboard.readText();
  });
  ipcMain.handle('dialog:pickIdentityFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select SSH identity file',
      properties: ['openFile', 'showHiddenFiles'],
      defaultPath: path.join(require('os').homedir(), '.ssh'),
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('shell:openExternal', async (_event, url) => {
    const target = String(url ?? '').trim();
    if (!isSafeExternalUrl(target)) return false;
    await shell.openExternal(target);
    return true;
  });
  ipcMain.handle('finder:installServices', async () =>
    installFinderServices(app.getPath('exe'))
  );
}

/** http(s), mailto, and common app deep-links — reject javascript: etc. */
function isSafeExternalUrl(url) {
  try {
    const u = new URL(url);
    const protocol = u.protocol.toLowerCase();
    return (
      protocol === 'http:' ||
      protocol === 'https:' ||
      protocol === 'mailto:' ||
      protocol === 'vscode:' ||
      protocol === 'cursor:'
    );
  } catch {
    return false;
  }
}

function buildWindowOptions() {
  const icon = resolveIcon();
  const windowOpts = {
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    title: 'DockTerm',
    backgroundColor: '#1a1c23',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  };

  if (process.platform === 'darwin') {
    windowOpts.titleBarStyle = 'hidden';
    windowOpts.trafficLightPosition = { x: 14, y: 12 };
  } else {
    windowOpts.frame = false;
  }

  return windowOpts;
}

/** @type {'dom' | 'term'} */
let editFocusKind = 'dom';

function wireEditFocusTracking() {
  ipcMain.removeAllListeners('dockterm:edit-focus');
  ipcMain.on('dockterm:edit-focus', (_event, kind) => {
    editFocusKind = kind === 'term' ? 'term' : 'dom';
  });
}

/**
 * When the terminal is focused, intercept edit shortcuts so the Edit menu
 * roles don't no-op on xterm's empty DOM selection. Inputs use normal roles.
 */
function wireTerminalEditShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (editFocusKind !== 'term') return;

    const isMac = process.platform === 'darwin';
    const mod = isMac ? input.meta : input.control;
    if (!mod || input.alt) return;

    const key = String(input.key || '').toLowerCase();
    if (key === 'c' && !input.shift) {
      event.preventDefault();
      win.webContents.send('dockterm:clipboard', 'copy');
      return;
    }
    if (key === 'v' && !input.shift) {
      event.preventDefault();
      win.webContents.send('dockterm:clipboard', 'paste');
      return;
    }
    if (key === 'a' && !input.shift) {
      event.preventDefault();
      win.webContents.send('dockterm:clipboard', 'selectAll');
    }
  });
}

/** Native menu — Edit must be visible on macOS or accelerators never register. */
function installAppMenu() {
  const isMac = process.platform === 'darwin';

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Install Finder Menu Items…',
          click: () => {
            const result = installFinderServices(app.getPath('exe'));
            if (result.ok) {
              dialog.showMessageBox({
                type: 'info',
                title: 'Finder menu items',
                message: 'Finder menu items installed',
                detail:
                  'Right-click a folder in Finder → Quick Actions / Services:\n\n• New DockTerm Tab at Folder\n• New DockTerm at Folder\n\nIf they do not appear yet, log out/in or open System Settings → Keyboard → Keyboard Shortcuts → Services.',
              });
            } else {
              dialog.showErrorBox(
                'Could not install Finder menu items',
                result.error || 'Unknown error'
              );
            }
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  // Visible Edit menu (required for ⌘A/X/C/V in inputs on macOS).
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
    ],
  });

  if (isMac) {
    template.push({
      label: 'Window',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            void createWindow({ primary: false }).catch((err) => {
              logLine(`New Window failed: ${err?.message || err}`);
            });
          },
        },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win =
              BrowserWindow.getFocusedWindow() || primaryWindow || anyLiveWindow();
            if (win && !win.isDestroyed()) win.close();
          },
        },
      ],
    });
  } else {
    template.push({
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            void createWindow({ primary: false }).catch((err) => {
              logLine(`New Window failed: ${err?.message || err}`);
            });
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Right-click Cut/Copy/Paste/Select All in inputs, textareas, contenteditable. */
function wireContextMenu(win) {
  win.webContents.on('context-menu', (event, params) => {
    const editable = Boolean(params.isEditable);
    const hasSelection = Boolean(params.selectionText);

    if (!editable && !hasSelection) return;

    // Stop Chromium's empty/broken default menu.
    event.preventDefault();

    /** @type {import('electron').MenuItemConstructorOptions[]} */
    const items = [];

    if (editable) {
      const f = params.editFlags || {};
      items.push(
        { role: 'undo', enabled: f.canUndo !== false },
        { role: 'redo', enabled: f.canRedo !== false },
        { type: 'separator' },
        { role: 'cut', enabled: f.canCut !== false },
        { role: 'copy', enabled: f.canCopy !== false },
        { role: 'paste', enabled: f.canPaste !== false },
        { role: 'delete', enabled: f.canDelete !== false },
        { type: 'separator' },
        { role: 'selectAll', enabled: f.canSelectAll !== false }
      );
    } else if (hasSelection) {
      items.push({
        role: 'copy',
        enabled: params.editFlags?.canCopy !== false,
      });
    }

    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({
      window: win,
      x: params.x,
      y: params.y,
    });
  });
}

/**
 * @param {{ primary?: boolean }} [opts]
 * @returns {Promise<import('electron').BrowserWindow>}
 */
async function createWindow(opts = {}) {
  const asPrimary =
    opts.primary !== false &&
    (!primaryWindow || primaryWindow.isDestroyed());

  const win = new BrowserWindow(buildWindowOptions());
  windows.add(win);
  if (asPrimary) primaryWindow = win;

  wireContextMenu(win);
  wireTerminalEditShortcuts(win);

  win.once('ready-to-show', () => {
    win.show();
  });

  // xterm WebLinksAddon may call window.open() with no URL (about:blank).
  // Only forward real external targets; deny everything else.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (isQuitting) return;
    // Primary stays alive in the background; other windows close for real.
    if (win === primaryWindow) {
      e.preventDefault();
      hidePrimaryWindow();
    }
  });

  win.on('closed', () => {
    windows.delete(win);
    if (primaryWindow === win) {
      primaryWindow = anyLiveWindow();
    }
  });

  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL() || '';
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      flushPendingFolderOpens(win);
    }
  });

  // Show splash immediately while backend boots.
  const splashPath = path.join(__dirname, 'splash.html');
  await win.loadFile(splashPath);

  const port = await ensureBackend();
  await win.loadURL(`http://127.0.0.1:${port}`);
  return win;
}

function shutdown() {
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  serverProc = null;
  serverPort = null;
}

// Single instance so Finder "Tab" opens reuse the running app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    handleArgvOpens(argv);
    const win = anyLiveWindow();
    if (win) showWindow(win);
    else showPrimaryWindow();
  });

  // open-url can arrive before ready on macOS.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const req = parseOpenRequestFromUrl(url);
    if (req) {
      if (app.isReady()) void enqueueFolderOpens([req]);
      else pendingFolderOpens.push(req);
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    const cwd = normalizeFolderPath(filePath);
    if (!cwd) return;
    const req = { mode: 'tab', cwd };
    if (app.isReady()) void enqueueFolderOpens([req]);
    else pendingFolderOpens.push(req);
  });

  app.whenReady().then(() => {
    // Custom protocol: dockterm://new-tab?path=... / dockterm://new-window?path=...
    try {
      if (!app.isDefaultProtocolClient('dockterm')) {
        app.setAsDefaultProtocolClient('dockterm');
      }
    } catch (err) {
      logLine(`protocol register failed: ${err?.message || err}`);
    }

    wireWindowControls();
    wireEditFocusTracking();
    installAppMenu();
    if (process.platform === 'darwin' && app.dock) {
      const icon = resolveIcon();
      if (icon) {
        try {
          app.dock.setIcon(icon);
        } catch {
          /* ignore */
        }
      }
    }

    // Queue cold-start opens; apply after the primary window exists
    // so we don't race-create a second window.
    {
      const cold = parseOpenRequestsFromArgv(process.argv || [])
        .map((r) => ({
          mode: r.mode === 'window' ? 'window' : 'tab',
          cwd: normalizeFolderPath(r.cwd),
        }))
        .filter((r) => r.cwd);
      pendingFolderOpens.push(...cold);
    }

    createWindow({ primary: true })
      .then((win) => {
        flushPendingFolderOpens(win);
      })
      .catch((err) => {
        logLine(`DockTerm failed to start: ${err?.stack || err}`);
        const logHint = logFilePath
          ? `\n\nDetails: ${logFilePath}`
          : '\n\nDetails: ~/Library/Logs/DockTerm/main.log';
        dialog.showErrorBox(
          'DockTerm failed to start',
          String(err?.message || err) + logHint
        );
        isQuitting = true;
        app.quit();
      });

    app.on('activate', () => {
      const live = anyLiveWindow();
      if (!live) {
        createWindow({ primary: true }).catch((err) => {
          console.error(err);
          dialog.showErrorBox(
            'DockTerm failed to start',
            String(err?.message || err)
          );
        });
        return;
      }
      showWindow(live);
    });
  });

  // Keep running in background when the window is hidden.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !isQuitting) {
      // Window was destroyed somehow — still keep process if we intend background.
      // Actual quit happens via before-quit / explicit Quit.
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    shutdown();
  });
}
