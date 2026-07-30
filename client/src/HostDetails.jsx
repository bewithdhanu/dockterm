import { useEffect, useState } from 'react';
import { HostFormModal } from './SshModals.jsx';
import { HostOsBadge } from './HostOsBadge.jsx';
import { TabContextMenu } from './TabContextMenu.jsx';
import { pickIdentityFile } from './pickIdentityFile.js';
import { nextCopyAlias } from './useSshHosts.js';

function statusText(status) {
  if (status === 'connecting') return 'Connecting…';
  if (status === 'connected') return 'Connected';
  return 'Not connected';
}

function displayIdentityPath(p) {
  if (!p) return '';
  return String(p).replace(/^["']|["']$/g, '');
}

function identityFileName(p) {
  const path = displayIdentityPath(p);
  if (!path) return '';
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function useIdentityPreview(filePath) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const path = displayIdentityPath(filePath);
    if (!path) {
      setPreview(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/identity-preview?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview({
            name: identityFileName(path),
            path,
            exists: null,
            publicKey: null,
            fingerprint: null,
            error:
              err instanceof Error ? err.message : 'Could not load identity preview',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return { preview, loading };
}

/** View mode: filename + public key / certificate body. */
function IdentityDetailsView({ filePath }) {
  const path = displayIdentityPath(filePath);
  const { preview, loading } = useIdentityPreview(path);

  if (!path) {
    return (
      <div className="identity-file-block">
        <div className="detail-label">Identity</div>
        <div className="identity-file-empty">No identity file</div>
      </div>
    );
  }

  const name = preview?.name || identityFileName(path);

  return (
    <div className="identity-file-block">
      <div className="detail-label">Identity</div>
      <div className="identity-card">
        <div className="identity-card-name" title={path}>
          {name}
        </div>
        {loading ? (
          <div className="identity-card-meta">Loading…</div>
        ) : preview?.publicKey ? (
          <pre className="identity-card-body">{preview.publicKey}</pre>
        ) : preview?.fingerprint ? (
          <div className="identity-card-meta mono">{preview.fingerprint}</div>
        ) : (
          <div className="identity-card-meta">
            {preview?.error
              ? preview.error
              : preview?.exists === false
                ? 'File not found'
                : 'Public key unavailable (passphrase-protected or private-only)'}
          </div>
        )}
      </div>
    </div>
  );
}

/** Edit mode: filename chip + Browse / clear. */
function IdentityEditRow({ value, busy = false, onBrowse, onRemove }) {
  const path = displayIdentityPath(value);
  const name = identityFileName(path);

  return (
    <div className="identity-file-block">
      <div className="detail-label">Identity</div>
      {path ? (
        <div className="identity-edit-row">
          <div className="identity-edit-name" title={path}>
            {name}
          </div>
          <button
            type="button"
            className="identity-clear-btn"
            title="Clear identity file"
            aria-label="Clear identity file"
            disabled={busy}
            onClick={onRemove}
          >
            ×
          </button>
        </div>
      ) : (
        <div className="identity-file-actions">
          <button
            type="button"
            className="btn ghost identity-browse-btn"
            disabled={busy}
            onClick={onBrowse}
          >
            Browse…
          </button>
        </div>
      )}
    </div>
  );
}

function InlineHostEditor({ host, onCancel, onSaved }) {
  const [alias, setAlias] = useState(host.alias || '');
  const [hostName, setHostName] = useState(host.hostName || '');
  const [user, setUser] = useState(host.user || '');
  const [port, setPort] = useState(host.port || '');
  const [identityFile, setIdentityFile] = useState(
    displayIdentityPath(host.identityFile) || ''
  );
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setAlias(host.alias || '');
    setHostName(host.hostName || '');
    setUser(host.user || '');
    setPort(host.port || '');
    setIdentityFile(displayIdentityPath(host.identityFile) || '');
    setError(null);
  }, [host]);

  const browseIdentity = async () => {
    setPicking(true);
    setError(null);
    try {
      const next = await pickIdentityFile();
      if (next) setIdentityFile(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        alias: alias.trim(),
        hostName: hostName.trim(),
        user: user.trim(),
        port: port.trim(),
        identityFile: identityFile.trim(),
      };
      const res = await fetch(
        `/api/ssh-hosts/${encodeURIComponent(host.alias)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved?.(data.hosts || [], body.alias);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="detail-edit-form" onSubmit={submit}>
      <div className="detail-section">
        <div className="detail-label">Edit host</div>
        {error && <div className="form-error">{error}</div>}
        <label className="detail-edit-field">
          <span>Alias</span>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="detail-edit-field">
          <span>HostName</span>
          <input
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder="example.com or 1.2.3.4"
          />
        </label>
        <label className="detail-edit-field">
          <span>User</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="ubuntu"
          />
        </label>
        <label className="detail-edit-field">
          <span>Port</span>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="22"
            inputMode="numeric"
          />
        </label>
        <IdentityEditRow
          value={identityFile}
          busy={saving || picking}
          onBrowse={browseIdentity}
          onRemove={() => setIdentityFile('')}
        />
      </div>
      <div className="detail-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function HostDetails({
  host,
  status,
  osInfo,
  hosts,
  onConnect,
  onClose,
  onHostsSaved,
  onDelete,
  onAliasRenamed,
  startEditing = false,
  onEditConsumed,
}) {
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    setEditing(false);
    setMenu(null);
  }, [host?.alias]);

  useEffect(() => {
    if (startEditing && host?.editable) {
      setEditing(true);
      onEditConsumed?.();
    }
  }, [startEditing, host, onEditConsumed]);

  const openMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right - 8, y: rect.bottom + 4 });
  };

  const onMenuAction = (id) => {
    setMenu(null);
    if (!host) return;
    if (id === 'edit') {
      if (!host.editable) {
        alert(
          'This host comes from an Include file or a multi-host entry. Use Config instead.'
        );
        return;
      }
      setEditing(true);
    }
    if (id === 'duplicate') {
      setModal({
        type: 'duplicate',
        host: {
          ...host,
          alias: nextCopyAlias(host.alias, hosts || []),
        },
        sourceAlias: host.alias,
      });
    }
    if (id === 'delete') onDelete?.(host);
  };

  if (!host) {
    return (
      <aside className="detail-panel" aria-label="Host details">
        <div className="detail-panel-header">
          <div>
            <div className="detail-panel-title">Host Details</div>
            <div className="detail-panel-sub">Select a host</div>
          </div>
        </div>
        <div className="detail-panel-empty">
          Click a host card to inspect connection details.
        </div>
      </aside>
    );
  }

  const address = `${host.user ? `${host.user}@` : ''}${host.hostName || ''}${
    host.port && host.port !== '22' ? `:${host.port}` : ''
  }`;

  return (
    <>
      <aside className="detail-panel" aria-label="Host details">
        <div className="detail-panel-header">
          <div>
            <div className="detail-panel-title">
              {editing ? 'Edit Host' : 'Host Details'}
            </div>
            <div className="detail-panel-sub">~/.ssh/config</div>
          </div>
          <div className="detail-panel-header-actions">
            {!editing ? (
              <button
                type="button"
                className="detail-icon-btn"
                title="More"
                aria-label="Host options"
                onClick={openMenu}
              >
                ⋯
              </button>
            ) : null}
            <button
              type="button"
              className="detail-panel-collapse"
              onClick={onClose}
              title="Collapse"
            >
              ›
            </button>
          </div>
        </div>

        {editing ? (
          <InlineHostEditor
            host={host}
            onCancel={() => setEditing(false)}
            onSaved={(list, newAlias) => {
              onHostsSaved?.(list);
              if (newAlias && newAlias !== host.alias) {
                onAliasRenamed?.(newAlias);
              }
              setEditing(false);
            }}
          />
        ) : (
          <>
            <div className="detail-section">
              <div className="detail-label">Address</div>
              <div className="detail-address">
                <HostOsBadge
                  className="detail-address-os"
                  osId={osInfo?.id}
                  title={osInfo?.pretty || osInfo?.label || 'SSH'}
                />
                <code>{address || '—'}</code>
              </div>
              <div className={`detail-status status-${status || 'idle'}`}>
                <span className="detail-status-dot" />
                {statusText(status)}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-label">General</div>
              <div className="detail-field">
                <span>Alias</span>
                <strong>{host.alias}</strong>
              </div>
              <div className="detail-field">
                <span>HostName</span>
                <strong>{host.hostName || '—'}</strong>
              </div>
              <div className="detail-field">
                <span>User</span>
                <strong>{host.user || '—'}</strong>
              </div>
              <div className="detail-field">
                <span>Port</span>
                <strong>{host.port || '22'}</strong>
              </div>
              {!host.editable ? (
                <p className="detail-hint">
                  From Include / multi-host — edit via Config file.
                </p>
              ) : null}
            </div>

            <div className="detail-section">
              <IdentityDetailsView filePath={host.identityFile} />
            </div>

            <div className="detail-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => onConnect?.(host)}
              >
                Connect
              </button>
            </div>
          </>
        )}
      </aside>

      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { id: 'edit', label: 'Edit', disabled: !host.editable },
            { id: 'duplicate', label: 'Duplicate' },
            { separator: true },
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              disabled: !host.editable,
            },
          ]}
          onAction={onMenuAction}
          onClose={() => setMenu(null)}
        />
      )}

      {modal?.type === 'duplicate' && (
        <HostFormModal
          mode="add"
          initial={modal.host}
          titleOverride={`Duplicate ${modal.sourceAlias || modal.host.alias}`}
          onClose={() => setModal(null)}
          onSaved={(list) => {
            onHostsSaved?.(list);
            setModal(null);
          }}
        />
      )}
    </>
  );
}
