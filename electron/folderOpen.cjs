const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

const TAB_SERVICE = 'New DockTerm Tab at Folder';
const WINDOW_SERVICE = 'New DockTerm at Folder';
const WIN_TAB_VERB = 'DockTerm.NewTab';
const WIN_WINDOW_VERB = 'DockTerm.NewWindow';

function stripArgQuotes(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function decodeMaybeUri(value) {
  const s = String(value || '');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function decodeBase64Path(raw) {
  try {
    const padded = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function pathFromFileUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'file:') return '';
    let p = decodeMaybeUri(u.pathname || '');
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p.replace(/\//g, path.sep);
  } catch {
    return '';
  }
}

function isRuntimeArg(value) {
  const a = stripArgQuotes(value);
  if (!a) return true;
  if (a === '.' || a === '--') return true;
  if (a.startsWith('-') && !a.startsWith('--new-tab') && !a.startsWith('--new-window')) {
    return true;
  }
  if (/\.(exe|asar|cjs|js|mjs|dll)$/i.test(a)) return true;
  const base = path.basename(a).toLowerCase();
  return base === 'electron' || base === 'electron.exe';
}

/**
 * Parse CLI / protocol opens.
 * macOS Finder must use dockterm:// (open-url). --args is not delivered to a
 * running Mac app. Windows uses --new-tab/--new-window via second-instance.
 * @param {string[]} argv
 * @param {{ allowPositional?: boolean }} [opts]
 * @returns {{ mode: 'tab' | 'window', cwd: string }[]}
 */
function parseOpenRequestsFromArgv(argv, opts = {}) {
  /** @type {{ mode: 'tab' | 'window', cwd: string }[]} */
  const out = [];
  const args = Array.isArray(argv) ? argv.slice() : [];
  const allowPositional = opts.allowPositional === true;

  for (let i = 0; i < args.length; i += 1) {
    const a = stripArgQuotes(args[i]);
    if (a === '--new-tab' || a === '--new-window') {
      const mode = a === '--new-tab' ? 'tab' : 'window';
      const next = args[i + 1] && !String(args[i + 1]).startsWith('-')
        ? stripArgQuotes(args[++i])
        : '';
      if (next) out.push({ mode, cwd: next });
      continue;
    }
    if (a.startsWith('--new-tab=')) {
      const cwd = stripArgQuotes(a.slice('--new-tab='.length));
      if (cwd) out.push({ mode: 'tab', cwd });
      continue;
    }
    if (a.startsWith('--new-window=')) {
      const cwd = stripArgQuotes(a.slice('--new-window='.length));
      if (cwd) out.push({ mode: 'window', cwd });
      continue;
    }
    if (a.startsWith('dockterm:')) {
      const parsed = parseOpenRequestFromUrl(a);
      if (parsed) out.push(parsed);
      continue;
    }
    if (allowPositional && a.startsWith('file:')) {
      const cwd = pathFromFileUrl(a);
      if (cwd) out.push({ mode: 'tab', cwd });
      continue;
    }
    if (allowPositional && !isRuntimeArg(a)) {
      out.push({ mode: 'tab', cwd: a });
    }
  }
  return out;
}

/**
 * @param {string} rawUrl
 * @returns {{ mode: 'tab' | 'window', cwd: string } | null}
 */
function parseOpenRequestFromUrl(rawUrl) {
  try {
    const u = new URL(stripArgQuotes(rawUrl));
    if (u.protocol !== 'dockterm:') return null;
    const host = (u.hostname || u.host || '').toLowerCase();
    const pathPart = (u.pathname || '').replace(/^\/+/, '');
    const kind = host || pathPart;
    let mode = null;
    if (kind === 'new-tab' || kind === 'tab') mode = 'tab';
    if (kind === 'new-window' || kind === 'window') mode = 'window';
    if (!mode) return null;
    const b64 = u.searchParams.get('p');
    const cwd = b64
      ? decodeBase64Path(b64)
      : u.searchParams.get('path') ||
        u.searchParams.get('cwd') ||
        u.searchParams.get('folder') ||
        '';
    if (!cwd) return null;
    return { mode, cwd: decodeMaybeUri(cwd) };
  } catch {
    return null;
  }
}

function resolveDockTermAppPath(fallbackAppPath) {
  try {
    if (process.platform === 'darwin') {
      const exe = process.execPath || '';
      const m = exe.match(/^(.*\.app)\//);
      if (m?.[1] && fs.existsSync(m[1])) return m[1];
    }
  } catch {
    /* ignore */
  }
  if (fallbackAppPath && fs.existsSync(fallbackAppPath)) {
    const m = String(fallbackAppPath).match(/^(.*\.app)(?:\/|$)/);
    if (m?.[1] && fs.existsSync(m[1])) return m[1];
  }
  return '/Applications/DockTerm.app';
}

function writePlist(filePath, obj) {
  const tmp = `${filePath}.tmp.json`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  const r = spawnSync(
    'plutil',
    ['-convert', 'xml1', tmp, '-o', filePath],
    { encoding: 'utf8' }
  );
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (r.status !== 0) {
    throw new Error(
      `plutil failed for ${path.basename(filePath)}: ${r.stderr || r.stdout || r.status}`
    );
  }
}

function buildShellCommand(_appPath, mode) {
  const kind = mode === 'tab' ? 'new-tab' : 'new-window';
  // Electron on macOS: running apps get dockterm:// via open-url.
  // `open -n --args` does not deliver flags to the existing instance.
  return [
    '#!/bin/sh',
    'for f in "$@"; do',
    '  if [ ! -d "$f" ]; then f=$(dirname "$f"); fi',
    '  enc=$(/usr/bin/python3 -c \'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))\' "$f")',
    `  /usr/bin/open "dockterm://${kind}?path=$enc"`,
    'done',
  ].join('\n');
}

/**
 * Install a Finder Quick Action as an Automator .workflow
 * (same pattern as working third-party services like Tabby).
 */
function ensureServiceWorkflow(servicesDir, title, appPath, mode) {
  const dest = path.join(servicesDir, `${title}.workflow`);
  const contents = path.join(dest, 'Contents');

  // Remove prior broken AppleScript .app services and any old workflow.
  for (const stale of [
    path.join(servicesDir, `${title}.app`),
    dest,
  ]) {
    try {
      if (fs.existsSync(stale)) fs.rmSync(stale, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(contents, { recursive: true });

  const info = {
    NSServices: [
      {
        NSBackgroundColorName: 'background',
        NSIconName: 'NSActionTemplate',
        NSMenuItem: { default: title },
        NSMessage: 'runWorkflowAsService',
        NSRequiredContext: {
          NSApplicationIdentifier: 'com.apple.finder',
        },
        NSSendFileTypes: ['public.folder'],
      },
    ],
  };
  writePlist(path.join(contents, 'Info.plist'), info);

  const inputUUID = randomUUID().toUpperCase();
  const outputUUID = randomUUID().toUpperCase();
  const actionUUID = randomUUID().toUpperCase();

  const document = {
    AMApplicationBuild: '444.38',
    AMApplicationVersion: '2.9',
    AMDocumentVersion: '2',
    actions: [
      {
        action: {
          ActionBundlePath:
            '/System/Library/Automator/Run Shell Script.action',
          ActionName: 'Run Shell Script',
          ActionParameters: {
            CheckedForUserDefaultShell: true,
            COMMAND_STRING: buildShellCommand(appPath, mode),
            inputMethod: 1,
            shell: '/bin/sh',
            source: '',
          },
          AMAccepts: {
            Container: 'List',
            Optional: true,
            Types: ['com.apple.cocoa.string'],
          },
          AMActionVersion: '2.0.3',
          AMApplication: ['Automator'],
          AMParameterProperties: {
            CheckedForUserDefaultShell: {},
            COMMAND_STRING: {},
            inputMethod: {},
            shell: {},
            source: {},
          },
          AMProvides: {
            Container: 'List',
            Types: ['com.apple.cocoa.string'],
          },
          BundleIdentifier: 'com.apple.RunShellScript',
          CanShowSelectedItemsWhenRun: false,
          CanShowWhenRun: true,
          Category: ['AMCategoryUtilities'],
          CFBundleVersion: '2.0.3',
          'Class Name': 'RunShellScriptAction',
          InputUUID: inputUUID,
          isViewVisible: true,
          Keywords: ['Shell', 'Script', 'Command', 'Run', 'Unix'],
          OutputUUID: outputUUID,
          UnlocalizedApplications: ['Automator'],
          UUID: actionUUID,
        },
        isViewVisible: true,
      },
    ],
    connectors: {},
    workflowMetaData: {
      applicationBundleID: 'com.apple.finder',
      applicationBundleIDsByPath: {
        '/System/Library/CoreServices/Finder.app': 'com.apple.finder',
      },
      applicationPath: '/System/Library/CoreServices/Finder.app',
      applicationPaths: ['/System/Library/CoreServices/Finder.app'],
      inputTypeIdentifier: 'com.apple.Automator.fileSystemObject',
      outputTypeIdentifier: 'com.apple.Automator.nothing',
      presentationMode: 15,
      processesInput: 0,
      serviceApplicationBundleID: 'com.apple.finder',
      serviceApplicationPath: '/System/Library/CoreServices/Finder.app',
      serviceInputTypeIdentifier: 'com.apple.Automator.fileSystemObject',
      serviceOutputTypeIdentifier: 'com.apple.Automator.nothing',
      serviceProcessesInput: 0,
      systemImageName: 'NSActionTemplate',
      useAutomaticInputType: 0,
      workflowTypeIdentifier: 'com.apple.Automator.servicesMenu',
    },
  };
  writePlist(path.join(contents, 'document.wflow'), document);

  // Ad-hoc sign so Services can load the bundle after edits.
  spawnSync('codesign', ['--force', '--deep', '-s', '-', dest], {
    stdio: 'ignore',
  });

  return dest;
}

/**
 * Install Finder Services for folder context menus.
 * @param {string} [fallbackAppPath]
 * @returns {{ ok: boolean, servicesDir: string, installed: string[], error?: string }}
 */
function installFinderServices(fallbackAppPath) {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      servicesDir: '',
      installed: [],
      error: 'Finder services are only available on macOS',
    };
  }

  const appPath = resolveDockTermAppPath(fallbackAppPath);
  const servicesDir = path.join(
    process.env.HOME || '',
    'Library',
    'Services'
  );

  try {
    fs.mkdirSync(servicesDir, { recursive: true });
    const installed = [
      ensureServiceWorkflow(servicesDir, TAB_SERVICE, appPath, 'tab'),
      ensureServiceWorkflow(servicesDir, WINDOW_SERVICE, appPath, 'window'),
    ];

    try {
      spawnSync('/System/Library/CoreServices/pbs', ['-flush'], {
        stdio: 'ignore',
      });
    } catch {
      /* ignore */
    }

    return { ok: true, servicesDir, installed };
  } catch (err) {
    return {
      ok: false,
      servicesDir,
      installed: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function runReg(args) {
  const r = spawnSync('reg', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `reg ${args.join(' ')} failed`).trim()
    );
  }
}

function winLaunchCommand(opts, flag, folderToken) {
  const exe = String(opts?.exePath || '').trim();
  if (!exe) throw new Error('Windows launch path is missing');
  const extra = Array.isArray(opts.extraArgs) ? opts.extraArgs : [];
  const parts = [`"${exe}"`, ...extra.map((a) => `"${a}"`)];
  if (flag) parts.push(flag);
  parts.push(`"${folderToken}"`);
  return parts.join(' ');
}

function writeWinShellVerb(key, title, command, iconPath) {
  runReg(['add', key, '/ve', '/d', title, '/f']);
  if (iconPath) {
    runReg(['add', key, '/v', 'Icon', '/t', 'REG_SZ', '/d', iconPath, '/f']);
  }
  runReg(['add', `${key}\\command`, '/ve', '/d', command, '/f']);
}

/**
 * HKCU Explorer verbs + Open with handler (no admin).
 * @param {{ exePath: string, extraArgs?: string[] }} opts
 * @returns {{ ok: boolean, installed: string[], error?: string }}
 */
function installExplorerMenus(opts) {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      installed: [],
      error: 'Explorer menus are only available on Windows',
    };
  }

  try {
    const icon = `${opts.exePath},0`;
    const tabCmd = winLaunchCommand(opts, '--new-tab', '%1');
    const winCmd = winLaunchCommand(opts, '--new-window', '%1');
    const tabHere = winLaunchCommand(opts, '--new-tab', '%V');
    const winHere = winLaunchCommand(opts, '--new-window', '%V');
    const roots = [
      ['Directory\\shell', '%1'],
      ['Drive\\shell', '%1'],
      ['Directory\\Background\\shell', '%V'],
    ];
    const installed = [];

    for (const [root, token] of roots) {
      const tabKey = `HKCU\\Software\\Classes\\${root}\\${WIN_TAB_VERB}`;
      const winKey = `HKCU\\Software\\Classes\\${root}\\${WIN_WINDOW_VERB}`;
      const tab = token === '%V' ? tabHere : tabCmd;
      const win = token === '%V' ? winHere : winCmd;
      writeWinShellVerb(tabKey, TAB_SERVICE, tab, icon);
      writeWinShellVerb(winKey, WINDOW_SERVICE, win, icon);
      installed.push(tabKey, winKey);
    }

    const appKey = 'HKCU\\Software\\Classes\\Applications\\DockTerm.exe';
    writeWinShellVerb(`${appKey}\\shell\\open`, TAB_SERVICE, tabCmd, icon);
    writeWinShellVerb(
      `${appKey}\\shell\\openNewWindow`,
      WINDOW_SERVICE,
      winCmd,
      icon
    );
    runReg([
      'add',
      'HKCU\\Software\\Classes\\Directory\\OpenWithList\\DockTerm.exe',
      '/f',
    ]);
    installed.push(`${appKey}\\shell\\open`, `${appKey}\\shell\\openNewWindow`);

    return { ok: true, installed };
  } catch (err) {
    return {
      ok: false,
      installed: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Platform folder-open integration (Finder on macOS, Explorer on Windows).
 * @param {string} [fallbackAppPath]
 * @param {{ exePath?: string, extraArgs?: string[] }} [winOpts]
 */
function installFolderOpenIntegration(fallbackAppPath, winOpts) {
  if (process.platform === 'win32') {
    return installExplorerMenus(winOpts || { exePath: fallbackAppPath });
  }
  return installFinderServices(fallbackAppPath);
}

module.exports = {
  TAB_SERVICE,
  WINDOW_SERVICE,
  parseOpenRequestsFromArgv,
  parseOpenRequestFromUrl,
  installFinderServices,
  installExplorerMenus,
  installFolderOpenIntegration,
  resolveDockTermAppPath,
  isRuntimeArg,
  pathFromFileUrl,
};
