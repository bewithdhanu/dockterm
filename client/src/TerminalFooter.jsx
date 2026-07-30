import { useEffect, useMemo, useRef, useState } from 'react';
import { LuSearch, LuX } from 'react-icons/lu';

const TOP_PROCS = 25;

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

function SortTh({ label, active, dir, onClick }) {
  return (
    <th>
      <button
        type="button"
        className={`term-th-btn ${active ? 'active' : ''}`}
        onClick={onClick}
      >
        {label}
        <span className="term-th-arrow">
          {active ? (dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  );
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
  const [ports, setPorts] = useState([]);
  const [portsNote, setPortsNote] = useState(null);
  const [procSort, setProcSort] = useState('cpu');
  const [procSortDir, setProcSortDir] = useState('desc');
  const [portSort, setPortSort] = useState('port');
  const [portSortDir, setPortSortDir] = useState('asc');
  const [procQuery, setProcQuery] = useState('');
  const [portQuery, setPortQuery] = useState('');
  const [killMode, setKillMode] = useState('pid'); // pid | port
  const [killTarget, setKillTarget] = useState('');
  const [killForce, setKillForce] = useState(false);
  const [remoteOs, setRemoteOs] = useState('unix');
  const [killMsg, setKillMsg] = useState(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const connecting = sshStatus === 'connecting' && alive !== false;
  const sessionDown =
    !connected || alive === false || sshStatus === 'error';
  const toolsReady = !sessionDown && !connecting;

  useEffect(() => {
    const unregister = registerStatsHandlers(id, {
      onStats: (msg) => {
        setStats(msg);
        if (Array.isArray(msg.processes)) setProcs(msg.processes);
        if (Array.isArray(msg.ports)) setPorts(msg.ports);
        setPortsNote(msg.portsNote || null);
        if (msg?.kind === 'ssh' && msg.platform) {
          setRemoteOs(msg.platform === 'win32' ? 'win32' : 'unix');
        }
      },
      onKillResult: (msg) => {
        if (msg.ok) {
          const who =
            msg.port != null
              ? `port ${msg.port}${
                  msg.pids?.length ? ` (PIDs ${msg.pids.join(', ')})` : ''
                }`
              : `PID ${msg.pid}`;
          setKillMsg(`Killed ${who} (${msg.method})`);
        } else {
          setKillMsg(msg.error || 'Kill failed');
        }
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

  const statusState =
    sessionDown || stats?.alive === false
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
      if (procSort === 'pid') return dir * ((a.pid || 0) - (b.pid || 0));
      if (procSort === 'name') {
        return dir * String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (procSort === 'cpu') return dir * ((a.cpu || 0) - (b.cpu || 0));
      if (procSort === 'mem') {
        return dir * ((a.mem || a.rss || 0) - (b.mem || b.rss || 0));
      }
      if (procSort === 'etime') {
        return dir * ((a.etimeSec || 0) - (b.etimeSec || 0));
      }
      return 0;
    });
    // Without search: top 25 heaviest under current sort.
    if (!q) list = list.slice(0, TOP_PROCS);
    return list;
  }, [procs, procSort, procSortDir, procQuery]);

  const sortedPorts = useMemo(() => {
    const q = portQuery.trim().toLowerCase();
    let list = !q
      ? [...ports]
      : ports.filter((p) => {
          const hay = `${p.port} ${p.name || ''} ${p.pid || ''} ${p.address || ''} ${p.proto || ''}`.toLowerCase();
          return hay.includes(q);
        });
    const dir = portSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (portSort === 'port') return dir * ((a.port || 0) - (b.port || 0));
      if (portSort === 'pid') return dir * ((a.pid || 0) - (b.pid || 0));
      if (portSort === 'name') {
        return dir * String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (portSort === 'proto') {
        return dir * String(a.proto || '').localeCompare(String(b.proto || ''));
      }
      if (portSort === 'address') {
        return (
          dir * String(a.address || '').localeCompare(String(b.address || ''))
        );
      }
      return 0;
    });
    return list;
  }, [ports, portSort, portSortDir, portQuery]);

  const toggleProcSort = (key) => {
    if (procSort === key) {
      setProcSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setProcSort(key);
      setProcSortDir(key === 'name' || key === 'pid' ? 'asc' : 'desc');
    }
  };

  const togglePortSort = (key) => {
    if (portSort === key) {
      setPortSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setPortSort(key);
      setPortSortDir('asc');
    }
  };

  const remoteOsArg = stats?.kind === 'ssh' ? remoteOs : undefined;

  const sendKill = ({ pid, port }) => {
    setKillMsg(null);
    send({
      type: 'kill',
      id,
      pid,
      port,
      force: killForce,
      remoteOs: remoteOsArg,
    });
  };

  const onKill = (e) => {
    e.preventDefault();
    setKillMsg(null);
    const raw = String(killTarget).trim();
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      setKillMsg(killMode === 'port' ? 'Enter a valid port' : 'Enter a valid PID');
      return;
    }
    if (killMode === 'port') {
      if (n > 65535) {
        setKillMsg('Port must be 1–65535');
        return;
      }
      sendKill({ port: n });
      return;
    }
    sendKill({ pid: n });
  };

  const openPanel = (which) => {
    setStatsOpen(which === 'stats' ? (v) => !v : false);
    setPkillOpen(which === 'pkill' ? (v) => !v : false);
    setProcsOpen(which === 'procs' ? (v) => !v : false);
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
                onClick={() => openPanel('procs')}
                title="Top processes & listening ports"
              >
                Procs
              </button>
              <button
                type="button"
                className={`term-footer-stats-btn ${pkillOpen ? 'active' : ''}`}
                onClick={() => openPanel('pkill')}
                title="Kill by PID or port"
              >
                pkill
              </button>
              <button
                type="button"
                className={`term-footer-stats-btn ${statsOpen ? 'active' : ''}`}
                onClick={() => openPanel('stats')}
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
              <span className="term-stat-label">RAM</span>
              <span className="term-stat-value">
                {stats?.ramTotal
                  ? `${formatBytes((stats.ramTotal || 0) - (stats.ramFree || 0))} / ${formatBytes(stats.ramTotal)}`
                  : '—'}
              </span>
            </div>
            <div className="term-stat">
              <span className="term-stat-label">Public IP</span>
              <span className="term-stat-value">{stats?.publicIp || '—'}</span>
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
            {stats?.kind === 'ssh' || stats?.sudoOk != null ? (
              <div className="term-stat">
                <span className="term-stat-label">sudo -n</span>
                <span className="term-stat-value">
                  {stats?.sudoOk ? 'available' : 'not available'}
                </span>
              </div>
            ) : null}
          </div>

          {stats?.kind === 'ssh' && !stats?.error && (
            <p className="term-stats-note">
              Stats are from the remote host via SSH alias
              {stats?.sshHost ? ` “${stats.sshHost}”` : ''}
              {stats?.sudoOk ? ' · using passwordless sudo when needed' : ''}.
            </p>
          )}

          {stats?.error && <p className="term-stats-error">{stats.error}</p>}
        </div>
      )}

      {procsOpen && (
        <div className="term-footer-panel term-procs-panel">
          <section className="term-procs-section">
            <div className="term-procs-section-head">
              <h3 className="term-procs-title">
                Top {TOP_PROCS} processes
                <span className="term-procs-count">
                  {procs.length
                    ? ` · ${Math.min(TOP_PROCS, procs.length)} shown`
                    : ''}
                </span>
              </h3>
              <div className="term-procs-toolbar">
                <LuSearch size={13} className="term-procs-search-icon" aria-hidden />
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
                <label className="term-kill-force term-procs-force">
                  <input
                    type="checkbox"
                    checked={killForce}
                    onChange={(e) => setKillForce(e.target.checked)}
                  />
                  Force
                </label>
              </div>
            </div>
            <div className="term-procs-table-wrap">
              <table className="term-procs-table">
                <thead>
                  <tr>
                    <SortTh
                      label="PID"
                      active={procSort === 'pid'}
                      dir={procSortDir}
                      onClick={() => toggleProcSort('pid')}
                    />
                    <SortTh
                      label="Name"
                      active={procSort === 'name'}
                      dir={procSortDir}
                      onClick={() => toggleProcSort('name')}
                    />
                    <SortTh
                      label="CPU%"
                      active={procSort === 'cpu'}
                      dir={procSortDir}
                      onClick={() => toggleProcSort('cpu')}
                    />
                    <SortTh
                      label="Mem"
                      active={procSort === 'mem'}
                      dir={procSortDir}
                      onClick={() => toggleProcSort('mem')}
                    />
                    <SortTh
                      label="Runtime"
                      active={procSort === 'etime'}
                      dir={procSortDir}
                      onClick={() => toggleProcSort('etime')}
                    />
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
                    <tr key={`p-${p.pid}-${p.name}`}>
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
                          title={`Kill PID ${p.pid}`}
                          onClick={() => sendKill({ pid: p.pid })}
                        >
                          <LuX size={12} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="term-procs-section">
            <div className="term-procs-section-head">
              <h3 className="term-procs-title">
                Listening ports
                <span className="term-procs-count">
                  {ports.length ? ` · ${ports.length}` : ''}
                </span>
              </h3>
              {portsNote ? (
                <p className="term-ports-note" title={portsNote}>
                  {portsNote}
                </p>
              ) : null}
              <div className="term-procs-toolbar">
                <LuSearch size={13} className="term-procs-search-icon" aria-hidden />
                <input
                  type="search"
                  className="term-procs-search"
                  placeholder="Search ports, process, PID…"
                  value={portQuery}
                  onChange={(e) => setPortQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="term-procs-table-wrap">
              <table className="term-procs-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Port"
                      active={portSort === 'port'}
                      dir={portSortDir}
                      onClick={() => togglePortSort('port')}
                    />
                    <SortTh
                      label="Proto"
                      active={portSort === 'proto'}
                      dir={portSortDir}
                      onClick={() => togglePortSort('proto')}
                    />
                    <SortTh
                      label="Process"
                      active={portSort === 'name'}
                      dir={portSortDir}
                      onClick={() => togglePortSort('name')}
                    />
                    <SortTh
                      label="PID"
                      active={portSort === 'pid'}
                      dir={portSortDir}
                      onClick={() => togglePortSort('pid')}
                    />
                    <SortTh
                      label="Address"
                      active={portSort === 'address'}
                      dir={portSortDir}
                      onClick={() => togglePortSort('address')}
                    />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedPorts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="term-procs-empty">
                        {ports.length === 0
                          ? 'Loading ports…'
                          : 'No matching ports'}
                      </td>
                    </tr>
                  )}
                  {sortedPorts.map((p) => (
                    <tr key={`port-${p.port}-${p.pid}-${p.address}`}>
                      <td className="mono">{p.port}</td>
                      <td className="mono">{p.proto || 'TCP'}</td>
                      <td className="name" title={p.name}>
                        {p.name || '—'}
                      </td>
                      <td className="mono">{p.pid || '—'}</td>
                      <td className="name" title={p.address}>
                        {p.address || '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="term-proc-kill"
                          title={
                            p.pid
                              ? `Kill PID ${p.pid} (port ${p.port})`
                              : `Kill listeners on port ${p.port}`
                          }
                          onClick={() =>
                            p.pid
                              ? sendKill({ pid: p.pid })
                              : sendKill({ port: p.port })
                          }
                        >
                          <LuX size={12} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {killMsg && <p className="term-procs-msg">{killMsg}</p>}
        </div>
      )}

      {pkillOpen && (
        <div className="term-footer-panel term-pkill-panel">
          <div className="term-pkill-modes" role="tablist" aria-label="Kill by">
            <button
              type="button"
              role="tab"
              aria-selected={killMode === 'pid'}
              className={`term-pkill-mode ${killMode === 'pid' ? 'active' : ''}`}
              onClick={() => {
                setKillMode('pid');
                setKillMsg(null);
              }}
            >
              By PID
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={killMode === 'port'}
              className={`term-pkill-mode ${killMode === 'port' ? 'active' : ''}`}
              onClick={() => {
                setKillMode('port');
                setKillMsg(null);
              }}
            >
              By port
            </button>
          </div>
          <form className="term-kill" onSubmit={onKill}>
            <label className="term-kill-label" htmlFor={`kill-${id}`}>
              {killMode === 'port' ? 'Port' : 'PID'}
            </label>
            <input
              id={`kill-${id}`}
              className="term-kill-input"
              type="text"
              inputMode="numeric"
              placeholder={killMode === 'port' ? 'e.g. 3001' : 'e.g. 12345'}
              value={killTarget}
              onChange={(e) => setKillTarget(e.target.value)}
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
              {killMode === 'port' ? 'Kill port' : 'Kill PID'}
            </button>
            {killMsg && <span className="term-kill-msg">{killMsg}</span>}
          </form>
          <p className="term-pkill-hint">
            {killMode === 'port'
              ? 'Terminates every process listening on that TCP port.'
              : 'Sends SIGTERM (or SIGKILL when Force is on) to the process.'}
          </p>
        </div>
      )}
    </div>
  );
}
