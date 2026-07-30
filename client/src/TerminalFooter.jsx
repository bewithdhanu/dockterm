import { useEffect, useMemo, useRef, useState } from 'react';

function formatRate(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let n = bytesPerSec;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Footer under each terminal: status, I/O rates, stats / pkill / processes.
 */
export function TerminalFooter({
  id,
  send,
  registerStatsHandlers,
  connected,
  alive = true,
  sshStatus = null,
  sshHost = null,
}) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [pkillOpen, setPkillOpen] = useState(false);
  const [procsOpen, setProcsOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [procs, setProcs] = useState([]);
  const [procSort, setProcSort] = useState('cpu'); // name | cpu | mem | etime | pid
  const [procSortDir, setProcSortDir] = useState('desc');
  const [procQuery, setProcQuery] = useState('');
  const [killPid, setKillPid] = useState('');
  const [killForce, setKillForce] = useState(false);
  const [remoteOs, setRemoteOs] = useState('unix');
  const [killMsg, setKillMsg] = useState(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const connecting = sshStatus === 'connecting' && alive !== false;
  const sessionDown =
    !connected ||
    alive === false ||
    sshStatus === 'error';
  const toolsReady = !sessionDown && !connecting;

  useEffect(() => {
    const unregister = registerStatsHandlers(id, {
      onStats: (msg) => {
        setStats(msg);
        if (Array.isArray(msg.processes) && msg.processes.length) {
          setProcs(msg.processes);
        }
        if (msg?.kind === 'ssh' && msg.platform) {
          setRemoteOs(msg.platform === 'win32' ? 'win32' : 'unix');
        }
      },
      onKillResult: (msg) => {
        setKillMsg(
          msg.ok
            ? `Killed PID ${msg.pid} (${msg.method})`
            : msg.error || 'Kill failed'
        );
      },
    });
    return unregister;
  }, [id, registerStatsHandlers]);

  useEffect(() => {
    if (!toolsReady) return;
    const tick = () =>
      sendRef.current({
        type: 'stats',
        id,
        processes: procsOpen,
      });
    tick();
    const ms = statsOpen || procsOpen ? 1500 : 2500;
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  }, [id, statsOpen, procsOpen, toolsReady]);

  useEffect(() => {
    if (toolsReady) return;
    setStatsOpen(false);
    setPkillOpen(false);
    setProcsOpen(false);
  }, [toolsReady]);

  const statusLabel = !connected
    ? 'Disconnected'
    : alive === false || stats?.alive === false || sshStatus === 'error'
      ? sshHost || stats?.kind === 'ssh'
        ? `SSH · ${sshHost || stats?.sshHost || 'remote'} · failed`
        : 'Exited'
      : connecting
        ? `SSH · ${sshHost || stats?.sshHost || 'remote'} · connecting…`
        : stats?.kind === 'ssh' || sshHost
          ? `SSH · ${sshHost || stats.sshHost || 'remote'}`
          : 'Connected';

  const statusState = sessionDown || stats?.alive === false
    ? 'down'
    : connecting
      ? 'connecting'
      : 'ok';
  const inRate = stats?.inRate ?? 0;
  const outRate = stats?.outRate ?? 0;
  const panelOpen = toolsReady && (statsOpen || pkillOpen || procsOpen);

  const sortedProcs = useMemo(() => {
    const q = procQuery.trim().toLowerCase();
    let list = !q
      ? [...procs]
      : procs.filter((p) => {
          const name = String(p.name || '').toLowerCase();
          const pid = String(p.pid ?? '');
          return name.includes(q) || pid.includes(q);
        });
    const dir = procSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (procSort === 'pid') {
        return dir * ((a.pid || 0) - (b.pid || 0));
      }
      if (procSort === 'name') {
        return dir * String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (procSort === 'cpu') {
        return dir * ((a.cpu || 0) - (b.cpu || 0));
      }
      if (procSort === 'mem') {
        return dir * ((a.mem || a.rss || 0) - (b.mem || b.rss || 0));
      }
      if (procSort === 'etime') {
        return dir * ((a.etimeSec || 0) - (b.etimeSec || 0));
      }
      return 0;
    });
    return list;
  }, [procs, procSort, procSortDir, procQuery]);

  const toggleSort = (key) => {
    if (procSort === key) {
      setProcSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setProcSort(key);
      setProcSortDir(key === 'name' || key === 'pid' ? 'asc' : 'desc');
    }
  };

  const onKill = (e) => {
    e.preventDefault();
    setKillMsg(null);
    const pid = Number(String(killPid).trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      setKillMsg('Enter a valid PID');
      return;
    }
    send({
      type: 'kill',
      id,
      pid,
      force: killForce,
      remoteOs: stats?.kind === 'ssh' ? remoteOs : undefined,
    });
  };

  const killRow = (pid) => {
    setKillMsg(null);
    send({
      type: 'kill',
      id,
      pid,
      force: killForce,
      remoteOs: stats?.kind === 'ssh' ? remoteOs : undefined,
    });
  };

  return (
    <div className={`term-footer ${panelOpen ? 'open' : ''}`}>
      <div className="term-footer-bar">
        <div className="term-footer-left">
          <span
            className="term-footer-status"
            data-state={statusState}
            title={statusLabel}
          >
            <span className="term-footer-dot" />
            {statusLabel}
          </span>
          <span className="term-footer-io" title="Data in / out">
            <span className="io-in">↓ {formatRate(inRate)}</span>
            <span className="io-out">↑ {formatRate(outRate)}</span>
          </span>
        </div>
        <div className="term-footer-right">
          {toolsReady && (
            <>
              <button
                type="button"
                className={`term-footer-stats-btn ${procsOpen ? 'active' : ''}`}
                onClick={() => setProcsOpen((v) => !v)}
                title="Process list"
              >
                Procs
              </button>
              <button
                type="button"
                className={`term-footer-stats-btn ${pkillOpen ? 'active' : ''}`}
                onClick={() => setPkillOpen((v) => !v)}
                title="Kill process by PID"
              >
                pkill
              </button>
              <button
                type="button"
                className={`term-footer-stats-btn ${statsOpen ? 'active' : ''}`}
                onClick={() => setStatsOpen((v) => !v)}
                title="Session stats"
              >
                Stats
              </button>
            </>
          )}
        </div>
      </div>

      {statsOpen && (
        <div className="term-footer-panel">
          <div className="term-stats-grid">
            <div className="term-stat">
              <span className="term-stat-label">
                {stats?.kind === 'ssh' ? 'Remote OS' : 'OS'}
              </span>
              <span className="term-stat-value">
                {stats?.os || '…'}
                {stats?.arch ? ` · ${stats.arch}` : ''}
              </span>
            </div>
            <div className="term-stat">
              <span className="term-stat-label">CPU</span>
              <span className="term-stat-value">
                {stats?.cpuPercent != null ? `${stats.cpuPercent}%` : '—'}
              </span>
            </div>
            <div className="term-stat">
              <span className="term-stat-label">Disk</span>
              <span className="term-stat-value">
                {stats?.diskTotal
                  ? `${formatBytes(stats.diskUsed)} / ${formatBytes(stats.diskTotal)}`
                  : '—'}
              </span>
            </div>
            <div className="term-stat">
              <span className="term-stat-label">Public IP</span>
              <span className="term-stat-value">
                {stats?.publicIp || '—'}
              </span>
            </div>
            <div className="term-stat">
              <span className="term-stat-label">
                {stats?.kind === 'ssh' ? 'Host' : 'CWD'}
              </span>
              <span className="term-stat-value" title={stats?.cwd || ''}>
                {stats?.kind === 'ssh'
                  ? stats?.hostname || stats?.sshHost || '—'
                  : stats?.cwd || '—'}
              </span>
            </div>
            <div className="term-stat">
              <span className="term-stat-label">
                {stats?.kind === 'ssh' ? 'Alias' : 'Shell PID'}
              </span>
              <span className="term-stat-value">
                {stats?.kind === 'ssh'
                  ? stats?.sshHost || '—'
                  : stats?.pid ?? '—'}
              </span>
            </div>
          </div>

          {stats?.kind === 'ssh' && !stats?.error && (
            <p className="term-stats-note">
              Stats are from the remote host via SSH alias
              {stats?.sshHost ? ` “${stats.sshHost}”` : ''}.
            </p>
          )}

          {stats?.error && (
            <p className="term-stats-error">{stats.error}</p>
          )}
        </div>
      )}

      {procsOpen && (
        <div className="term-footer-panel term-procs-panel">
          <div className="term-procs-toolbar">
            <input
              type="search"
              className="term-procs-search"
              placeholder={
                stats?.kind === 'ssh'
                  ? 'Search remote processes…'
                  : 'Search processes…'
              }
              value={procQuery}
              onChange={(e) => setProcQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="term-procs-table-wrap">
            <table className="term-procs-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`term-th-btn ${procSort === 'pid' ? 'active' : ''}`}
                      onClick={() => toggleSort('pid')}
                    >
                      PID
                      <span className="term-th-arrow">
                        {procSort === 'pid'
                          ? procSortDir === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`term-th-btn ${procSort === 'name' ? 'active' : ''}`}
                      onClick={() => toggleSort('name')}
                    >
                      Name
                      <span className="term-th-arrow">
                        {procSort === 'name'
                          ? procSortDir === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`term-th-btn ${procSort === 'cpu' ? 'active' : ''}`}
                      onClick={() => toggleSort('cpu')}
                    >
                      CPU%
                      <span className="term-th-arrow">
                        {procSort === 'cpu'
                          ? procSortDir === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`term-th-btn ${procSort === 'mem' ? 'active' : ''}`}
                      onClick={() => toggleSort('mem')}
                    >
                      Usage
                      <span className="term-th-arrow">
                        {procSort === 'mem'
                          ? procSortDir === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </span>
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`term-th-btn ${procSort === 'etime' ? 'active' : ''}`}
                      onClick={() => toggleSort('etime')}
                    >
                      Runtime
                      <span className="term-th-arrow">
                        {procSort === 'etime'
                          ? procSortDir === 'asc'
                            ? '↑'
                            : '↓'
                          : ''}
                      </span>
                    </button>
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedProcs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="term-procs-empty">
                      {procs.length === 0
                        ? 'Loading processes…'
                        : 'No matching processes'}
                    </td>
                  </tr>
                )}
                {sortedProcs.map((p) => (
                  <tr key={`${p.pid}-${p.name}`}>
                    <td className="mono">{p.pid}</td>
                    <td className="name" title={p.name}>
                      {p.name}
                    </td>
                    <td className="mono">{(p.cpu || 0).toFixed(1)}</td>
                    <td className="mono">
                      {formatBytes(p.mem || p.rss || 0)}
                    </td>
                    <td className="mono">{p.etime || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="term-proc-kill"
                        title={`Kill ${p.pid}`}
                        onClick={() => killRow(p.pid)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pkillOpen && (
        <div className="term-footer-panel term-pkill-panel">
          <form className="term-kill" onSubmit={onKill}>
            <label className="term-kill-label" htmlFor={`kill-${id}`}>
              PID
            </label>
            <input
              id={`kill-${id}`}
              className="term-kill-input"
              type="text"
              inputMode="numeric"
              placeholder="PID"
              value={killPid}
              onChange={(e) => setKillPid(e.target.value)}
              autoFocus
            />
            {stats?.kind === 'ssh' && (
              <select
                className="term-kill-os"
                value={remoteOs}
                onChange={(e) => setRemoteOs(e.target.value)}
                title="Remote OS for kill command"
              >
                <option value="unix">Unix/macOS/Linux</option>
                <option value="win32">Windows</option>
              </select>
            )}
            <label className="term-kill-force">
              <input
                type="checkbox"
                checked={killForce}
                onChange={(e) => setKillForce(e.target.checked)}
              />
              Force
            </label>
            <button type="submit" className="term-kill-btn">
              pkill
            </button>
            {killMsg && <span className="term-kill-msg">{killMsg}</span>}
          </form>
        </div>
      )}
    </div>
  );
}
