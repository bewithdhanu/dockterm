import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DETECT_SCRIPT = `
set +e
ID=unknown
LIKE=
PRETTY=
KERNEL=\`uname -s 2>/dev/null || echo\`
if [ -r /etc/os-release ]; then
  . /etc/os-release 2>/dev/null
  ID=\${ID:-unknown}
  LIKE=\${ID_LIKE:-}
  PRETTY=\${PRETTY_NAME:-\${NAME:-}}
elif command -v sw_vers >/dev/null 2>&1; then
  ID=macos
  PRETTY="macOS \`sw_vers -productVersion 2>/dev/null\`"
elif [ "\$KERNEL" = Darwin ]; then
  ID=macos
  PRETTY=macOS
elif [ "\$KERNEL" = FreeBSD ]; then
  ID=freebsd
  PRETTY=FreeBSD
elif echo "\$KERNEL" | grep -qiE 'mingw|msys|cygwin'; then
  ID=windows
  PRETTY=Windows
elif command -v powershell.exe >/dev/null 2>&1 || command -v powershell >/dev/null 2>&1; then
  ID=windows
  PRETTY=Windows
elif [ "\$KERNEL" = Linux ]; then
  ID=linux
  PRETTY=Linux
fi
printf 'ID=%s\\n' "\$ID"
printf 'LIKE=%s\\n' "\$LIKE"
printf 'PRETTY=%s\\n' "\$PRETTY"
printf 'KERNEL=%s\\n' "\$KERNEL"
`;

const LABEL = {
  ubuntu: 'Ubuntu',
  debian: 'Debian',
  fedora: 'Fedora',
  centos: 'CentOS',
  rhel: 'RHEL',
  rocky: 'Rocky',
  alma: 'AlmaLinux',
  alpine: 'Alpine',
  amazon: 'Amazon Linux',
  arch: 'Arch',
  opensuse: 'openSUSE',
  suse: 'SUSE',
  macos: 'macOS',
  windows: 'Windows',
  freebsd: 'FreeBSD',
  kali: 'Kali',
  raspbian: 'Raspberry Pi OS',
  pop: 'Pop!_OS',
  mint: 'Linux Mint',
  linux: 'Linux',
  unknown: 'SSH',
};

function normalizeOsId(id, like, pretty, kernel) {
  const raw = String(id || '').toLowerCase().trim();
  const likes = String(like || '')
    .toLowerCase()
    .split(/[\s]+/)
    .filter(Boolean);
  const p = String(pretty || '').toLowerCase();
  const k = String(kernel || '').toLowerCase();

  const aliases = {
    ubuntu: 'ubuntu',
    debian: 'debian',
    fedora: 'fedora',
    centos: 'centos',
    rhel: 'rhel',
    rocky: 'rocky',
    almalinux: 'alma',
    alma: 'alma',
    alpine: 'alpine',
    amzn: 'amazon',
    amazon: 'amazon',
    arch: 'arch',
    opensuse: 'opensuse',
    'opensuse-leap': 'opensuse',
    'opensuse-tumbleweed': 'opensuse',
    sles: 'suse',
    suse: 'suse',
    macos: 'macos',
    darwin: 'macos',
    windows: 'windows',
    win32: 'windows',
    freebsd: 'freebsd',
    kali: 'kali',
    raspbian: 'raspbian',
    raspberry: 'raspbian',
    pop: 'pop',
    'pop-os': 'pop',
    linuxmint: 'mint',
    mint: 'mint',
    linux: 'linux',
  };

  if (aliases[raw]) return aliases[raw];

  for (const token of likes) {
    if (aliases[token]) return aliases[token];
  }

  if (p.includes('ubuntu')) return 'ubuntu';
  if (p.includes('debian')) return 'debian';
  if (p.includes('fedora')) return 'fedora';
  if (p.includes('centos')) return 'centos';
  if (p.includes('red hat') || p.includes('rhel')) return 'rhel';
  if (p.includes('rocky')) return 'rocky';
  if (p.includes('alma')) return 'alma';
  if (p.includes('alpine')) return 'alpine';
  if (p.includes('amazon')) return 'amazon';
  if (p.includes('arch')) return 'arch';
  if (p.includes('suse')) return 'opensuse';
  if (p.includes('kali')) return 'kali';
  if (p.includes('mint')) return 'mint';
  if (p.includes('pop')) return 'pop';
  if (k.includes('darwin') || p.includes('macos') || p.includes('mac os')) {
    return 'macos';
  }
  if (k.includes('win') || p.includes('windows')) return 'windows';
  if (k.includes('freebsd')) return 'freebsd';
  if (k.includes('linux') || raw === 'linux') return 'linux';

  return 'unknown';
}

function parseDetectOutput(stdout) {
  const fields = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    fields[line.slice(0, i)] = line.slice(i + 1);
  }
  const id = normalizeOsId(
    fields.ID,
    fields.LIKE,
    fields.PRETTY,
    fields.KERNEL
  );
  return {
    id,
    label: LABEL[id] || LABEL.unknown,
    pretty: fields.PRETTY || LABEL[id] || 'Unknown',
    kernel: fields.KERNEL || null,
  };
}

/**
 * Detect remote OS for an SSH config Host alias via a one-shot ssh command.
 * Does not touch the interactive PTY session.
 */
export async function detectHostOs(alias) {
  const host = String(alias || '').trim();
  if (!host) throw new Error('Host alias required');
  if (/[\r\n]/.test(host)) throw new Error('Invalid host alias');

  const { stdout, stderr } = await execFileAsync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'ConnectionAttempts=1',
      '-o',
      'StrictHostKeyChecking=accept-new',
      host,
      DETECT_SCRIPT,
    ],
    {
      timeout: 15000,
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      env: process.env,
    }
  ).catch((err) => {
    const msg =
      err?.stderr ||
      err?.message ||
      (err instanceof Error ? err.message : String(err));
    throw new Error(String(msg).trim() || 'OS detection failed');
  });

  if (!stdout || !String(stdout).trim()) {
    throw new Error(
      stderr ? String(stderr).trim() : 'Empty OS detection response'
    );
  }

  return parseDetectOutput(stdout);
}

export { LABEL as OS_LABELS, normalizeOsId, parseDetectOutput };
