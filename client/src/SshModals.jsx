import { useEffect, useState } from 'react';
import { pickIdentityFile } from './pickIdentityFile.js';
import { TabContextMenu } from './TabContextMenu.jsx';

export function Modal({ title, onClose, children, wide = false, footer = null }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

function useHostFormState(initial) {
  const [alias, setAlias] = useState(initial?.alias || '');
  const [hostName, setHostName] = useState(initial?.hostName || '');
  const [user, setUser] = useState(initial?.user || '');
  const [port, setPort] = useState(initial?.port || '');
  const [identityFile, setIdentityFile] = useState(
    (initial?.identityFile || '').replace(/^["']|["']$/g, '')
  );
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setAlias(initial?.alias || '');
    setHostName(initial?.hostName || '');
    setUser(initial?.user || '');
    setPort(initial?.port || '');
    setIdentityFile((initial?.identityFile || '').replace(/^["']|["']$/g, ''));
    setError(null);
  }, [
    initial?.alias,
    initial?.hostName,
    initial?.user,
    initial?.port,
    initial?.identityFile,
  ]);

  return {
    alias,
    setAlias,
    hostName,
    setHostName,
    user,
    setUser,
    port,
    setPort,
    identityFile,
    setIdentityFile,
    saving,
    setSaving,
    picking,
    setPicking,
    error,
    setError,
  };
}

async function saveHost({ mode, initial, body }) {
  const res =
    mode === 'edit'
      ? await fetch(`/api/ssh-hosts/${encodeURIComponent(initial.alias)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      : await fetch('/api/ssh-hosts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function HostFormFields({
  alias,
  setAlias,
  hostName,
  setHostName,
  user,
  setUser,
  port,
  setPort,
  identityFile,
  setIdentityFile,
  saving,
  picking,
  browseIdentity,
  error,
}) {
  return (
    <>
      {error && <div className="form-error">{error}</div>}
      <label>
        <span>Host alias</span>
        <input
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="myserver"
          required
          autoFocus
        />
      </label>
      <label>
        <span>HostName</span>
        <input
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
          placeholder="example.com or 1.2.3.4"
        />
      </label>
      <label>
        <span>User</span>
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="ubuntu"
        />
      </label>
      <label>
        <span>Port</span>
        <input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="22"
          inputMode="numeric"
        />
      </label>
      <div className="host-form-identity">
        <span>IdentityFile</span>
        {identityFile ? (
          <div className="identity-edit-row">
            <div className="identity-edit-name" title={identityFile}>
              {identityFile.split(/[/\\]/).pop() || identityFile}
            </div>
            <button
              type="button"
              className="identity-clear-btn"
              title="Clear identity file"
              aria-label="Clear identity file"
              disabled={saving || picking}
              onClick={() => setIdentityFile('')}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="identity-file-actions">
            <button
              type="button"
              className="btn ghost identity-browse-btn"
              disabled={saving || picking}
              onClick={browseIdentity}
            >
              {picking ? 'Browsing…' : 'Browse…'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Right-side create / edit / duplicate panel for a host. */
export function HostDetailPanel({
  mode,
  initial,
  titleOverride,
  onClose,
  onSaved,
  onDuplicate,
  onDelete,
}) {
  const form = useHostFormState(initial);
  const [ctxMenu, setCtxMenu] = useState(null);

  const browseIdentity = async () => {
    form.setPicking(true);
    form.setError(null);
    try {
      const path = await pickIdentityFile();
      if (path) form.setIdentityFile(path);
    } catch (err) {
      form.setError(err instanceof Error ? err.message : String(err));
    } finally {
      form.setPicking(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    form.setSaving(true);
    form.setError(null);
    try {
      const data = await saveHost({
        mode: mode === 'duplicate' ? 'add' : mode,
        initial,
        body: {
          alias: form.alias.trim(),
          hostName: form.hostName.trim(),
          user: form.user.trim(),
          port: form.port.trim(),
          identityFile: form.identityFile.trim(),
        },
      });
      onSaved?.(data.hosts || [], data.host || null);
    } catch (err) {
      form.setError(err instanceof Error ? err.message : String(err));
    } finally {
      form.setSaving(false);
    }
  };

  const title =
    titleOverride ||
    (mode === 'edit'
      ? `Edit ${initial?.alias || 'host'}`
      : mode === 'duplicate'
        ? `Duplicate ${initial?.alias || 'host'}`
        : 'New Host');

  const openMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect =
      e.currentTarget instanceof Element
        ? e.currentTarget.getBoundingClientRect()
        : null;
    setCtxMenu({
      x: rect ? rect.right - 8 : e.clientX,
      y: rect ? rect.bottom + 4 : e.clientY,
    });
  };

  const onCtxAction = (id) => {
    setCtxMenu(null);
    if (id === 'edit') return;
    if (id === 'duplicate') {
      onDuplicate?.({
        alias: form.alias,
        hostName: form.hostName,
        user: form.user,
        port: form.port,
        identityFile: form.identityFile,
        editable: true,
      });
      return;
    }
    if (id === 'delete' && mode === 'edit' && initial) {
      onDelete?.(initial);
    }
  };

  return (
    <>
      <aside
        className="right-drawer detail-panel host-detail-panel"
        aria-label="Host details"
      >
        <div className="right-drawer-body snippet-detail-body">
          <div className="snippet-side-form">
            <div className="detail-panel-header embedded side-form-header">
              <div>
                <div className="detail-panel-title">{title}</div>
                <div className="detail-panel-sub">
                  {mode === 'edit'
                    ? initial?.alias || 'SSH host'
                    : 'New host'}
                </div>
              </div>
              <div className="detail-panel-header-actions">
                <button
                  type="button"
                  className="host-card-menu snippet-detail-menu"
                  title="More"
                  aria-label="Host options"
                  onClick={openMenu}
                >
                  ⋯
                </button>
                <button
                  type="button"
                  className="side-form-close"
                  onClick={onClose}
                  title="Close"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <form
              className="host-form snippet-side-form-body"
              onSubmit={submit}
            >
              <HostFormFields {...form} browseIdentity={browseIdentity} />
              <div className="side-form-actions">
                <button
                  type="submit"
                  className="btn primary side-form-save"
                  disabled={form.saving}
                >
                  {form.saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </aside>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { id: 'edit', label: 'Edit' },
            {
              id: 'duplicate',
              label: 'Duplicate',
              disabled: !form.alias.trim(),
            },
            { separator: true },
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              disabled: mode !== 'edit' || initial?.editable === false,
            },
          ]}
          onAction={onCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

export function HostFormModal({
  mode,
  initial,
  onClose,
  onSaved,
  titleOverride,
}) {
  const form = useHostFormState(initial);

  const browseIdentity = async () => {
    form.setPicking(true);
    form.setError(null);
    try {
      const path = await pickIdentityFile();
      if (path) form.setIdentityFile(path);
    } catch (err) {
      form.setError(err instanceof Error ? err.message : String(err));
    } finally {
      form.setPicking(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    form.setSaving(true);
    form.setError(null);
    try {
      const data = await saveHost({
        mode,
        initial,
        body: {
          alias: form.alias.trim(),
          hostName: form.hostName.trim(),
          user: form.user.trim(),
          port: form.port.trim(),
          identityFile: form.identityFile.trim(),
        },
      });
      onSaved(data.hosts || []);
      onClose();
    } catch (err) {
      form.setError(err instanceof Error ? err.message : String(err));
    } finally {
      form.setSaving(false);
    }
  };

  const title =
    titleOverride ||
    (mode === 'edit' ? `Edit ${initial?.alias}` : 'Add SSH host');

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={form.saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="host-form"
            className="btn primary"
            disabled={form.saving}
          >
            {form.saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="host-form" className="host-form" onSubmit={submit}>
        <HostFormFields {...form} browseIdentity={browseIdentity} />
      </form>
    </Modal>
  );
}
