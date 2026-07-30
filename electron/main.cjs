const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;
let serverPort = null;

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

function wireWindowControls() {
  ipcMain.removeHandler('window:isMaximized');
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
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle('window:isMaximized', (event) => {
    return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized());
  });
}

async function createWindow() {
  const port = await startBackend();
  const icon = resolveIcon();

  const windowOpts = {
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    title: 'DockTerm',
    backgroundColor: '#141414',
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

  mainWindow = new BrowserWindow(windowOpts);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err) => {
        console.error(err);
        const { dialog } = require('electron');
        dialog.showErrorBox('DockTerm failed to start', String(err?.message || err));
      });
    }
  });
});

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdown();
});
