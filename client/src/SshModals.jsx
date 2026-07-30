import { useState } from 'react';

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

export function HostFormModal({
  mode,
  initial,
  onClose,
  onSaved,
  titleOverride,
}) {
  const [alias, setAlias] = useState(initial?.alias || '');
  const [hostName, setHostName] = useState(initial?.hostName || '');
  const [user, setUser] = useState(initial?.user || '');
  const [port, setPort] = useState(initial?.port || '');
  const [identityFile, setIdentityFile] = useState(initial?.identityFile || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
      onSaved(data.hosts || []);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="host-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="host-form" className="host-form" onSubmit={submit}>
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
        <label>
          <span>IdentityFile</span>
          <input
            value={identityFile}
            onChange={(e) => setIdentityFile(e.target.value)}
            placeholder="~/.ssh/id_ed25519"
          />
        </label>
      </form>
    </Modal>
  );
}
