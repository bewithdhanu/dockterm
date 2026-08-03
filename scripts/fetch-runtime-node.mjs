#!/usr/bin/env node
/**
 * Download an official Node.js binary into ./runtime for packaging with DockTerm.
 * The Electron app prefers this binary so end users need no system Node install.
 */
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const runtimeDir = path.join(root, 'runtime');

const NODE_VERSION = process.env.DOCKTERM_NODE_VERSION || '22.23.2';

function platArch(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return { key: 'darwin-arm64', ext: 'tar.gz', binary: 'bin/node' };
    if (arch === 'x64') return { key: 'darwin-x64', ext: 'tar.gz', binary: 'bin/node' };
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return { key: 'linux-arm64', ext: 'tar.xz', binary: 'bin/node' };
    if (arch === 'x64') return { key: 'linux-x64', ext: 'tar.xz', binary: 'bin/node' };
  }
  if (platform === 'win32') {
    if (arch === 'x64') return { key: 'win-x64', ext: 'zip', binary: 'node.exe' };
    if (arch === 'arm64') return { key: 'win-arm64', ext: 'zip', binary: 'node.exe' };
  }
  throw new Error(`Unsupported platform for bundled Node: ${platform}-${arch}`);
}

async function fileMatches(file, expectedVersion, expectedKey) {
  try {
    const version = (await fs.readFile(path.join(runtimeDir, 'VERSION'), 'utf8')).trim();
    const plat = (await fs.readFile(path.join(runtimeDir, 'PLATFORM'), 'utf8')).trim();
    await fs.access(file);
    return version === expectedVersion && plat === expectedKey;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function extractNode(archivePath, meta, outFile) {
  const staging = await fs.mkdtemp(path.join(tmpdir(), 'dockterm-node-'));
  try {
    if (meta.ext === 'tar.gz' || meta.ext === 'tar.xz') {
      execFileSync('tar', ['-xf', archivePath, '-C', staging], { stdio: 'inherit' });
    } else if (meta.ext === 'zip') {
      if (process.platform === 'win32') {
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${staging}' -Force`],
          { stdio: 'inherit' }
        );
      } else {
        execFileSync('unzip', ['-q', archivePath, '-d', staging], { stdio: 'inherit' });
      }
    }

    const entries = await fs.readdir(staging);
    const top = entries.find((e) => e.startsWith('node-v')) || entries[0];
    if (!top) throw new Error('Empty Node archive');
    const src = path.join(staging, top, meta.binary);
    await fs.copyFile(src, outFile);
    await fs.chmod(outFile, 0o755);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const meta = platArch();
  const outName = process.platform === 'win32' ? 'node.exe' : 'node';
  const outFile = path.join(runtimeDir, outName);

  await fs.mkdir(runtimeDir, { recursive: true });

  if (await fileMatches(outFile, NODE_VERSION, meta.key)) {
    console.log(`Bundled Node v${NODE_VERSION} (${meta.key}) already present`);
    return;
  }

  const base = `node-v${NODE_VERSION}-${meta.key}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${base}.${meta.ext}`;
  const archivePath = path.join(tmpdir(), `${base}.${meta.ext}`);

  console.log(`Downloading ${url}`);
  await download(url, archivePath);

  console.log(`Extracting ${meta.binary} → runtime/${outName}`);
  await extractNode(archivePath, meta, outFile);
  await fs.writeFile(path.join(runtimeDir, 'VERSION'), `${NODE_VERSION}\n`);
  await fs.writeFile(path.join(runtimeDir, 'PLATFORM'), `${meta.key}\n`);
  await fs.writeFile(
    path.join(runtimeDir, 'README'),
    `Official Node.js binary bundled for DockTerm.\nVersion: ${NODE_VERSION}\nPlatform: ${meta.key}\n`
  );

  try {
    await fs.unlink(archivePath);
  } catch {
    /* ignore */
  }

  // Sanity check
  const ver = execFileSync(outFile, ['-v'], { encoding: 'utf8' }).trim();
  console.log(`Bundled Node ready: ${ver} (${outFile})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
