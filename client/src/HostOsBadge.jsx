import { FaAws, FaWindows } from 'react-icons/fa';
import { LuTerminal } from 'react-icons/lu';
import {
  SiAlmalinux,
  SiAlpinelinux,
  SiApple,
  SiArchlinux,
  SiCentos,
  SiDebian,
  SiFedora,
  SiFreebsd,
  SiKalilinux,
  SiLinux,
  SiLinuxmint,
  SiOpensuse,
  SiPopos,
  SiRaspberrypi,
  SiRedhat,
  SiRockylinux,
  SiSuse,
  SiUbuntu,
} from 'react-icons/si';

const META = {
  ubuntu: { title: 'Ubuntu', color: '#E95420', Icon: SiUbuntu },
  debian: { title: 'Debian', color: '#A80030', Icon: SiDebian },
  fedora: { title: 'Fedora', color: '#51A2DA', Icon: SiFedora },
  centos: { title: 'CentOS', color: '#262577', Icon: SiCentos },
  rhel: { title: 'RHEL', color: '#EE0000', Icon: SiRedhat },
  rocky: { title: 'Rocky Linux', color: '#10B981', Icon: SiRockylinux },
  alma: { title: 'AlmaLinux', color: '#0F6CBD', Icon: SiAlmalinux },
  alpine: { title: 'Alpine', color: '#0D597F', Icon: SiAlpinelinux },
  amazon: { title: 'Amazon Linux', color: '#FF9900', Icon: FaAws },
  arch: { title: 'Arch', color: '#1793D1', Icon: SiArchlinux },
  opensuse: { title: 'openSUSE', color: '#73BA25', Icon: SiOpensuse },
  suse: { title: 'SUSE', color: '#0C322C', Icon: SiSuse },
  macos: { title: 'macOS', color: '#A2AAAD', Icon: SiApple },
  windows: { title: 'Windows', color: '#0078D4', Icon: FaWindows },
  freebsd: { title: 'FreeBSD', color: '#AB2B28', Icon: SiFreebsd },
  kali: { title: 'Kali', color: '#557C94', Icon: SiKalilinux },
  raspbian: { title: 'Raspberry Pi OS', color: '#C51A4A', Icon: SiRaspberrypi },
  pop: { title: 'Pop!_OS', color: '#48B9C7', Icon: SiPopos },
  mint: { title: 'Linux Mint', color: '#87CF3E', Icon: SiLinuxmint },
  linux: { title: 'Linux', color: '#FCC624', Icon: SiLinux },
  unknown: { title: 'SSH', color: '#f97316', Icon: LuTerminal },
};

/**
 * @param {{
 *  osId?: string | null,
 *  status?: 'connecting' | 'connected' | null,
 *  className?: string,
 *  title?: string,
 *  size?: number,
 * }} props
 */
export function HostOsBadge({
  osId,
  status = null,
  className = '',
  title,
  size = 18,
}) {
  const meta = META[osId] || META.unknown;
  const Icon = meta.Icon;
  const statusClass = status ? `status-${status}` : '';

  return (
    <div
      className={`host-os-badge ${statusClass} ${className}`.trim()}
      style={{ color: meta.color }}
      title={title || meta.title}
      aria-hidden="true"
    >
      <Icon size={size} />
    </div>
  );
}
