const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;
let serverPort = null;
let isQuitting = false;

const PREFERRED_PORT = 39281;

function appRoot() {
  return app.getAppPath();
}

function resolveIcon() {
  const icns = path.join(appRoot(), 'build', 'icon.icns');
  const png = path.join(appRoot(), 'build', 'icon.png');
  if (process.platform === 'darwin' && fs.existsSync(icns)) return icns;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function resolveNodeBinary() {
  const candidates = [
    process.env.DOCKTERM_NODE,
    '/opt/homebrew/opt/node@22/bin/node',
    '/usr/local/opt/node@22/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ].filter(Boolean);

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
    'DockTerm needs Node.js 20–22 to run terminals.\n\nInstall from https://nodejs.org or: brew install node@22'
  );
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

function waitForServer(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/snippets', timeout: 1000 },
        (res) => {
          res.resume();
          resolve(port);
        }
      );
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('DockTerm server did not start in time'));
          return;
        }
        setTimeout(tryOnce, 150);
      });
      req.on('timeout', () => {
        req.destroy();
      });
    };
    tryOnce();
  });
}

function startBackend() {
  const nodeBin = resolveNodeBinary();
  const serverEntry = path.join(appRoot(), 'server', 'index.js');
  const port = PREFERRED_PORT;

  serverProc = spawn(nodeBin, [serverEntry], {
    cwd: appRoot(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DOCKTERM_ROOT: appRoot(),
      HOST: '127.0.0.1',
      PORT: String(port),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout?.on('data', (buf) => {
    process.stdout.write(`[dockterm-server] ${buf}`);
  });
  serverProc.stderr?.on('data', (buf) => {
    process.stderr.write(`[dockterm-server] ${buf}`);
  });
  serverProc.on('exit', (code, signal) => {
    console.error(`DockTerm server exited code=${code} signal=${signal}`);
    serverProc = null;
  });

  return waitForServer(port).then((p) => {
    serverPort = p;
    return p;
  });
}

async function ensureBackend() {
  if (serverPort && (await probeServer(serverPort))) {
    return serverPort;
  }
  if (await probeServer(PREFERRED_PORT)) {
    serverPort = PREFERRED_PORT;
    return serverPort;
  }
  return startBackend();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Close acts as minimize-to-background; keep UI process + backend + WS.
  if (mainWindow.isMinimized()) return;
  mainWindow.minimize();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function wireWindowControls() {
  ipcMain.removeHandler('window:isMaximized');
  ipcMain.removeHandler('dialog:pickIdentityFile');
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
    // Close = hide to background (do not quit / kill backend).
    if (win === mainWindow) hideMainWindow();
    else win.close();
  });
  ipcMain.handle('window:isMaximized', (event) => {
    return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized());
  });
  ipcMain.handle('dialog:pickIdentityFile', async (event) => {
    const { dialog } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select SSH identity file',
      properties: ['openFile'],
      defaultPath: require('os').homedir() + '/.ssh',
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return result.filePaths[0];
  });
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

/** Native menu without Chromium/browser defaults (no View/Help/visible Edit). */
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
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });

    template.push({
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || mainWindow;
            if (win && !win.isDestroyed()) win.close();
          },
        },
      ],
    });
  } else {
    // Framed-less Windows/Linux: only Quit — no always-on Edit/View chrome.
    template.push({
      label: 'File',
      submenu: [{ role: 'quit' }],
    });
  }

  // Hidden: keeps ⌘C / ⌘V / ⌘A working without a visible Edit menu.
  template.push({
    label: 'Edit',
    visible: false,
    submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow(buildWindowOptions());

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Close / red traffic light → hide; keep backend + WS alive until Quit.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hideMainWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Show splash immediately while backend boots.
  const splashPath = path.join(__dirname, 'splash.html');
  await mainWindow.loadFile(splashPath);

  try {
    const port = await ensureBackend();
    await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  } catch (err) {
    throw err;
  }
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

app.whenReady().then(() => {
  wireWindowControls();
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

  createWindow().catch((err) => {
    console.error('DockTerm failed to start:', err);
    const { dialog } = require('electron');
    dialog.showErrorBox('DockTerm failed to start', String(err?.message || err));
    isQuitting = true;
    app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow().catch((err) => {
        console.error(err);
        const { dialog } = require('electron');
        dialog.showErrorBox(
          'DockTerm failed to start',
          String(err?.message || err)
        );
      });
      return;
    }
    showMainWindow();
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
