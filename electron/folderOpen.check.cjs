const assert = require('assert');
const {
  parseOpenRequestsFromArgv,
  parseOpenRequestFromUrl,
  isRuntimeArg,
} = require('./folderOpen.cjs');

assert.deepStrictEqual(
  parseOpenRequestsFromArgv(['DockTerm.exe', '--new-tab', 'C:\\work\\app']),
  [{ mode: 'tab', cwd: 'C:\\work\\app' }]
);

assert.deepStrictEqual(
  parseOpenRequestsFromArgv(['--new-window=/tmp/proj']),
  [{ mode: 'window', cwd: '/tmp/proj' }]
);

assert.deepStrictEqual(
  parseOpenRequestsFromArgv(['dockterm://new-tab?path=/Users/me/src']),
  [{ mode: 'tab', cwd: '/Users/me/src' }]
);

assert.deepStrictEqual(
  parseOpenRequestFromUrl('"dockterm://new-window?path=C%3A%2FUsers%2Fme"'),
  { mode: 'window', cwd: 'C:/Users/me' }
);

assert.deepStrictEqual(
  parseOpenRequestFromUrl('dockterm://new-window?path=%2FUsers%2Fme%2FMy%20Folder'),
  { mode: 'window', cwd: '/Users/me/My Folder' }
);

assert.deepStrictEqual(
  parseOpenRequestFromUrl(
    `dockterm://new-tab?p=${Buffer.from('/Users/me/src').toString('base64')}`
  ),
  { mode: 'tab', cwd: '/Users/me/src' }
);

assert.deepStrictEqual(
  parseOpenRequestsFromArgv(
    ['C:\\Program Files\\DockTerm\\DockTerm.exe', 'D:\\repos\\api'],
    { allowPositional: true }
  ),
  [{ mode: 'tab', cwd: 'D:\\repos\\api' }]
);

assert.deepStrictEqual(
  parseOpenRequestsFromArgv(['electron', '.', '--enable-logging'], {
    allowPositional: true,
  }),
  []
);

assert.strictEqual(isRuntimeArg('DockTerm.exe'), true);
assert.strictEqual(isRuntimeArg('D:\\repos\\api'), false);

console.log('folderOpen.check.cjs ok');
