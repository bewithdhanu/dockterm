import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileManager } from '@cubone/react-file-manager';
import '@cubone/react-file-manager/dist/style.css';
import {
  LuFilePlus,
  LuFolderPlus,
  LuPencil,
  LuShield,
  LuTrash2,
  LuFolderSearch,
  LuUpload,
  LuDownload,
  LuRefreshCw,
} from 'react-icons/lu';
import { Modal } from './SshModals.jsx';

async function fmApi(op, body) {
  const res = await fetch(`/api/fm/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function toUiPath(p) {
  const s = String(p ?? '').replace(/\\/g, '/').trim();
  if (!s || s === 'null' || s === 'undefined') return '';
  return s;
}

function startPath(cwd, sshHost) {
  const s = toUiPath(cwd);
  if (s) return s;
  return sshHost ? '~' : '~';
}

function fromUiPath(p, sshHost) {
  const s = String(p || '');
  if (sshHost) return s;
  if (/^[A-Za-z]:\//.test(s)) return s.replace(/\//g, '\\');
  return s;
}

function entriesToFiles(dirPath, entries) {
  const root = toUiPath(dirPath);
  /** @type {Array<{name:string,isDirectory:boolean,path:string,size?:number,updatedAt?:string,mode?:string}>} */
  const files = [];
  const seen = new Set();

  const addDir = (p, name) => {
    const pathKey = toUiPath(p);
    if (seen.has(pathKey)) return;
    seen.add(pathKey);
    files.push({ name, isDirectory: true, path: pathKey });
  };

  if (root.startsWith('/')) {
    addDir('/', '/');
    const parts = root.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      addDir(acc, part);
    }
  } else {
    const rootName = root.split('/').filter(Boolean).pop() || root || 'Home';
    addDir(root, rootName);
  }

  for (const e of entries || []) {
    const childPath = toUiPath(e.path);
    if (seen.has(childPath)) continue;
    seen.add(childPath);
    files.push({
      name: e.name,
      isDirectory: Boolean(e.isDirectory),
      path: childPath,
      size: e.size,
      updatedAt: e.modified ? new Date(e.modified).toISOString() : undefined,
      mode: e.mode,
    });
  }
  return files;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function downloadBase64(name, contentBase64) {
  const bin = atob(contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  a.click();
  URL.revokeObjectURL(url);
}

function IconBtn({ title, disabled, onClick, children }) {
  return (
    <button
      type="button"
      className="term-files-icon-btn"
      data-tooltip={title}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Session-scoped file explorer (list layout) for local or SSH cwd.
 */
export function FileManagerPanel({
  sshHost = null,
  cwd = null,
  primaryColor = '#3b82f6',
}) {
  const [currentPath, setCurrentPath] = useState(() => startPath(cwd, sshHost));
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [writable, setWritable] = useState(true);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');
  const uploadRef = useRef(null);
  const pathRef = useRef(currentPath);
  pathRef.current = currentPath;
  const termCwdRef = useRef(startPath(cwd, sshHost));
  const busyRef = useRef(false);

  const ctx = useMemo(
    () => ({
      sshHost: sshHost || null,
    }),
    [sshHost]
  );

  const refresh = useCallback(
    async (dir) => {
      const target = toUiPath(dir || pathRef.current) || startPath(cwd, ctx.sshHost);
      setLoading(true);
      setError(null);
      try {
        const data = await fmApi('list', {
          ...ctx,
          path: fromUiPath(target, ctx.sshHost) || target,
        });
        const resolved = toUiPath(data.path);
        setCurrentPath(resolved);
        pathRef.current = resolved;
        setWritable(data.writable !== false);
        setFiles(entriesToFiles(resolved, data.entries));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setWritable(false);
      } finally {
        setLoading(false);
      }
    },
    [ctx, cwd]
  );

  // Open at terminal cwd; follow terminal cds, but don't yank the view
  // while the user is browsing another folder or a transfer is in flight.
  useEffect(() => {
    const next = startPath(cwd, sshHost);
    const prevTerm = termCwdRef.current;
    termCwdRef.current = next;
    if (busyRef.current) return;
    const browsing =
      pathRef.current &&
      pathRef.current !== prevTerm &&
      pathRef.current !== next;
    if (browsing && prevTerm === next) return;
    void refresh(next);
  }, [sshHost, cwd, refresh]);

  const run = useCallback(
    async (fn) => {
      setBusy(true);
      busyRef.current = true;
      setError(null);
      try {
        await fn();
        await refresh(pathRef.current);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh]
  );

  const onFolderChange = useCallback(
    (next) => {
      const p = toUiPath(next);
      setCurrentPath(p);
      pathRef.current = p;
      void refresh(p);
    },
    [refresh]
  );

  const onCreateFolder = (name, parentFolder) => {
    const parent = parentFolder?.path || currentPath;
    void run(() =>
      fmApi('mkdir', {
        ...ctx,
        path: fromUiPath(parent, ctx.sshHost),
        name,
      })
    );
  };

  const onRename = (file, newName) => {
    void run(() =>
      fmApi('rename', {
        ...ctx,
        path: fromUiPath(file.path, ctx.sshHost),
        newName,
      })
    );
  };

  const onDelete = (items) => {
    const paths = (items || []).map((f) => fromUiPath(f.path, ctx.sshHost));
    if (!paths.length) return;
    if (!confirm(`Delete ${paths.length} item(s)?`)) return;
    void run(() => fmApi('delete', { ...ctx, paths }));
  };

  const onPaste = (items, destinationFolder, operationType) => {
    const paths = (items || []).map((f) => fromUiPath(f.path, ctx.sshHost));
    const destination = fromUiPath(
      destinationFolder?.path || currentPath,
      ctx.sshHost
    );
    void run(() =>
      fmApi('paste', {
        ...ctx,
        paths,
        destination,
        operation: operationType === 'move' ? 'move' : 'copy',
      })
    );
  };

  const openDialog = (type, initial = '') => {
    setError(null);
    setDialogValue(initial);
    setDialog(type);
  };

  const closeDialog = () => {
    setDialog(null);
    setDialogValue('');
  };

  const submitDialog = () => {
    const value = dialogValue.trim();
    const type = dialog;
    closeDialog();
    if (!type) return;

    if (type === 'file') {
      if (!value) return;
      void run(() =>
        fmApi('create-file', {
          ...ctx,
          path: fromUiPath(currentPath, ctx.sshHost),
          name: value,
        })
      );
      return;
    }
    if (type === 'folder') {
      if (!value) return;
      void run(() =>
        fmApi('mkdir', {
          ...ctx,
          path: fromUiPath(currentPath, ctx.sshHost),
          name: value,
        })
      );
      return;
    }
    if (type === 'rename') {
      if (!value || selected.length !== 1) return;
      void run(() =>
        fmApi('rename', {
          ...ctx,
          path: fromUiPath(selected[0].path, ctx.sshHost),
          newName: value,
        })
      );
      return;
    }
    if (type === 'chmod') {
      if (!/^[0-7]{3,4}$/.test(value)) {
        setError('Mode must be octal like 644 or 755');
        return;
      }
      const paths = selected
        .map((f) => fromUiPath(f.path, ctx.sshHost))
        .filter(Boolean);
      if (!paths.length) {
        setError('Select one or more items first');
        return;
      }
      void run(() => fmApi('chmod', { ...ctx, paths, mode: value }));
      return;
    }
    if (type === 'goto') {
      if (!value) return;
      void refresh(toUiPath(value));
    }
  };

  const confirmDelete = () => {
    if (!selected.length) {
      setError('Select one or more items first');
      return;
    }
    openDialog('delete');
  };

  const doDelete = () => {
    const paths = selected.map((f) => fromUiPath(f.path, ctx.sshHost));
    closeDialog();
    void run(() => fmApi('delete', { ...ctx, paths }));
  };

  const doDownload = () => {
    const filesOnly = selected.filter((f) => !f.isDirectory);
    if (filesOnly.length !== 1) {
      setError('Select a single file to download');
      return;
    }
    void run(async () => {
      const data = await fmApi('download', {
        ...ctx,
        path: fromUiPath(filesOnly[0].path, ctx.sshHost),
      });
      downloadBase64(data.name || filesOnly[0].name, data.contentBase64);
    });
  };

  const onUploadPicked = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    if (!list.length) return;
    // Freeze destination — terminal cwd sync must not redirect mid-upload.
    const destDir = fromUiPath(pathRef.current, ctx.sshHost);
    if (!writable) {
      setError(
        `Permission denied: cannot write to ${pathRef.current || destDir}. Choose a writable folder (e.g. your home directory).`
      );
      return;
    }
    void run(async () => {
      for (const file of list) {
        if (file.size > 32 * 1024 * 1024) {
          throw new Error(`${file.name}: too large (max 32 MB)`);
        }
        const contentBase64 = await fileToBase64(file);
        await fmApi('upload', {
          ...ctx,
          path: destDir,
          name: file.name,
          contentBase64,
        });
      }
    });
  };

  const requireWritable = () => {
    if (writable) return true;
    setError(
      `Permission denied: cannot write to ${currentPath || 'this folder'}. Choose a writable folder (e.g. your home directory).`
    );
    return false;
  };

  const dialogMeta = {
    file: {
      title: 'New file',
      label: 'File name',
      placeholder: 'notes.txt',
      submit: 'Create',
    },
    folder: {
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'docs',
      submit: 'Create',
    },
    rename: {
      title: 'Rename',
      label: 'New name',
      placeholder: 'name',
      submit: 'Rename',
    },
    chmod: {
      title: 'Change permissions',
      label: 'Mode (octal)',
      placeholder: '644',
      submit: 'Apply',
    },
    goto: {
      title: 'Go to directory',
      label: 'Path',
      placeholder: sshHost ? '/home/ubuntu' : '~',
      submit: 'Open',
    },
  }[dialog];

  return (
    <div className="term-files-panel">
      <div className="term-files-toolbar">
        <div className="term-files-actions">
          <IconBtn
            title={writable ? 'New file' : 'New file (folder not writable)'}
            disabled={busy || !writable}
            onClick={() => {
              if (!requireWritable()) return;
              openDialog('file');
            }}
          >
            <LuFilePlus size={16} aria-hidden />
          </IconBtn>
          <IconBtn
            title={writable ? 'New folder' : 'New folder (folder not writable)'}
            disabled={busy || !writable}
            onClick={() => {
              if (!requireWritable()) return;
              openDialog('folder');
            }}
          >
            <LuFolderPlus size={16} aria-hidden />
          </IconBtn>
          <IconBtn
            title="Rename selected"
            disabled={busy || !writable}
            onClick={() => {
              if (!requireWritable()) return;
              if (selected.length !== 1) {
                setError('Select one item to rename');
                return;
              }
              openDialog('rename', selected[0].name || '');
            }}
          >
            <LuPencil size={16} aria-hidden />
          </IconBtn>
          <IconBtn
            title="Change permissions"
            disabled={busy}
            onClick={() => {
              if (!selected.length) {
                setError('Select one or more items first');
                return;
              }
              openDialog(
                'chmod',
                selected[0]?.mode || (selected[0]?.isDirectory ? '755' : '644')
              );
            }}
          >
            <LuShield size={16} aria-hidden />
          </IconBtn>
          <IconBtn
            title="Delete selected"
            disabled={busy || !writable}
            onClick={() => {
              if (!requireWritable()) return;
              confirmDelete();
            }}
          >
            <LuTrash2 size={16} aria-hidden />
          </IconBtn>
          <span className="term-files-actions-sep" aria-hidden />
          <IconBtn
            title="Go to directory"
            disabled={busy}
            onClick={() => openDialog('goto', currentPath || '')}
          >
            <LuFolderSearch size={16} aria-hidden />
          </IconBtn>
          <IconBtn
            title={writable ? 'Upload files' : 'Upload (folder not writable)'}
            disabled={busy || !writable}
            onClick={() => {
              if (!requireWritable()) return;
              uploadRef.current?.click();
            }}
          >
            <LuUpload size={16} aria-hidden />
          </IconBtn>
          <IconBtn title="Download selected file" disabled={busy} onClick={doDownload}>
            <LuDownload size={16} aria-hidden />
          </IconBtn>
          <IconBtn
            title="Refresh"
            disabled={busy || loading}
            onClick={() => void refresh(currentPath)}
          >
            <LuRefreshCw size={16} aria-hidden />
          </IconBtn>
          {!writable ? (
            <span
              className="term-files-readonly-hint"
              title={`No write permission in ${currentPath || 'this folder'}`}
            >
              Read-only
            </span>
          ) : null}
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="term-files-upload-input"
            onChange={onUploadPicked}
          />
        </div>
      </div>
      {error ? <div className="term-files-error">{error}</div> : null}
      <div className="term-files-body dockterm-fm">
        {loading || busy ? (
          <div className="term-files-loading" role="status" aria-live="polite">
            <div className="term-files-loading-spinner" aria-hidden="true" />
            <span>{busy ? 'Working…' : 'Loading files…'}</span>
          </div>
        ) : null}
        <FileManager
          key={sshHost || 'local'}
          files={files}
          height="100%"
          width="100%"
          initialPath={currentPath}
          onFolderChange={onFolderChange}
          onCreateFolder={onCreateFolder}
          onRename={onRename}
          onDelete={onDelete}
          onPaste={onPaste}
          onRefresh={() => void refresh(currentPath)}
          onSelectionChange={setSelected}
          layout="list"
          primaryColor={primaryColor}
          fontFamily="var(--font-sans, ui-sans-serif, system-ui, sans-serif)"
          permissions={{
            create: true,
            upload: false,
            move: true,
            copy: true,
            rename: true,
            download: false,
            delete: true,
          }}
        />
      </div>

      {dialog === 'delete' ? (
        <Modal
          title="Delete"
          onClose={closeDialog}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={closeDialog}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={doDelete}>
                Delete {selected.length} item{selected.length === 1 ? '' : 's'}
              </button>
            </>
          }
        >
          <p className="term-files-dialog-text">
            Permanently delete{' '}
            <strong>
              {selected.length === 1
                ? selected[0].name
                : `${selected.length} items`}
            </strong>
            ?
          </p>
        </Modal>
      ) : null}

      {dialogMeta ? (
        <Modal
          title={dialogMeta.title}
          onClose={closeDialog}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={closeDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={submitDialog}
                disabled={!dialogValue.trim()}
              >
                {dialogMeta.submit}
              </button>
            </>
          }
        >
          <label className="term-files-dialog-field">
            <span>{dialogMeta.label}</span>
            <input
              autoFocus
              value={dialogValue}
              placeholder={dialogMeta.placeholder}
              spellCheck={false}
              onChange={(e) => setDialogValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitDialog();
                }
              }}
            />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
