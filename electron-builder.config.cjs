/**
 * Unsigned macOS releases use ad-hoc signing (identity "-").
 * That produces a sealed signature so Gatekeeper shows "could not verify"
 * / Open Anyway — not the unrecoverable "damaged, Move to Trash" dialog.
 *
 * When CSC_LINK is set, Developer ID signing + optional notarization apply.
 */
const hasDeveloperId = Boolean(
  process.env.CSC_LINK && String(process.env.CSC_LINK).trim()
);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.dockterm.desktop',
  productName: 'DockTerm',
  copyright: 'Copyright © DockTerm',
  directories: {
    output: 'release',
  },
  files: [
    'client/dist/**/*',
    'server/**/*',
    'electron/**/*',
    'runtime/**/*',
    'build/icon.png',
    'build/icon.icns',
    'build/entitlements.mac.plist',
    'scripts/notarize.cjs',
    'package.json',
  ],
  asar: false,
  npmRebuild: false,
  buildDependenciesFromSource: false,
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    // "-" = ad-hoc; omit identity when CSC_LINK imports a Developer ID cert
    ...(hasDeveloperId ? {} : { identity: '-' }),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: false,
  },
  afterSign: 'scripts/notarize.cjs',
  win: {
    icon: 'build/icon.png',
    target: ['nsis'],
  },
  linux: {
    icon: 'build/icon.png',
    target: ['AppImage'],
    category: 'TerminalEmulator',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
