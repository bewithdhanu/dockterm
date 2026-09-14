import { useCallback, useState } from 'react';
import { pathFromIdentityDrop } from './pickIdentityFile.js';

function fileName(p) {
  const s = String(p || '').replace(/^["']|["']$/g, '');
  if (!s) return '';
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

/**
 * IdentityFile control: Browse… + drag-and-drop from Finder/Explorer.
 */
export function IdentityFileField({
  value,
  busy = false,
  label = 'IdentityFile',
  browseLabel = 'Browse…',
  onBrowse,
  onChange,
  onClear,
}) {
  const [dragOver, setDragOver] = useState(false);
  const path = String(value || '').replace(/^["']|["']$/g, '').trim();

  const acceptDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (busy) return;
      const next = pathFromIdentityDrop(e);
      if (next) onChange?.(next);
    },
    [busy, onChange]
  );

  const onDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(false);
    }
  };

  return (
    <div className="host-form-identity identity-file-block">
      {label ? <span className="detail-label">{label}</span> : null}
      <div
        className={`identity-drop-zone ${dragOver ? 'is-dragover' : ''} ${
          path ? 'has-file' : ''
        } ${busy ? 'is-busy' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={acceptDrop}
      >
        {path ? (
          <div className="identity-edit-row">
            <div className="identity-edit-name" title={path}>
              {fileName(path)}
            </div>
            <button
              type="button"
              className="identity-clear-btn"
              title="Clear identity file"
              aria-label="Clear identity file"
              disabled={busy}
              onClick={() => onClear?.()}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="identity-file-actions">
            <p className="identity-drop-hint">
              {dragOver ? 'Drop key file here' : 'Drop a .pem / key file here'}
            </p>
            <button
              type="button"
              className="btn ghost identity-browse-btn"
              disabled={busy}
              onClick={onBrowse}
            >
              {busy ? 'Browsing…' : browseLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
