import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Native file picker for local DockTerm server (web / non-Electron).
 * @returns {Promise<string|null>} Absolute path, or null if cancelled.
 */
export async function pickIdentityFileNative() {
  const defaultDir = path.join(os.homedir(), '.ssh');

  if (process.platform === 'darwin') {
    const script = `
      set theDefault to POSIX file "${defaultDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
      try
        POSIX path of (choose file with prompt "Select SSH identity file" default location theDefault)
      on error number -128
        return ""
      end try
    `;
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const p = String(stdout || '').trim();
    return p || null;
  }

  if (process.platform === 'linux') {
    try {
      const { stdout } = await execFileAsync(
        'zenity',
        [
          '--file-selection',
          '--title=Select SSH identity file',
          `--filename=${defaultDir}/`,
        ],
        { encoding: 'utf8' }
      );
      const p = String(stdout || '').trim();
      return p || null;
    } catch (err) {
      if (err?.code === 1) return null;
      throw new Error(
        'File picker needs zenity on Linux (or use the desktop app).'
      );
    }
  }

  if (process.platform === 'win32') {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'Select SSH identity file'
$d.InitialDirectory = '${defaultDir.replace(/'/g, "''")}'
$d.Filter = 'All files (*.*)|*.*'
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName } else { '' }
`;
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-Command', ps],
      { encoding: 'utf8', windowsHide: true }
    );
    const p = String(stdout || '').trim();
    return p || null;
  }

  throw new Error('Native file picker is not available on this platform');
}
