const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

const TAB_SERVICE = 'New DockTerm Tab at Folder';
const WINDOW_SERVICE = 'New DockTerm at Folder';

/**
 * Parse CLI / protocol opens.
 * @param {string[]} argv
 * @returns {{ mode: 'tab' | 'window', cwd: string }[]}
 */
function parseOpenRequestsFromArgv(argv) {
  /** @type {{ mode: 'tab' | 'window', cwd: string }[]} */
  const out = [];
  const args = Array.isArray(argv) ? argv.slice() : [];

  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i] || '');
    if (a === '--new-tab' || a === '--new-window') {
      const mode = a === '--new-tab' ? 'tab' : 'window';
      const cwd = args[i + 1] && !String(args[i + 1]).startsWith('-')
        ? String(args[++i])
        : '';
      if (cwd) out.push({ mode, cwd });
      continue;
    }
    if (a.startsWith('--new-tab=')) {
      const cwd = a.slice('--new-tab='.length);
      if (cwd) out.push({ mode: 'tab', cwd });
      continue;
    }
    if (a.startsWith('--new-window=')) {
      const cwd = a.slice('--new-window='.length);
      if (cwd) out.push({ mode: 'window', cwd });
      continue;
    }
    if (a.startsWith('dockterm://')) {
      const parsed = parseOpenRequestFromUrl(a);
      if (parsed) out.push(parsed);
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
    const u = new URL(String(rawUrl || ''));
    if (u.protocol !== 'dockterm:') return null;
    const host = (u.hostname || u.host || '').toLowerCase();
    const pathPart = (u.pathname || '').replace(/^\/+/, '');
    const kind = host || pathPart;
    let mode = null;
    if (kind === 'new-tab' || kind === 'tab') mode = 'tab';
    if (kind === 'new-window' || kind === 'window') mode = 'window';
    if (!mode) return null;
    const cwd =
      u.searchParams.get('path') ||
      u.searchParams.get('cwd') ||
      u.searchParams.get('folder') ||
      '';
    if (!cwd) return null;
    return { mode, cwd: decodeURIComponent(cwd) };
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
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

function buildShellCommand(appPath, mode) {
  const flag = mode === 'tab' ? '--new-tab' : '--new-window';
  const app = shellQuote(appPath);
  // inputMethod=1 → paths arrive as shell arguments.
  return [
    '#!/bin/sh',
    'for f in "$@"; do',
    '  if [ ! -d "$f" ]; then f=$(dirname "$f"); fi',
    `  open -na ${app} --args ${flag} "$f"`,
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

module.exports = {
  TAB_SERVICE,
  WINDOW_SERVICE,
  parseOpenRequestsFromArgv,
  parseOpenRequestFromUrl,
  installFinderServices,
  resolveDockTermAppPath,
};
