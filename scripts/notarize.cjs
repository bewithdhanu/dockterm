/**
 * Notarize the signed .app after electron-builder signs it.
 * Skips automatically when Apple credentials are not configured
 * (local unsigned builds / CI without secrets still work).
 *
 * Notarization often succeeds and then `stapler` fails with code 68 when
 * CloudKit drops the connection. @electron/notarize only retries that
 * immediately, so a short outage fails the whole release. Staple again
 * with a backoff; the ticket is already accepted.
 */
const { spawnSync } = require('child_process');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stapleOnce(appPath) {
  const result = spawnSync(
    'xcrun',
    ['stapler', 'staple', '-v', path.basename(appPath)],
    {
      cwd: path.dirname(appPath),
      encoding: 'utf8',
    }
  );
  return {
    code: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function isTransientStapleFailure(text) {
  return /Failed to staple|staple and validate action failed|Error 68|network connection was lost|NSURLErrorDomain|CloudKit/i.test(
    String(text || '')
  );
}

async function stapleWithBackoff(appPath) {
  const waits = [8000, 20000, 40000, 60000, 90000];
  let last = '';
  for (let attempt = 0; attempt <= waits.length; attempt += 1) {
    const result = stapleOnce(appPath);
    if (result.code === 0) {
      console.log('Staple complete');
      return;
    }
    last = result.output || `exit ${result.code}`;
    const transient = isTransientStapleFailure(last);
    if (!transient || attempt === waits.length) {
      throw new Error(
        `Failed to staple your application with code: ${result.code}\n\n${last.slice(-2500)}`
      );
    }
    const wait = waits[attempt];
    console.log(
      `Staple failed (Apple ticket lookup, exit ${result.code}). Retrying in ${wait / 1000}s (${attempt + 1}/${waits.length})…`
    );
    await sleep(wait);
  }
}

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

  // Ad-hoc / unsigned releases must not hit notarytool.
  if (!process.env.CSC_LINK || !String(process.env.CSC_LINK).trim()) {
    console.log('Skipping notarization — no CSC_LINK (ad-hoc macOS build).');
    return;
  }

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
  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isTransientStapleFailure(message)) throw err;
    console.log(
      'Notarization was accepted, but stapling lost the network. Retrying staple only…'
    );
    await stapleWithBackoff(appPath);
  }
  console.log('Notarization complete');
};
