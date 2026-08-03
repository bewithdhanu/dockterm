/**
 * Notarize the signed .app after electron-builder signs it.
 * Skips automatically when Apple credentials are not configured
 * (local unsigned builds / CI without secrets still work).
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (process.env.SKIP_NOTARIZE === '1' || process.env.SKIP_NOTARIZE === 'true') {
    console.log('Skipping notarization (SKIP_NOTARIZE set)');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      'Skipping notarization — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID for Gatekeeper-ready builds.'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}…`);
  const { notarize } = require('@electron/notarize');
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log('Notarization complete');
};
